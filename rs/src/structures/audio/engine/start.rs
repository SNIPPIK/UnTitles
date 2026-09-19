//! Запуск ffmpeg и фонового потока чтения.

use super::{
    constants::{FFMPEG_PREFIX, RECONNECT_FLAGS},
    reader::reader_loop,
    AudioEngine,
};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::{
    process::{Command, Stdio},
    sync::{atomic::Ordering, Arc},
    thread,
};
use std::sync::OnceLock;
use crate::structures::audio::engine::constants::{OUTPUT_SUFFIX_HEAD, OUTPUT_SUFFIX_TAIL};
use crate::structures::timers::scheduler::constants::TICK_INTERVAL_MS;

#[napi]
impl AudioEngine {
    /// Запускает ffmpeg и фоновый поток чтения.
    ///
    /// Для HTTP(S)-источников автоматически добавляет флаги авто-переподключения
    /// сразу после `-i <url>`. К аргументам пользователя добавляется базовый набор
    /// флагов ffmpeg для минимальной задержки (`FFMPEG_PREFIX`) и выходные флаги
    /// Opus/Ogg/pipe:1 (`OUTPUT_SUFFIX_HEAD`/`OUTPUT_SUFFIX_TAIL`).
    ///
    /// # Аргументы
    /// * `args` — аргументы командной строки для ffmpeg (без пути к бинарнику).
    /// * `ffmpeg_path` — путь к исполняемому файлу ffmpeg.
    ///
    /// # Возвращаемое значение
    /// `Ok(())`, если процесс ffmpeg запущен, stdout получен и поток чтения создан.
    ///
    /// # Ошибки
    /// - движок уже уничтожен;
    /// - движок уже запущен (`reading_active == true`);
    /// - не удалось запустить ffmpeg;
    /// - не удалось получить stdout;
    /// - не удалось создать поток чтения.
    #[napi]
    pub fn start(&self, args: Vec<String>, ffmpeg_path: String) -> Result<()> {
        // Проверка: движок уже уничтожен.
        if self.destroyed.load(Ordering::Acquire) {
            return Err(Error::from_reason("AudioEngine has been destroyed"));
        }

        // Атомарно занимаем флаг активности — защита от повторного запуска.
        if self.reading_active.swap(true, Ordering::AcqRel) {
            return Err(Error::from_reason("Engine already running"));
        }

        // Ищем позицию `-i http...` — только туда вставляем reconnect-флаги.
        // filter отбрасывает случаи, где после `-i` идёт локальный путь или флаг.
        let reconnect_pos = args
            .iter()
            .position(|v| v == "-i")
            .filter(|&p| args.get(p + 1).is_some_and(|s| s.starts_with("http")));

        // Собираем команду. Константные флаги передаются по ссылке на статику,
        // аргументы от Node.js — срезом, без промежуточных копий.
        let mut cmd = Command::new(&ffmpeg_path);
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::null())
            .args(FFMPEG_PREFIX);

        match reconnect_pos {
            Some(pos) => {
                // Аргументы до `-i`.
                cmd.args(&args[..pos]);
                // Reconnect-флаги ровно перед `-i`.
                cmd.args(RECONNECT_FLAGS);
                // Всё начиная с `-i`.
                cmd.args(&args[pos..]);
            }
            None => {
                // Обычный случай: локальный файл или источник без reconnect.
                cmd.args(&args);
            }
        }

        // Выходные флаги: Opus/Ogg/pipe:1 — всегда в самом конце команды.
        cmd.args(OUTPUT_SUFFIX_HEAD)
            .arg(opus_frame_size_str())
            .args(OUTPUT_SUFFIX_TAIL);

        // Запускаем ffmpeg с piped stdout и заглушённым stderr.
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                // При ошибке запуска освобождаем флаг активности.
                self.reading_active.store(false, Ordering::Release);
                return Err(Error::from_reason(format!("FFmpeg spawn error: {}", e)));
            }
        };

        // Забираем stdout для чтения в отдельном потоке.
        let stdout = match child.stdout.take() {
            Some(out) => out,
            None => {
                // Без stdout процесс бесполезен — убиваем и сбрасываем флаг.
                let _ = child.kill();
                let _ = child.wait();
                self.reading_active.store(false, Ordering::Release);
                return Err(Error::from_reason("Failed to open FFmpeg stdout"));
            }
        };

        // Сохраняем процесс. Если движок уничтожили между spawn и сохранением —
        // убиваем ffmpeg и выходим с ошибкой.
        {
            let mut guard = self.child.lock().unwrap();
            if self.destroyed.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();
                self.reading_active.store(false, Ordering::Release);
                return Err(Error::from_reason("AudioEngine was destroyed during start"));
            }
            *guard = Some(child);
        }

        // Клонируем Arc'и для передачи в поток чтения.
        let active = Arc::clone(&self.reading_active);
        let destroyed = Arc::clone(&self.destroyed);
        let pause_state = Arc::clone(&self.pause_state);
        let buffer_state = Arc::clone(&self.buffer);

        // Создаём поток чтения: он читает stdout, парсит Ogg/Opus и
        // складывает готовые пакеты в буфер.
        let handle = thread::Builder::new()
            .name("audio-reader".into())
            .spawn(move || reader_loop(stdout, active, destroyed, pause_state, buffer_state))
            .map_err(|e| {
                // Если поток не создан — убиваем ffmpeg и сбрасываем флаги.
                let mut child = match self.child.lock() {
                    Ok(mut g) => g.take(),
                    Err(_) => None,
                };
                if let Some(ref mut c) = child {
                    let _ = c.kill();
                    let _ = c.wait();
                }
                self.reading_active.store(false, Ordering::Release);
                Error::from_reason(format!("Failed to spawn audio reader: {}", e))
            })?;

        // Сохраняем handle потока.
        {
            let mut guard = self.reader_handle.lock().unwrap();

            // Если движок уничтожили между spawn и сохранением handle —
            // очищаем ресурсы в обратном порядке.
            if self.destroyed.load(Ordering::Acquire) {
                self.reading_active.store(false, Ordering::Release);
                // Будим возможные ожидания, чтобы поток завершился.
                self.pause_state.1.notify_all();
                self.buffer.1.notify_all();
                drop(guard);

                // Убиваем ffmpeg.
                if let Ok(mut cg) = self.child.lock() {
                    if let Some(mut c) = cg.take() {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                }

                // Дожидаемся завершения потока, чтобы не оставить висящий join-handle.
                let _ = handle.join();

                return Err(Error::from_reason("AudioEngine destroyed during start"));
            }

            *guard = Some(handle);
        }

        Ok(())
    }
}

/// Возвращает строковое представление размера Opus-фрейма (в мс),
/// равного интервалу тика планировщика.
///
/// Значение вычисляется один раз и кешируется через `OnceLock`,
/// чтобы избежать повторных аллокаций при каждом `start`.
fn opus_frame_size_str() -> &'static str {
    // Кеш на весь процесс: преобразование числа в строку делается ровно один раз.
    static VALUE: OnceLock<String> = OnceLock::new();
    VALUE.get_or_init(|| TICK_INTERVAL_MS.to_string())
}