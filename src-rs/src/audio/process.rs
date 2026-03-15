use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy, ThreadSafeCallContext};
use napi_derive::napi;
use std::io::{BufReader, Read};
use std::process::{Command, Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use crate::audio::parser::{OggOpusParser, PacketType};

/// Представляет запущенный процесс FFmpeg с возможностью читать его stdout
/// и передавать аудио-фреймы в JavaScript через callback.
///
/// Процесс запускается с заданными аргументами, его stdout читается в фоновом потоке,
/// а разобранные фреймы Opus отправляются в JS. Гарантируется корректная очистка
/// ресурсов при уничтожении объекта.
#[napi]
pub struct FfmpegProcess {
    /// Потоко-безопасная обёртка над дочерним процессом. Option позволяет забрать процесс
    /// при уничтожении, чтобы убить его и дождаться завершения.
    child: Arc<Mutex<Option<Child>>>,

    /// Флаг, сигнализирующий фоновому потоку чтения о необходимости остановиться.
    /// Используется атомарный порядок доступа для минимизации блокировок.
    reading_active: Arc<AtomicBool>,

    /// Handle фонового потока, который читает stdout FFmpeg и вызывает JS-вызов.
    /// Нужен для того, чтобы дождаться завершения потока при уничтожении.
    reader_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

#[napi]
impl FfmpegProcess {
    /// Создаёт новый процесс FFmpeg.
    ///
    /// # Аргументы
    /// * `args` - список аргументов командной строки для FFmpeg
    /// * `name` - имя или путь к исполняемому файлу FFmpeg (обычно "ffmpeg")
    ///
    /// Автоматически добавляет параметры переподключения для HTTP-источников,
    /// а также базовые настройки для минимальной задержки и отключения видео.
    #[napi(constructor)]
    pub fn new(mut args: Vec<String>, name: String) -> Result<Self> {
        // Вставляем параметры переподключения прямо перед аргументом -i, если источник — http
        if let Some(pos) = args.iter().position(|r| r == "-i") {
            if args.get(pos + 1).map_or(false, |s| s.starts_with("http")) {
                let reconnect_flags = vec![
                    "-reconnect".to_string(),
                    "1".to_string(),
                    "-reconnect_streamed".to_string(),
                    "1".to_string(),
                    "-reconnect_delay_max".to_string(),
                    "5".to_string(),
                    "-reconnect_on_network_error".to_string(),
                    "1".to_string(),
                ];
                args.splice(pos..pos, reconnect_flags);
            }
        }

        // Базовые аргументы FFmpeg для низкой задержки и подавления видео
        let mut final_args = vec![
            "-analyzeduration".to_string(),
            "200".to_string(),
            "-probesize".to_string(),
            "32M".to_string(),
            "-vn".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
        ];
        final_args.extend(args);

        let child = Command::new(name)
            .args(final_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to spawn ffmpeg: {}", e)))?;

        Ok(Self {
            child: Arc::new(Mutex::new(Some(child))),
            reading_active: Arc::new(AtomicBool::new(false)),
            reader_handle: Arc::new(Mutex::new(None)),
        })
    }

    /// Начинает чтение stdout процесса и отправляет данные в JavaScript через callback.
    ///
    /// # Аргументы
    /// * `callback` - JS-функция, которая будет вызываться с двумя аргументами:
    ///   * `kind` - строка, описывающая тип данных (например, "opus_frame")
    ///   * `buffer` - ArrayBuffer с бинарными данными фрейма
    ///
    /// Чтение происходит в отдельном потоке. Данные буферизируются и парсятся
    /// в отдельные фреймы Opus с помощью `OggOpusParser`.
    #[napi]
    pub fn pipe_stdout(&self, callback: JsFunction) -> Result<()> {
        // Проверяем, не запущен ли уже поток чтения
        if self.reading_active.load(Ordering::Acquire) {
            return Err(Error::new(
                Status::GenericFailure,
                "Reading stdout already in progress".to_string(),
            ));
        }

        // Забираем stdout у дочернего процесса (Option::take, чтобы оставить только один владелец)
        let mut child_guard = self.child.lock().unwrap();
        let stdout = child_guard
            .as_mut()
            .and_then(|c| c.stdout.take())
            .ok_or_else(|| Error::new(Status::GenericFailure, "Stdout already taken".to_string()))?;

        // Создаём потоко-безопасную обёртку над JS-вызовом, которая будет вызываться из фонового потока
        let tsfn: ThreadsafeFunction<(&str, Vec<u8>), ErrorStrategy::Fatal> = callback
            .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<(&str, Vec<u8>)>| {
                let (kind, data) = ctx.value;

                // Преобразуем Rust-строку в JS-строку
                let type_str = ctx.env.create_string(&kind)?;
                // Копируем данные в JS-буфер
                let buffer = ctx.env.create_buffer_with_data(data)?;

                Ok(vec![
                    type_str.into_unknown(),
                    buffer.into_unknown(),
                ])
            })?;

        // Устанавливаем флаг активности до запуска потока
        self.reading_active.store(true, Ordering::Release);
        let active = Arc::clone(&self.reading_active);

        // Запускаем фоновый поток чтения
        let handle = thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut buffer = [0u8; 16384];  // 16 КБ буфер для чтения из stdout

            let mut parser = OggOpusParser::new();

            // Читаем, пока флаг активности установлен
            while active.load(Ordering::Acquire) {
                match reader.read(&mut buffer) {
                    Ok(0) => break,  // Конец потока (stdout закрыт)
                    Ok(n) => {
                        let chunk = &buffer[..n];

                        let mut frames: Vec<(PacketType, Vec<u8>)> = Vec::new();

                        // Парсим входные данные в отдельные фреймы Opus
                        if let Err(e) = parser.parse_internal(chunk, &mut frames) {
                            eprintln!("Parser error: {}", e);
                            break;
                        }

                        // Отправляем каждый фрейм в JS через threadsafe-функцию
                        for (kind, frame) in frames {
                            if tsfn.call((kind.as_str(), frame), ThreadsafeFunctionCallMode::Blocking) != Status::Ok {
                                break; // JS-окружение закрыто или ошибка — прекращаем
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("FFmpeg read error: {}", e);
                        break;
                    }
                }
            }

            // Сообщаем JS-стороне, что больше данных не будет
            let _ = tsfn.abort();
            active.store(false, Ordering::Release);
        });

        // Сохраняем handle потока, чтобы потом дождаться его завершения
        *self.reader_handle.lock().unwrap() = Some(handle);

        Ok(())
    }

    /// Принудительно завершает процесс FFmpeg и останавливает фоновый поток чтения.
    /// Этот метод вызывается автоматически при уничтожении объекта (Drop).
    /// Может быть вызван и в ручную из JS для явного освобождения ресурсов.
    #[napi]
    pub fn destroy(&self) -> Result<()> {
        // Сигнализируем фоновому потоку чтения остановиться
        self.reading_active.store(false, Ordering::Release);

        // Сначала убиваем процесс ffmpeg, чтобы разблокировать вызов read() в потоке
        let mut child_guard = self.child.lock().unwrap();
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill();    // Отправляем SIGKILL
            let _ = child.wait();    // Дожидаемся завершения, чтобы избежать зомби-процессов
        }
        drop(child_guard); // Освобождаем блокировку, чтобы поток мог завершиться

        // Теперь дожидаемся завершения фонового потока чтения
        if let Some(handle) = self.reader_handle.lock().unwrap().take() {
            let _ = handle.join();
        }

        Ok(())
    }
}

/// Реализация Drop гарантирует, что при выходе объекта из области видимости
/// процесс и фоновый поток будут корректно завершены.
impl Drop for FfmpegProcess {
    fn drop(&mut self) {
        let _ = self.destroy();
    }
}