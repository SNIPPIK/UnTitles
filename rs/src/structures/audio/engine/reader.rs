//! Тело фонового потока чтения stdout ffmpeg.
//!
//! Функция полностью самодостаточна: не хранит ссылок на `AudioEngine`,
//! получает только `Arc`-и на общие состояния. Это позволяет тестировать
//! её отдельно и упрощает вынос в отдельный модуль.

use super::constants::MAX_PARSER_PENDING;
use crate::structures::audio::{encoder::ogg::OggOpusDemuxer, ring_buffer::RingBuffer};
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
/// * парсер переполнен.
///
/// # Аргументы
/// * `stdout` — piped stdout процесса ffmpeg.
/// * `active` — флаг активности reader'а.
/// * `destroyed` — флаг уничтожения движка.
/// * `pause_state` — состояние паузы (флаг + condvar).
/// * `buffer_state` — кольцевой буфер + condvar для ожидания места.
pub(crate) fn reader_loop(
    stdout: ChildStdout,
    active: Arc<AtomicBool>,
    destroyed: Arc<AtomicBool>,
    pause_state: Arc<(Mutex<bool>, Condvar)>,
    buffer_state: Arc<(Mutex<RingBuffer>, Condvar)>,
) {
    // Буферизованное чтение stdout — сглаживает мелкие чтения от ОС.
    let mut reader = BufReader::with_capacity(65536, stdout);

    // Демультиплексор Ogg/Opus, собирает аудио-пакеты из байтового потока.
    let mut parser = OggOpusDemuxer::new();

    // Буфер для одного чтения из stdout.
    let mut read_buf = [0u8; 16384];

    // Переиспользуемый вектор для парсинга (избегаем аллокаций в цикле).
    let mut frames = Vec::with_capacity(128);

    loop {
        // Проверка остановки: один из флагов мог быть сброшен извне.
        if !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire) {
            break;
        }

        // Обработка паузы.
        {
            let (lock, cvar) = &*pause_state;

            // Захватываем мьютекс паузы; при отравлении завершаем поток.
            let mut paused = match lock.lock() {
                Ok(g) => g,
                Err(_) => break,
            };

            // Ждём, пока пауза активна И движок не остановлен.
            // Возвращение из `wait` не гарантирует снятие паузы — может быть
            // сигнал от `notify_all` при уничтожении.
            while *paused
                && active.load(Ordering::Acquire)
                && !destroyed.load(Ordering::Acquire)
            {
                paused = match cvar.wait(paused) {
                    Ok(g) => g,
                    // При отравлении мьютекса выходим без разблокировки — состояние неважно.
                    Err(_) => return,
                };
            }
        }

        // Повторная проверка после паузы: флаги могли измениться,
        // пока поток спал на condvar.
        if !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire) {
            break;
        }

        // Чтение из ffmpeg.
        match reader.read(&mut read_buf) {
            Ok(0) => {
                // EOF: ffmpeg закрыл stdout.
                parser.cleanup();
                break;
            }
            Ok(n) => {
                // Защита от переполнения внутреннего буфера парсера —
                // если вход повреждён, не даём буферу расти бесконечно.
                if parser.pending_len() > MAX_PARSER_PENDING {
                    parser.cleanup();
                    frames.clear();
                    break;
                }

                // Парсим полученный фрагмент. Ошибка парсинга — фатальна.
                if parser.parse_internal(&read_buf[..n], &mut frames).is_err() {
                    parser.cleanup();
                    break;
                }

                // Получаем доступ к буферу под блокировкой.
                let (buffer_lock, buffer_cvar) = &*buffer_state;
                let mut buffer = buffer_lock.lock().unwrap();

                // Перебираем готовые пакеты из парсера.
                for (kind, packet) in frames.drain(..) {
                    // Пропускаем служебные пакеты (Head, Tags, OggPage).
                    if !kind.is_audio_frame() {
                        continue;
                    }

                    // Ждём свободное место в буфере, если он заполнен.
                    while buffer.is_full() {
                        // Проверяем флаги остановки, пока ждём место.
                        if !active.load(Ordering::Acquire)
                            || destroyed.load(Ordering::Acquire)
                        {
                            return;
                        }

                        // Ожидаем сигнала от consumer о появлении места.
                        buffer = match buffer_cvar.wait(buffer) {
                            Ok(b) => b,
                            Err(_) => return,
                        };
                    }

                    // Пытаемся добавить пакет. Ошибка (переполнение) —
                    // маловероятна, но фатальна для reader'а.
                    if buffer.push(packet).is_err() {
                        active.store(false, Ordering::Release);
                        return;
                    }
                }

                // Очищаем временный вектор для следующей итерации.
                frames.clear();
            }
            Err(_) => {
                // Ошибка чтения (например, stdin закрыт с ошибкой) — завершаем.
                parser.cleanup();
                break;
            }
        }
    }

    // Поток завершается — сбрасываем флаг активности, чтобы внешний код
    // знал, что reader больше не работает.
    active.store(false, Ordering::Release);

    // Очищаем парсер и освобождаем память временного вектора.
    parser.cleanup();
    frames.clear();
    frames.shrink_to_fit();
}