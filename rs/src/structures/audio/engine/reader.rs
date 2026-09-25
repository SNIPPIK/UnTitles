//! Тело фонового потока чтения stdout FFmpeg.
//!
//! Функция полностью самодостаточна: не хранит ссылок на `AudioEngine`,
//! получает только `Arc`-и на общие состояния. Это позволяет тестировать
//! её отдельно и упрощает вынос в отдельный модуль.

use super::constants::MAX_PARSER_PENDING;
use crate::structures::audio::{
    encoder::ogg::OggOpusDemuxer,
    ring_buffer::RingBuffer,
};
use std::{
    io::{BufRead, BufReader},
    process::ChildStdout,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
};

/// Проверяет, нужно ли остановить reader.
#[inline(always)]
fn should_stop(active: &AtomicBool, destroyed: &AtomicBool) -> bool {
    !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire)
}

/// RAII-уведомление consumer'а.
///
/// Если текущая пачка реально добавила хотя бы один пакет,
/// при любом выходе из блока будет выполнен `notify_one()`.
struct NotifyOnDrop<'a> {
    cvar: &'a Condvar,
    should_notify: bool,
}

impl<'a> Drop for NotifyOnDrop<'a> {
    #[inline]
    fn drop(&mut self) {
        if self.should_notify {
            self.cvar.notify_one();
        }
    }
}

/// Читает stdout FFmpeg, мультиплексирует Ogg/Opus
/// и помещает аудио-пакеты в RingBuffer.
///
/// Завершается при:
/// - остановке `active`;
/// - `destroyed`;
/// - EOF stdout;
/// - ошибке чтения;
/// - ошибке парсинга;
/// - переполнении parser;
/// - poison Mutex/Condvar;
/// - невозможности записать пакет.
pub(crate) fn reader_loop(stdout: ChildStdout, active: Arc<AtomicBool>, destroyed: Arc<AtomicBool>, pause_state: Arc<(Mutex<bool>, Condvar)>, buffer_state: Arc<(Mutex<RingBuffer>, Condvar)>) {
    // ------------------------------------------------------------------------
    // Инициализация
    // ------------------------------------------------------------------------

    // Буферизуем stdout FFmpeg.
    //
    // fill_buf() позволяет отдавать parser'у уже имеющийся внутренний буфер
    // напрямую, без промежуточного копирования в отдельный read_buf.
    let mut reader = BufReader::with_capacity(65536, stdout);

    // Потоковый Ogg/Opus demuxer.
    let mut parser = OggOpusDemuxer::new();

    // Повторно используемый контейнер пакетов
    let mut frames = Vec::with_capacity(128);

    'reader: loop {
        // ====================================================================
        // Проверка остановки
        // ====================================================================

        if should_stop(&active, &destroyed) {
            break;
        }

        // ====================================================================
        // Пользовательская пауза
        // ====================================================================

        {
            let (lock, cvar) = &*pause_state;

            let mut paused = match lock.lock() {
                Ok(guard) => guard,
                Err(_) => break,
            };

            while *paused && !should_stop(&active, &destroyed) {
                paused = match cvar.wait(paused) {
                    Ok(guard) => guard,
                    Err(_) => break 'reader,
                };
            }
        }

        // Состояние могло измениться во время ожидания.
        if should_stop(&active, &destroyed) {
            break;
        }

        // ====================================================================
        // Подготовка output
        // ====================================================================

        debug_assert!(
            frames.is_empty(),
            "reader_loop: frames must be empty before parsing"
        );

        frames.clear();

        // ====================================================================
        // Чтение FFmpeg
        // ====================================================================

        let eof = match reader.fill_buf() {
            Ok(available) if available.is_empty() => {
                // FFmpeg закрыл stdout.
                //
                // НЕ выходим сразу.
                //
                // У OggOpusDemuxer есть flush-path через пустой chunk:
                //
                //     parser.parse_internal(&[], &mut frames)
                //
                // Он должен получить шанс выдать последний packet_carry.
                true
            }

            Ok(available) => {
                let len = available.len();

                // Парсим данные напрямую из внутреннего буфера BufReader.
                //
                // Если parser успел выдать готовые packets до обнаружения
                // проблемы в хвосте, они останутся в `frames` и ниже будут
                // обработаны.
                let parse_result =
                    parser.parse_internal(available, &mut frames);

                // В любом случае consumed bytes больше не должны оставаться
                // в BufReader.
                reader.consume(len);

                if parse_result.is_err() {
                    // Уже готовые packets всё равно отправим в RingBuffer
                    // ниже, после чего reader завершится.
                    //
                    // Это лучше, чем уничтожать frames вместе с parser.
                    true
                } else {
                    false
                }
            }

            Err(_) => {
                // Ошибка чтения stdout.
                //
                // Уже накопленные `frames` ниже будут обработаны.
                true
            }
        };

        // ====================================================================
        // EOF / read error / parser error
        // ====================================================================
        //
        // Если EOF, здесь делаем flush.
        //
        // Если была ошибка parser/read, flush делать уже не нужно:
        // мы не хотим интерпретировать потенциально повреждённый хвост
        // как полноценный Opus packet.
        //
        // Поэтому для EOF отдельно вызываем flush.
        // ====================================================================

        if eof {
            // Если stdout действительно закончился нормально,
            // flush оставшегося packet_carry обязателен.
            //
            // Если внутри parser есть последний незавершённый Ogg/Opus packet,
            // именно здесь он получает шанс попасть в `frames`.
            if parser.pending_len() != 0 {
                let _ = parser.parse_internal(&[], &mut frames);
            }
        }

        // ====================================================================
        // Передача готовых packets в RingBuffer
        // ====================================================================

        if !frames.is_empty() {
            let (buffer_lock, buffer_cvar) = &*buffer_state;

            let mut buffer = match buffer_lock.lock() {
                Ok(guard) => guard,
                Err(_) => break 'reader,
            };

            // Один notify после batch.
            //
            // Даже если ниже произойдёт ранний break,
            // Drop notifier разбудит consumer, если хотя бы один
            // packet уже был добавлен.
            let mut notifier = NotifyOnDrop {
                cvar: buffer_cvar,
                should_notify: false,
            };

            for (kind, packet) in frames.drain(..) {
                // В audio queue идут только типы, являющиеся аудио.
                //
                // Здесь используется существующий semantic helper
                // `is_audio_frame()`.
                if !kind.is_audio_frame() {
                    continue;
                }

                // ------------------------------------------------------------
                // Backpressure
                // ------------------------------------------------------------

                while buffer.is_full() {
                    if should_stop(&active, &destroyed) {
                        break 'reader;
                    }

                    buffer = match buffer_cvar.wait(buffer) {
                        Ok(guard) => guard,
                        Err(_) => break 'reader,
                    };
                }

                // Пока ждали свободный слот, поток мог быть остановлен.
                if should_stop(&active, &destroyed) {
                    break 'reader;
                }

                // ------------------------------------------------------------
                // Push
                // ------------------------------------------------------------

                match buffer.push(packet) {
                    Ok(()) => {
                        // Есть что сообщить consumer'у.
                        notifier.should_notify = true;
                    }

                    Err(_packet) => {
                        // Теоретически сюда не должны попасть:
                        // выше уже проверен `is_full()` и producer единственный.
                        //
                        // Но сохраняем защиту от любой рассинхронизации.
                        active.store(false, Ordering::Release);
                        break 'reader;
                    }
                }
            }

            drop(notifier);
        }

        // ====================================================================
        // EOF
        // ====================================================================

        if eof {
            break;
        }

        // ====================================================================
        // Проверка parser limits
        // ====================================================================
        //
        // Важно делать её ПОСЛЕ обработки уже готовых frames.
        //
        // Если текущий chunk одновременно:
        //   - выдал валидные audio packets;
        //   - увеличил remainder/packet_carry;
        //
        // готовые packets не должны теряться только из-за последующего
        // превышения parser limit.
        // ====================================================================

        if parser.pending_len() > MAX_PARSER_PENDING {
            break;
        }
    }

    // =========================================================================
    // Единая очистка
    // =========================================================================

    active.store(false, Ordering::Release);

    // На этом этапе reader завершён, поэтому parser можно спокойно очистить.
    parser.cleanup();
    frames.clear();
}