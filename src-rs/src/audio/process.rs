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
            .stderr(Stdio::null())
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
        // Проверяем, не запущен ли уже поток чтения.
        // Acquire гарантирует, что мы увидим запись флага из другого потока.
        if self.reading_active.load(Ordering::Acquire) {
            return Err(Error::new(
                Status::GenericFailure,
                "Reading stdout already in progress".to_string(),
            ));
        }

        // Забираем stdout у дочернего процесса.
        // Захватываем мьютекс, чтобы получить эксклюзивный доступ к child.
        // `take()` забирает stdout из Option, оставляя там None – это гарантирует,
        // что только один поток (этот) будет владеть дескриптором.
        let mut child_guard = self.child.lock().unwrap();
        let stdout = child_guard
            .as_mut()
            .and_then(|c| c.stdout.take())
            .ok_or_else(|| Error::new(Status::GenericFailure, "Stdout already taken".to_string()))?;

        // Создаём потокобезопасную функцию для вызова JS-колбэка.
        // Тип данных, передаваемых в JS: массив объектов { type: string, data: Buffer }.
        // Второй аргумент `1024` – это размер очереди для отложенных вызовов,
        // если они будут производиться из фонового потока быстрее, чем JS успевает обрабатывать.
        let tsfn: ThreadsafeFunction<Vec<(PacketType, Vec<u8>)>, ErrorStrategy::Fatal> = callback
            .create_threadsafe_function(1024, |ctx: ThreadSafeCallContext<Vec<(PacketType, Vec<u8>)>>| {
                let env = ctx.env;

                // Создаём JS-массив, куда сложим все полученные пакеты.
                let mut js_array = env.create_array_with_length(ctx.value.len())?;

                for (i, (kind, data)) in ctx.value.into_iter().enumerate() {
                    let mut obj = env.create_object()?;

                    let kind_str = env.create_string(kind.as_str())?;
                    // `create_buffer_with_data` копирует данные в память, управляемую V8.
                    let buffer = env.create_buffer_with_data(data)?.into_unknown();

                    obj.set_named_property("type", kind_str)?;
                    obj.set_named_property("data", buffer)?;

                    js_array.set_element(i as u32, obj)?;
                }

                // Возвращаем массив как единственный аргумент колбэка.
                Ok(vec![js_array.into_unknown()])
            })?;

        // Устанавливаем флаг активности до запуска потока.
        // Release гарантирует, что все предыдущие записи (например, изменение child_guard)
        // будут видны в потоке чтения после загрузки флага с Acquire.
        self.reading_active.store(true, Ordering::Release);
        let active = Arc::clone(&self.reading_active);

        // Запускаем фоновый поток чтения.
        let handle = thread::spawn(move || {
            // Используем буферизированный reader для эффективного чтения.
            let mut reader = BufReader::new(stdout);
            let mut buffer = [0u8; 16384]; // 16 КБ – компромисс между частотой вызовов и задержкой.

            let mut parser = OggOpusParser::new();

            // Батчинг: накапливаем до 64 пакетов, чтобы уменьшить количество вызовов в JS.
            // Это снижает накладные расходы на переключение контекста и ускоряет обработку.
            let mut batch: Vec<(PacketType, Vec<u8>)> = Vec::with_capacity(64);

            while active.load(Ordering::Acquire) {
                match reader.read(&mut buffer) {
                    // Отправляем остаток
                    Ok(0) => {
                        if batch.len() > 0 {
                            // `std::mem::take` заменяет batch на пустой вектор,
                            // передавая содержимое во владение tsfn без копирования.
                            let send = std::mem::take(&mut batch);
                            let _ = tsfn.call(send, ThreadsafeFunctionCallMode::NonBlocking);
                            break;
                        }
                    },
                    Ok(n) => {
                        let chunk = &buffer[..n];

                        let mut frames: Vec<(PacketType, Vec<u8>)> = Vec::new();
                        if let Err(e) = parser.parse_internal(chunk, &mut frames) {
                            eprintln!("Parser error: {}", e);
                            break;
                        }

                        for frame in frames {
                            batch.push(frame);

                            // Когда накопилось достаточно пакетов, отправляем батч.
                            if batch.len() >= 64 {
                                // `std::mem::take` заменяет batch на пустой вектор,
                                // передавая содержимое во владение tsfn без копирования.
                                let send = std::mem::take(&mut batch);

                                // NonBlocking: если очередь вызовов переполнена, вызов не блокируется,
                                // а пакет отбрасывается (ErrorStrategy::Fatal не позволяет игнорировать ошибку,
                                // но в этом месте мы игнорируем результат `call`, что может привести к потере).
                                // Это компромисс: мы предпочитаем потерять несколько пакетов,
                                // чем блокировать поток чтения и создавать задержки.
                                let _ = tsfn.call(send, ThreadsafeFunctionCallMode::NonBlocking);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("FFmpeg read error: {}", e);
                        break;
                    }
                }
            }

            // После выхода из цикла отправляем оставшиеся пакеты (если есть).
            if !batch.is_empty() {
                let _ = tsfn.call(batch, ThreadsafeFunctionCallMode::NonBlocking);
            }

            // Уведомляем JS, что источник данных исчерпан.
            let _ = tsfn.abort();
            active.store(false, Ordering::Release);
        });

        // Сохраняем handle потока, чтобы потом дождаться его завершения.
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