use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use napi_derive::napi;
use std::io::{BufReader, Read};
use std::process::{Command, Child, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

#[napi]
pub struct FfmpegProcess {
    // Используем Arc<Mutex>, чтобы безопасно делить процесс между потоком чтения и основным потоком
    child: Arc<Mutex<Option<Child>>>,
}

#[napi]
impl FfmpegProcess {
    #[napi(constructor)]
    pub fn new(mut args: Vec<String>, name: String) -> Result<Self> {
        // Логика проверки ссылок и добавления флагов переподключения
        if let Some(pos) = args.iter().position(|r| r == "-i") {
            if args.get(pos + 1).map_or(false, |s| s.starts_with("http")) {
                args.insert(0, "-reconnect".to_string());
                args.insert(1, "1".to_string());
                args.insert(2, "-reconnect_streamed".to_string());
                args.insert(3, "1".to_string());
                args.insert(4, "-reconnect_delay_max".to_string());
                args.insert(5, "1".to_string());
                args.insert(6, "-reconnect_on_network_error".to_string());
                args.insert(7, "1".to_string());
            }
        }

        // Базовые аргументы для FFmpeg (low delay, no video)
        let mut final_args = vec![
            "-analyzeduration".to_string(), "200".to_string(),
            "-probesize".to_string(), "32M".to_string(),
            "-vn".to_string(),
            "-loglevel".to_string(), "error".to_string(),
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
        })
    }

    #[napi]
    pub fn pipe_stdout(&self, callback: JsFunction) -> Result<()> {
        let mut child_guard = self.child.lock().unwrap();

        // Забираем stdout из процесса (take() делает его доступным только в одном месте)
        let stdout = child_guard.as_mut()
            .and_then(|c| c.stdout.take())
            .ok_or_else(|| Error::new(Status::GenericFailure, "Stdout already taken or process dead".to_string()))?;

        // Создаем потокобезопасную функцию для передачи чанков в JS
        let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> = callback
            .create_threadsafe_function(0, |ctx| {
                // Превращаем Vec<u8> из Rust в Buffer для Node.js
                ctx.env.create_buffer_with_data(ctx.value).map(|b| vec![b.into_unknown()])
            })?;

        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut buffer = [0u8; 16384]; // Читаем по 16KB для эффективности

            while let Ok(n) = reader.read(&mut buffer) {
                if n == 0 { break; }
                // Отправляем данные в Event Loop Node.js
                tsfn.call(buffer[..n].to_vec(), ThreadsafeFunctionCallMode::Blocking);
            }
        });

        Ok(())
    }

    #[napi]
    pub fn destroy(&self) -> Result<()> {
        let mut child_guard = self.child.lock().unwrap();
        // Если процесс еще существует — убиваем его
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill();
            //println!("FFmpeg process destroyed via Rust");
        }

        Ok(())
    }
}

#[napi]
pub fn find_ffmpeg(custom_paths: Vec<String>) -> Option<String> {
    let mut search_list = vec!["ffmpeg".to_string()];
    search_list.extend(custom_paths);

    for name in search_list {
        // Пытаемся запустить ffmpeg -h, чтобы проверить существование
        if Command::new(&name)
            .arg("-h")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            return Some(name);
        }
    }
    None
}