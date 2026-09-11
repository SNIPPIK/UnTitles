use crate::structures::audio::{ring_buffer::RingBuffer, encoder::ogg::OggOpusDemuxer};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::{
    io::{BufReader, Read},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    thread::JoinHandle
};

/// Максимальный размер незавершённых данных в парсере Ogg (8 МБ).
/// Защищает от бесконечного роста при повреждённом входе.
const MAX_PARSER_PENDING: usize = 8 * 1024 * 1024;

/// Счётчик живых экземпляров AudioEngine (только в отладочных сборках).
#[cfg(debug_assertions)]
static AUDIO_ENGINE_ALIVE: AtomicUsize = AtomicUsize::new(0);

/// Движок аудио-буфера, связанный с процессом ffmpeg и потоком чтения.
#[napi]
pub struct AudioEngine {
    /// Дочерний процесс ffmpeg. Мьютекс нужен для безопасного доступа и kill.
    child: Mutex<Option<Child>>,

    /// Флаг активности потока чтения. true — поток работает.
    reading_active: Arc<AtomicBool>,

    /// Флаг уничтожения движка. После true дальнейшие операции запрещены.
    destroyed: Arc<AtomicBool>,

    /// Дескриптор потока чтения. Хранится в мьютексе для join при остановке.
    reader_handle: Mutex<Option<JoinHandle<()>>>,

    /// Состояние паузы: (флаг паузы, condvar для пробуждения).
    pause_state: Arc<(Mutex<bool>, Condvar)>,

    /// Кольцевой буфер с Opus-пакетами и condvar для уведомления о появлении места.
    buffer: Arc<(Mutex<RingBuffer>, Condvar)>,

    /// Максимальная ёмкость буфера (число пакетов).
    max_capacity: usize,

    /// Позиция чтения (количество извлечённых пакетов).
    position: Arc<AtomicUsize>
}

#[napi]
impl AudioEngine {
    /// Создаёт движок с буфером заданной ёмкости.
    ///
    /// Ёмкость рассчитывается как `50 * 60 * max_minutes` пакетов
    /// (50 пакетов/сек * 60 сек * минуты), но не менее 1500 пакетов (~30 секунд).
    ///
    /// # Аргументы
    /// * `max_minutes` — максимальная длительность аудио в минутах.
    #[napi(constructor)]
    pub fn new(max_minutes: u32) -> Self {
        // 50 пакетов/сек * 60 сек * минуты, минимум 1500.
        let capacity = (50u32 * 60 * max_minutes).max(1500) as usize;

        // Увеличиваем глобальный счётчик живых движков (только debug).
        #[cfg(debug_assertions)]
        AUDIO_ENGINE_ALIVE.fetch_add(1, Ordering::Relaxed);

        Self {
            child: Mutex::new(None),
            reading_active: Arc::new(AtomicBool::new(false)),
            destroyed: Arc::new(AtomicBool::new(false)),
            reader_handle: Mutex::new(None),
            pause_state: Arc::new((Mutex::new(false), Condvar::new())),
            buffer: Arc::new((Mutex::new(RingBuffer::new(capacity)), Condvar::new())),
            max_capacity: capacity,
            position: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Запускает ffmpeg и фоновый поток чтения.
    ///
    /// Для HTTP(S)-источников автоматически добавляет флаги авто-переподключения.
    /// К аргументам пользователя добавляется базовый набор флагов ffmpeg для
    /// минимальной задержки (`-analyzeduration 0`, `-probesize 32`, `-vn`,
    /// `-loglevel error`, `-nostdin`, `-hide_banner`).
    ///
    /// # Аргументы
    /// * `args` — аргументы командной строки для ffmpeg (без пути к бинарнику).
    /// * `ffmpeg_path` — путь к исполняемому файлу ffmpeg.
    ///
    /// # Ошибки
    /// Возвращает ошибку, если движок уже уничтожен, уже запущен,
    /// ffmpeg не удалось запустить или получить его stdout,
    /// либо не удалось создать поток чтения.
    #[napi]
    pub fn start(&self, mut args: Vec<String>, ffmpeg_path: String) -> Result<()> {
        // Проверка: движок уже уничтожен.
        if self.destroyed.load(Ordering::Acquire) {
            return Err(Error::from_reason("AudioEngine has been destroyed"));
        }

        // Проверка: движок уже запущен (атомарно выставляем reading_active = true).
        if self.reading_active.swap(true, Ordering::AcqRel) {
            return Err(Error::from_reason("Engine already running"));
        }

        // Если источник HTTP(S), добавляем флаги авто-переподключения перед "-i".
        if let Some(pos) = args.iter().position(|v| v == "-i") {
            if let Some(src) = args.get(pos + 1) {
                if src.starts_with("http") {
                    let reconnect = [
                        "-reconnect", "1",
                        "-reconnect_streamed", "1",
                        "-reconnect_delay_max", "5",
                        "-reconnect_on_network_error", "1",
                    ]
                        .iter()
                        .map(|s| s.to_string());
                    args.splice(pos..pos, reconnect);
                }
            }
        }

        // Формируем финальный список аргументов ffmpeg.
        let mut final_args = vec![
            "-analyzeduration".into(), "0".into(),
            "-probesize".into(), "32".into(),
            "-vn".into(),
            "-loglevel".into(), "error".into(),
            "-nostdin".into(),
            "-hide_banner".into(),
        ];
        final_args.extend(args);

        // Запускаем ffmpeg с piped stdout и заглушённым stderr.
        let mut child = match Command::new(&ffmpeg_path)
            .args(&final_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                self.reading_active.store(false, Ordering::Release);
                return Err(Error::from_reason(format!("FFmpeg spawn error: {}", e)));
            }
        };

        // Забираем stdout для чтения в потоке.
        let stdout = match child.stdout.take() {
            Some(out) => out,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                self.reading_active.store(false, Ordering::Release);
                return Err(Error::from_reason("Failed to open FFmpeg stdout"));
            }
        };

        // Сохраняем процесс; если движок уничтожили между spawn и сохранением — убиваем.
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

        // Клонируем Arc для передачи в поток.
        let active = Arc::clone(&self.reading_active);
        let destroyed = Arc::clone(&self.destroyed);
        let pause_state = Arc::clone(&self.pause_state);
        let buffer_state = Arc::clone(&self.buffer);

        // Поток чтения: читает stdout, парсит Ogg/Opus и складывает пакеты в буфер.
        let handle = thread::Builder::new()
            .name("audio-reader".into())
            .spawn(move || {
                // Буферизованное чтение stdout.
                let mut reader = BufReader::with_capacity(65536, stdout);
                // Демультиплексор Ogg/Opus.
                let mut parser = OggOpusDemuxer::new();
                // Буфер для чтения из stdout.
                let mut read_buf = [0u8; 16384];
                // Переиспользуемый вектор для парсинга.
                let mut frames = Vec::with_capacity(128);

                loop {
                    // Проверка остановки.
                    if !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire) {
                        break;
                    }

                    // Обработка паузы.
                    {
                        let (lock, cvar) = &*pause_state;
                        let mut paused = match lock.lock() {
                            Ok(g) => g,
                            Err(_) => break,
                        };
                        // Ждём, пока пауза не снята или не остановлен движок.
                        while *paused
                            && active.load(Ordering::Acquire)
                            && !destroyed.load(Ordering::Acquire)
                        {
                            paused = match cvar.wait(paused) {
                                Ok(g) => g,
                                Err(_) => return,
                            };
                        }
                    }

                    // Повторная проверка после паузы.
                    if !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire) {
                        break;
                    }

                    // Чтение из ffmpeg.
                    match reader.read(&mut read_buf) {
                        Ok(0) => {
                            // EOF от ffmpeg.
                            parser.cleanup();
                            break;
                        }
                        Ok(n) => {
                            // Защита от переполнения внутреннего буфера парсера.
                            if parser.pending_len() > MAX_PARSER_PENDING {
                                parser.cleanup();
                                frames.clear();
                                break;
                            }

                            // Парсим полученный фрагмент.
                            if parser.parse_internal(&read_buf[..n], &mut frames).is_err() {
                                parser.cleanup();
                                break;
                            }

                            // Получаем доступ к буферу.
                            let (buffer_lock, buffer_cvar) = &*buffer_state;
                            let mut buffer = buffer_lock.lock().unwrap();

                            // Перебираем готовые пакеты.
                            for (kind, packet) in frames.drain(..) {
                                // Пропускаем служебные пакеты.
                                if !kind.is_audio_frame() {
                                    continue;
                                }

                                // Ждём свободное место в буфере.
                                while buffer.is_full() {
                                    // Проверка остановки.
                                    if !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire) {
                                        return;
                                    }
                                    // Ожидаем сигнала от consumer.
                                    buffer = match buffer_cvar.wait(buffer) {
                                        Ok(b) => b,
                                        Err(_) => return,
                                    };
                                }

                                // Пытаемся добавить пакет.
                                if buffer.push(packet).is_err() {
                                    active.store(false, Ordering::Release);
                                    return;
                                }
                            }
                            frames.clear();
                        }
                        Err(_) => {
                            // Ошибка чтения — завершаем.
                            parser.cleanup();
                            break;
                        }
                    }
                }

                // Поток завершается — сбрасываем флаг активности.
                active.store(false, Ordering::Release);
            })
            .map_err(|e| {
                // Если не удалось создать поток — убиваем ffmpeg и сбрасываем флаги.
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

            // Если движок уничтожили между spawn и сохранением handle — очищаем ресурсы.
            if self.destroyed.load(Ordering::Acquire) {
                self.reading_active.store(false, Ordering::Release);
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

                // Ждём завершения потока.
                let _ = handle.join();

                return Err(Error::from_reason("AudioEngine destroyed during start"));
            }

            *guard = Some(handle);
        }

        Ok(())
    }

    /// Уничтожает движок. Идемпотентный.
    ///
    /// Если движок ещё не уничтожен, вызывает `force_destroy`.
    #[napi]
    pub fn destroy(&self) -> Result<()> {
        if !self.destroyed.load(Ordering::Acquire) {
            self.force_destroy();
        }

        Ok(())
    }

    // ============================================================
    // SIZE
    // ============================================================

    /// Возвращает текущее количество пакетов в буфере.
    #[napi(getter)]
    pub fn get_size(&self) -> u32 {
        self.buffer.0.lock().map(|b| b.len() as u32).unwrap_or(0)
    }

    // ============================================================
    // POSITION
    // ============================================================

    /// Возвращает текущую позицию чтения.
    #[napi(getter)]
    pub fn get_position(&self) -> u32 {
        self.position.load(Ordering::Acquire) as u32
    }

    /// Устанавливает позицию чтения.
    #[napi(setter)]
    pub fn set_position(&self, pos: u32) {
        self.position.store(pos as usize, Ordering::Release);
    }

    /// Извлекает до `count` пакетов из буфера за один вызов N-API.
    ///
    /// Если `count == 0`, извлекается один пакет. Возвращает вектор
    /// `Buffer` (длина может быть меньше запрошенной).
    /// Позиция чтения увеличивается на фактическое количество извлечённых пакетов.
    /// При извлечении будит поток чтения (если он ждал места).
    #[napi]
    pub fn get_packets(&self, count: u32) -> Vec<Buffer> {
        // Не работаем с уничтоженным движком.
        if self.destroyed.load(Ordering::Acquire) {
            return Vec::new();
        }

        let count = if count == 0 { 1 } else { count } as usize;

        let (buffer_lock, buffer_cvar) = &*self.buffer;

        // Извлекаем пакеты под блокировкой.
        let raw_packets = {
            let buffer = match buffer_lock.lock() {
                Ok(b) => b,
                Err(_) => return Vec::new(),
            };

            let limit = count.min(buffer.len());
            if limit == 0 {
                return Vec::new();
            }

            let mut extracted = Vec::with_capacity(limit);
            buffer.pop_many(&mut extracted, limit);

            // Обновляем позицию.
            if !extracted.is_empty() {
                self.position.fetch_add(extracted.len(), Ordering::Release);
            }

            extracted
        };

        // Уведомляем reader о появлении места (вне блокировки).
        if !raw_packets.is_empty() {
            buffer_cvar.notify_one();
        }

        // Конвертируем Vec<u8> в Buffer для JS.
        raw_packets.into_iter().map(Buffer::from).collect()
    }

    /// Добавляет пакеты в буфер из JavaScript.
    ///
    /// При заполнении буфера прекращает добавление, не бросая ошибку.
    /// После добавления уведомляет ожидающего читателя.
    #[napi]
    pub fn add_packets(&self, packets: Vec<Vec<u8>>) {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        let (buffer_lock, buffer_cvar) = &*self.buffer;
        let buffer = match buffer_lock.lock() {
            Ok(b) => b,
            Err(_) => return,
        };

        for packet in packets {
            if buffer.is_full() {
                break;
            }
            if buffer.push(packet).is_err() {
                return;
            }
        }

        // Уведомляем возможного ожидающего.
        buffer_cvar.notify_one();
    }

    /// Проверяет, есть ли место хотя бы для одного пакета.
    #[napi]
    pub fn can_accept(&self) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }
        self.buffer.0.lock().map(|b| b.len() < self.max_capacity).unwrap_or(false)
    }

    /// Проверяет, что заполненность буфера ниже указанного процента от `max_capacity`.
    ///
    /// Процент обрезается до 100. Полезно для управления backpressure.
    #[napi]
    pub fn can_accept_threshold(&self, threshold_percent: u32) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }
        // Ограничиваем процент до 100.
        let threshold = (self.max_capacity * threshold_percent.min(100) as usize) / 100;
        self.buffer.0.lock().map(|b| b.len() < threshold).unwrap_or(false)
    }

    /// Принудительно уничтожает движок: останавливает поток чтения,
    /// убивает ffmpeg, очищает буфер. Идемпотентный.
    ///
    /// Порядок действий:
    /// 1. Выставляет `destroyed = true`, защищая от повторного вызова.
    /// 2. Сбрасывает `reading_active`, чтобы поток вышел из цикла.
    /// 3. Убивает и дожидается ffmpeg (освобождает stdout).
    /// 4. Будит оба condvar, чтобы поток вышел из ожиданий.
    /// 5. Дожидается завершения потока чтения.
    /// 6. Очищает буфер.
    pub fn force_destroy(&self) {
        // Если уже уничтожен — выходим.
        if self.destroyed.swap(true, Ordering::AcqRel) {
            return;
        }

        // Останавливаем поток чтения.
        self.reading_active.store(false, Ordering::Release);

        // Убиваем ffmpeg.
        {
            let mut child = match self.child.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            if let Some(mut process) = child.take() {
                // Если процесс ещё не завершился, убиваем.
                if process.try_wait().ok().flatten().is_none() {
                    let _ = process.kill();
                }
                // Ждём завершения.
                let _ = process.wait();
            }
        }

        // Будим все ожидающие потоки.
        self.pause_state.1.notify_all();
        self.buffer.1.notify_all();

        // Ждём завершения потока чтения.
        {
            let mut handle = match self.reader_handle.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            if let Some(join) = handle.take() {
                let _ = join.join();
            }
        }

        // Очищаем буфер.
        {
            let buffer = match self.buffer.0.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            buffer.clear();
        }
    }
}

impl Drop for AudioEngine {
    fn drop(&mut self) {
        // Гарантированно освобождаем ресурсы.
        self.force_destroy();

        // Уменьшаем глобальный счётчик живых движков (debug).
        #[cfg(debug_assertions)]
        {
            let alive = AUDIO_ENGINE_ALIVE.fetch_sub(1, Ordering::Relaxed) - 1;
            eprintln!(
                "[AudioEngine] DROP | destroyed={} alive={}",
                self.destroyed.load(Ordering::Relaxed),
                alive
            );
        }
    }
}