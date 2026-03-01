use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy, ThreadSafeCallContext};
use napi_derive::napi;
use std::io::{BufReader, Read};
use std::process::{Command, Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

#[napi]
pub struct FfmpegProcess {
    child: Arc<Mutex<Option<Child>>>,
    reading_active: Arc<AtomicBool>,
    reader_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

#[napi]
impl FfmpegProcess {
    #[napi(constructor)]
    pub fn new(mut args: Vec<String>, name: String) -> Result<Self> {
        // Добавляем параметры переподключения для http источников прямо перед -i
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

        // Базовые аргументы для FFmpeg (low delay, no video)
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

    #[napi]
    pub fn pipe_stdout(&self, callback: JsFunction) -> Result<()> {
        // Предотвращаем повторный запуск
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
            .ok_or_else(|| Error::new(Status::GenericFailure, "Stdout already taken or process dead".to_string()))?;

        // Создаём потокобезопасную функцию
        let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> = callback
            .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<Vec<u8>>| {
                // Создаём Buffer из данных (копирование надёжнее)
                ctx.env
                    .create_buffer_copy(&ctx.value)
                    .map(|b| vec![b.into_unknown()])
                    .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create buffer: {}", e)))
            })?;

        self.reading_active.store(true, Ordering::Release);
        let active = Arc::clone(&self.reading_active);
        let handle = thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut buffer = [0u8; 16384];

            while active.load(Ordering::Acquire) {
                match reader.read(&mut buffer) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let data = buffer[..n].to_vec();
                        if data.is_empty() { continue; }

                        // Блокирующий вызов для гарантии доставки
                        match tsfn.call(data, ThreadsafeFunctionCallMode::Blocking) {
                            Status::Ok => {}
                            other => {
                                eprintln!("tsfn call failed: {:?}", other);
                                break;
                            }
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // В blocking-режиме это не должно происходить, но оставим для безопасности
                        thread::sleep(std::time::Duration::from_millis(1));
                    }
                    Err(e) => {
                        eprintln!("Error reading from ffmpeg stdout: {}", e);
                        break;
                    }
                }
            }
            // Явно уничтожаем ThreadsafeFunction, чтобы освободить ресурсы
            let _ = tsfn.abort();
            active.store(false, Ordering::Release);
        });

        *self.reader_handle.lock().unwrap() = Some(handle);
        Ok(())
    }

    #[napi]
    pub fn destroy(&self) -> Result<()> {
        // Сигнализируем потоку чтения остановиться
        self.reading_active.store(false, Ordering::Release);

        // Сначала убиваем процесс ffmpeg, чтобы разблокировать read() в потоке
        let mut child_guard = self.child.lock().unwrap();
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill();
            let _ = child.wait(); // дожидаемся завершения, избегаем зомби
        }
        drop(child_guard); // отпускаем блокировку

        // Теперь дожидаемся завершения потока чтения (он должен выйти из read() из-за закрытого stdout)
        if let Some(handle) = self.reader_handle.lock().unwrap().take() {
            let _ = handle.join();
        }

        Ok(())
    }
}

impl Drop for FfmpegProcess {
    fn drop(&mut self) {
        let _ = self.destroy();
    }
}