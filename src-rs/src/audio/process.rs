use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy, ThreadSafeCallContext};
use crate::audio::parser::{OggOpusParser, PacketType};
use std::sync::atomic::{AtomicBool, Ordering};
use std::process::{Command, Child, Stdio};
use std::io::{BufReader, Read};
use std::sync::{Arc, Mutex};
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Представляет запущенный процесс FFmpeg с возможностью читать его stdout
/// и передавать аудио-фреймы в JavaScript через callback.
///
/// Процесс запускается с заданными аргументами, его stdout читается в фоновом потоке,
/// а разобранные фреймы Opus отправляются в JS. Гарантируется корректная очистка
/// ресурсов при уничтожении объекта
#[napi]
pub struct FfmpegProcess {
    /// Потоко-безопасная обёртка над дочерним процессом. Option позволяет забрать процесс
    /// при уничтожении, чтобы убить его и дождаться завершения
    child: Arc<Mutex<Option<Child>>>,

    /// Флаг, сигнализирующий фоновому потоку чтения о необходимости остановиться.
    /// Используется атомарный порядок доступа для минимизации блокировок
    reading_active: Arc<AtomicBool>,

    /// Handle фонового потока, который читает stdout FFmpeg и вызывает JS-вызов.
    /// Нужен для того, чтобы дождаться завершения потока при уничтожении
    reader_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,

    /// Флаг паузы, разделяемый между потоками
    paused: Arc<AtomicBool>
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
                    "-reconnect".to_string(), "1".to_string(),
                    "-reconnect_streamed".to_string(), "1".to_string(),
                    "-reconnect_delay_max".to_string(), "5".to_string(),
                    "-reconnect_on_network_error".to_string(), "1".to_string(),
                ];
                args.splice(pos..pos, reconnect_flags);
            }
        }

        // Базовые аргументы FFmpeg для низкой задержки и подавления видео
        let mut final_args = vec![
            "-analyzeduration".to_string(), "0".to_string(),
            "-probesize".to_string(), "128".to_string(),
            "-vn".to_string(),
            "-loglevel".to_string(),  "error".to_string(),
            "-nostdin".to_string(),       // не ждать ввода с stdin
            "-hide_banner".to_string(),   // скрыть баннер
        ];
        final_args.extend(args);

        let child = Command::new(name)
            .args(final_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to spawn ffmpeg: {}", e)))?;

        Ok(Self {
            child: Arc::new(Mutex::new(Some(child))),
            reading_active: Arc::new(AtomicBool::new(false)),
            reader_handle: Arc::new(Mutex::new(None)),
            paused: Arc::new(AtomicBool::new(false)), // Инициализация: не на паузе
        })
    }
    /// Устанавливает состояние паузы для аудиопотока.
    ///
    /// # Аргументы
    /// * `value` - true = приостановить воспроизведение, false = возобновить
    ///
    /// # Потокобезопасность
    /// Атомарная операция с барьером Release, безопасна для вызова из любого потока.
    /// При изменении паузы аудиопоток перестаёт отправлять пакеты в UDP-сокет,
    /// но продолжает потреблять данные из буфера (чтобы не терять синхронизацию).
    #[napi(setter)]
    pub fn set_pause(&self, value: bool) {
        // store с Release: все предыдущие записи (например, очистка буфера) завершены
        self.paused.store(value, Ordering::Release);
    }

    /// Возвращает текущее состояние паузы.
    ///
    /// # Возвращает
    /// `true` - воспроизведение приостановлено, `false` - активно.
    ///
    /// # Потокобезопасность
    /// Атомарное чтение с барьером Acquire, видит последнее значение,
    /// установленное через `set_pause` в любом потоке.
    #[napi(getter)]
    pub fn get_pause(&self) -> bool {
        // load с Acquire: гарантирует, что все предыдущие записи из сеттера видны
        self.paused.load(Ordering::Acquire)
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
        if self.reading_active.load(Ordering::Acquire) {
            return Err(Error::new(
                Status::GenericFailure,
                "Reading stdout already in progress".to_string(),
            ));
        }

        let mut child_guard = self.child.lock().unwrap();
        let stdout = child_guard
            .as_mut()
            .and_then(|c| c.stdout.take())
            .ok_or_else(|| Error::new(Status::GenericFailure, "Stdout already taken".to_string()))?;

        let tsfn: ThreadsafeFunction<Vec<(PacketType, Vec<u8>)>, ErrorStrategy::Fatal> = callback
            .create_threadsafe_function(1024, |ctx: ThreadSafeCallContext<Vec<(PacketType, Vec<u8>)>>| {
                let env = ctx.env;

                // Фильтруем входной вектор: оставляем только те элементы, где kind == PacketType::Frame
                let frames: Vec<_> = ctx
                    .value
                    .into_iter()
                    .filter(|(kind, _)| *kind == PacketType::Frame)
                    .collect();

                // Создаём JS-массив с длиной, равной количеству отфильтрованных элементов
                let mut js_array = env.create_array_with_length(frames.len())?;

                // Заполняем массив буферами
                for (i, (kind, data)) in frames.into_iter().enumerate() {
                    if kind == PacketType::Frame {
                        let buffer = env.create_buffer_with_data(data)?.into_unknown();
                        js_array.set_element(i as u32, buffer)?;
                    }
                }

                Ok(vec![js_array.into_unknown()])
            })?;

        self.reading_active.store(true, Ordering::Release);
        let active = Arc::clone(&self.reading_active);
        let paused = Arc::clone(&self.paused); // Клонируем Arc для потока

        let handle = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut buffer = [0u8; 16384];
            let mut parser = OggOpusParser::new();
            let mut batch: Vec<(PacketType, Vec<u8>)> = Vec::with_capacity(64);

            // Вспомогательная функция для отправки батча с логированием ошибок
            fn send_batch(
                tsfn: &ThreadsafeFunction<Vec<(PacketType, Vec<u8>)>, ErrorStrategy::Fatal>,
                batch: &mut Vec<(PacketType, Vec<u8>)>,
            ) -> bool {
                if batch.is_empty() {
                    return true;
                }
                let payload = std::mem::take(batch);
                match tsfn.call(payload, ThreadsafeFunctionCallMode::Blocking) {
                    Status::Ok => true,
                    err => {
                        eprintln!("Failed to send batch to JS: {:?}", err);
                        false
                    }
                }
            }

            // Основной цикл чтения с активным флагом
            while active.load(Ordering::Acquire) {
                // НОВОЕ: Если на паузе, просто спим и пропускаем итерацию
                if paused.load(Ordering::Acquire) {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    continue;
                }

                match reader.read(&mut buffer) {
                    Ok(0) => {
                        // EOF: выходим из цикла, чтобы выполнить финальный flush
                        break;
                    }
                    Ok(n) => {
                        let chunk = &buffer[..n];
                        let mut frames = Vec::with_capacity(16);
                        if let Err(e) = parser.parse_internal(chunk, &mut frames) {
                            eprintln!("Parser error: {}", e);
                            // Отправляем что накопили и выходим
                            send_batch(&tsfn, &mut batch);
                            break;
                        }
                        for frame in frames {
                            batch.push(frame);
                            if batch.len() >= 64 {
                                if !send_batch(&tsfn, &mut batch) {
                                    break;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("FFmpeg read error: {}", e);
                        send_batch(&tsfn, &mut batch);
                        break;
                    }
                }
            }

            // === ГАРАНТИРОВАННЫЙ FLUSH ВСЕХ УРОВНЕЙ ===
            // Убираем read_to_end! Если мы вышли по Ok(0), читать больше нечего.
            // Если вышли по active=false, читать дальше НЕЛЬЗЯ, иначе заблокируемся.

            // 1. Финализируем парсер: передаём пустой слайс
            let mut final_frames = Vec::new();
            if let Err(e) = parser.parse_internal(&[], &mut final_frames) {
                eprintln!("Final flush error: {}", e);
            }

            for frame in final_frames {
                batch.push(frame);
                if batch.len() >= 64 {
                    send_batch(&tsfn, &mut batch);
                }
            }

            // 2. Отправляем самый последний батч
            send_batch(&tsfn, &mut batch);

            // 3. ВАЖНО: Мы НЕ вызываем tsfn.abort()!
            // Когда переменная `tsfn` выйдет из области видимости (Drop), она корректно
            // завершит работу (napi_tsfn_release), сохранив очередь и отдав все пакеты в JS.
            active.store(false, Ordering::Release);
        });

        *self.reader_handle.lock().unwrap() = Some(handle);
        Ok(())
    }

    /// Принудительно завершает процесс FFmpeg и останавливает фоновый поток чтения.
    /// Этот метод вызывается автоматически при уничтожении объекта (Drop).
    /// Может быть вызван и в ручную из JS для явного освобождения ресурсов.
    #[napi]
    pub async fn destroy(&self) -> Result<()> {
        self.reading_active.store(false, Ordering::Release);
        
        // Закрываем stdout, и reader.read() в потоке мгновенно вернёт Ok(0).
        let child = {
            let mut guard = self.child.lock().unwrap();
            guard.take()
        };

        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }

        // Безопасно ждём завершения фонового потока.
        let handle = {
            let mut guard = self.reader_handle.lock().unwrap();
            guard.take()
        };

        if let Some(handle) = handle {
            let _ = handle.await;
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