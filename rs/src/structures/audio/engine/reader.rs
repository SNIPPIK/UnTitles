//! Тело фонового потока чтения stdout ffmpeg.
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
    io::{BufReader, Read},
    process::ChildStdout,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
};

/// Читает stdout ffmpeg, демультиплексирует Ogg/Opus и складывает аудио-пакеты
/// в кольцевой буфер.
///
/// Завершается, когда:
/// * `active` сброшен;
/// * `destroyed` выставлен;
/// * ffmpeg закрыл stdout (EOF);
/// * произошла ошибка чтения или парсинга;
/// * парсер переполнен;
/// * произошла ошибка записи в кольцевой буфер.
pub(crate) fn reader_loop(
    stdout: ChildStdout,
    active: Arc<AtomicBool>,
    destroyed: Arc<AtomicBool>,
    pause_state: Arc<(Mutex<bool>, Condvar)>,
    buffer_state: Arc<(Mutex<RingBuffer>, Condvar)>,
) {
    // Буферизованное чтение stdout сглаживает мелкие чтения от ОС.
    let mut reader = BufReader::with_capacity(65536, stdout);

    // Демультиплексор Ogg/Opus.
    let mut parser = OggOpusDemuxer::new();

    // Один read() из stdout.
    let mut read_buf = [0u8; 16384];

    // Переиспользуемый буфер распарсенных пакетов.
    let mut frames = Vec::with_capacity(128);

    'reader: loop {
        // ------------------------------------------------------------------
        // Проверка остановки.
        // ------------------------------------------------------------------
        if !active.load(Ordering::Acquire)
            || destroyed.load(Ordering::Acquire)
        {
            break;
        }

        // ------------------------------------------------------------------
        // Обработка паузы.
        // ------------------------------------------------------------------
        {
            let (lock, cvar) = &*pause_state;

            let mut paused = match lock.lock() {
                Ok(guard) => guard,
                Err(_) => {
                    // Mutex poisoned — завершаем reader через общий cleanup.
                    break 'reader;
                }
            };

            while *paused
                && active.load(Ordering::Acquire)
                && !destroyed.load(Ordering::Acquire)
            {
                paused = match cvar.wait(paused) {
                    Ok(guard) => guard,
                    Err(_) => {
                        // Не делаем return:
                        // нужен общий путь завершения ниже.
                        break 'reader;
                    }
                };
            }
        }

        // ------------------------------------------------------------------
        // После паузы состояние могло измениться.
        // ------------------------------------------------------------------
        if !active.load(Ordering::Acquire)
            || destroyed.load(Ordering::Acquire)
        {
            break;
        }

        // ------------------------------------------------------------------
        // На каждой итерации frames должен быть пустым.
        // ------------------------------------------------------------------
        debug_assert!(
            frames.is_empty(),
            "reader_loop: frames buffer must be empty before parse"
        );

        // На всякий случай очищаем его и в release-сборках.
        frames.clear();

        // ------------------------------------------------------------------
        // Читаем следующий chunk из ffmpeg.
        // ------------------------------------------------------------------
        match reader.read(&mut read_buf) {
            Ok(0) => {
                // EOF: ffmpeg закрыл stdout.
                //
                // Всё, что было полностью распарсено до EOF, уже находится
                // в ring buffer. Незавершённый Ogg page/packet отбрасываем.
                break;
            }

            Ok(n) => {
                // ----------------------------------------------------------
                // Парсим chunk.
                // ----------------------------------------------------------
                if parser
                    .parse_internal(&read_buf[..n], &mut frames)
                    .is_err()
                {
                    break;
                }

                // ----------------------------------------------------------
                // Лимит проверяем ПОСЛЕ parse_internal().
                //
                // До parse_internal() parser.pending_len() мог быть маленьким,
                // а текущий chunk уже мог существенно увеличить remainder
                // или packet_carry.
                // ----------------------------------------------------------
                if parser.pending_len() > MAX_PARSER_PENDING {
                    break;
                }

                // Если parser ничего не выдал — сразу следующий read().
                if frames.is_empty() {
                    continue;
                }

                // ----------------------------------------------------------
                // Загружаем полученные audio packets в RingBuffer.
                // ----------------------------------------------------------
                let (buffer_lock, buffer_cvar) = &*buffer_state;

                let mut buffer = match buffer_lock.lock() {
                    Ok(guard) => guard,
                    Err(_) => {
                        break 'reader;
                    }
                };

                let mut pushed_any = false;

                for (kind, packet) in frames.drain(..) {
                    // Служебные Ogg/Opus packets не отправляем в audio queue.
                    if !kind.is_audio_frame() {
                        continue;
                    }

                    // ------------------------------------------------------
                    // Ждём свободного места.
                    // ------------------------------------------------------
                    while buffer.is_full() {
                        if !active.load(Ordering::Acquire)
                            || destroyed.load(Ordering::Acquire)
                        {
                            break 'reader;
                        }

                        buffer = match buffer_cvar.wait(buffer) {
                            Ok(guard) => guard,
                            Err(_) => {
                                break 'reader;
                            }
                        };
                    }

                    // Состояние могло измениться во время ожидания.
                    if !active.load(Ordering::Acquire)
                        || destroyed.load(Ordering::Acquire)
                    {
                        break 'reader;
                    }

                    // ------------------------------------------------------
                    // Добавляем пакет.
                    // ------------------------------------------------------
                    if buffer.push(packet).is_err() {
                        // Reader больше не может гарантировать корректное
                        // производство данных.
                        active.store(false, Ordering::Release);
                        break 'reader;
                    }

                    pushed_any = true;
                }

                // ----------------------------------------------------------
                // Будим consumer только если реально что-то добавили.
                //
                // Один notify после пачки дешевле, чем notify на каждый
                // audio packet.
                // ----------------------------------------------------------
                if pushed_any {
                    buffer_cvar.notify_one();
                }

                // frames очищается автоматически drain(..), но явно оставляем
                // пустым для гарантии перед следующей итерацией.
                frames.clear();
            }

            Err(_) => {
                // Ошибка чтения stdout ffmpeg.
                break;
            }
        }
    }

    // =========================================================================
    // Единый путь завершения reader.
    //
    // Сюда попадают ВСЕ варианты выхода:
    // stop, destroy, EOF, parser error, read error, mutex poison,
    // ring buffer error, parser overflow.
    // =========================================================================

    active.store(false, Ordering::Release);

    parser.cleanup();
    frames.clear();
}