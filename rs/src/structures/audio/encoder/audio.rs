use crate::structures::audio::{
    ring_buffer::RingBuffer,
    encoder::{
        demuxers::ogg::{OggOpusDemuxer, PacketType}
    }
};
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
    thread::{ JoinHandle }
};

// ============================================================================
// КОНСТАНТЫ
// ============================================================================

/// Максимальный размер внутреннего буфера парсера OggOpus (байт).
/// Защита от бесконечного накопления незавершённой Ogg-страницы.
const MAX_PARSER_PENDING: usize = 8 * 1024 * 1024; // 8 МБ

#[cfg(debug_assertions)]
static AUDIO_ENGINE_ALIVE: AtomicUsize = AtomicUsize::new(0);

// ============================================================================
// AUDIO ENGINE
// ============================================================================

/// Движок потокового аудио: запускает ffmpeg, читает и демультиплексирует
/// Ogg/Opus поток, складывает готовые пакеты в кольцевой буфер.
/// Предоставляет доступ к пакетам из JavaScript через N-API.
#[napi]
pub struct AudioEngine {
    /// Дочерний процесс ffmpeg.
    child: Arc<Mutex<Option<Child>>>,

    /// Флаг активности потока чтения. true — поток работает.
    reading_active: Arc<AtomicBool>,

    /// Флаг уничтожения движка. Блокирует дальнейшие операции.
    destroyed: Arc<AtomicBool>,

    /// JoinHandle потока чтения.
    reader_handle: Arc<Mutex<Option<JoinHandle<()>>>>,

    /// Состояние паузы: (флаг паузы, condvar для пробуждения).
    pause_state: Arc<(Mutex<bool>, Condvar)>,

    /// Кольцевой буфер с пакетами и condvar для уведомления о изменении.
    buffer: Arc<(Mutex<RingBuffer>, Condvar)>,

    /// Максимальная ёмкость буфера (в пакетах).
    max_capacity: usize,

    /// Позиция чтения (количество извлечённых пакетов).
    position: Arc<AtomicUsize>,
}

#[napi]
impl AudioEngine {
    /// Создаёт движок с буфером заданной ёмкости.
    ///
    /// Ёмкость = `50 * 60 * max_minutes`, но не менее 1500 пакетов (~30 сек).
    ///
    /// # Аргументы
    /// * `max_minutes` — максимальная длительность аудио в минутах.
    #[napi(constructor)]
    pub fn new(max_minutes: u32) -> Self {
        // 50 Opus-пакетов/сек * 60 секунд * минуты.
        // Минимум 1500 пакетов (~30 секунд).
        let capacity = (50u32 * 60 * max_minutes).max(1500) as usize;

        // Отладочный счётчик живых движков (только в debug-сборке).
        #[cfg(debug_assertions)]
        AUDIO_ENGINE_ALIVE.fetch_add(1, Ordering::Relaxed);

        Self {
            child: Arc::new(Mutex::new(None)),          // процесс ffmpeg, обёрнут в Arc<Mutex<Option<...>>>
            reading_active: Arc::new(AtomicBool::new(false)), // флаг активности потока чтения
            destroyed: Arc::new(AtomicBool::new(false)), // флаг уничтожения движка
            reader_handle: Arc::new(Mutex::new(None)),  // JoinHandle потока чтения
            pause_state: Arc::new((Mutex::new(false), Condvar::new())), // пауза + condvar
            buffer: Arc::new((
                Mutex::new(RingBuffer::new(capacity)), // кольцевой буфер
                Condvar::new(),                       // condvar для уведомлений о изменении буфера
            )),
            max_capacity: capacity,
            position: Arc::new(AtomicUsize::new(0)),   // позиция чтения (извлечённые пакеты)
        }
    }

    // ============================================================
    // START
    // ============================================================

    /// Запускает ffmpeg и поток чтения, который наполняет кольцевой буфер.
    ///
    /// # Аргументы
    /// * `args` — аргументы командной строки для ffmpeg (без пути к бинарнику).
    /// * `ffmpeg_path` — путь к исполняемому файлу ffmpeg.
    ///
    /// # Ошибки
    /// Возвращает ошибку, если:
    /// - движок уже уничтожен;
    /// - движок уже запущен;
    /// - не удалось запустить ffmpeg;
    /// - не удалось получить stdout;
    /// - не удалось создать поток чтения.
    #[napi]
    pub fn start(&self, mut args: Vec<String>, ffmpeg_path: String) -> Result<()> {
        // Нельзя запускать уничтоженный engine.
        if self.destroyed.load(Ordering::Acquire) {
            return Err(Error::from_reason(
                "AudioEngine has been destroyed",
            ));
        }

        // Engine одноразовый: предотвращаем повторный запуск.
        if self.reading_active.swap(true, Ordering::AcqRel) {
            return Err(Error::from_reason(
                "Engine already running",
            ));
        }

        // --------------------------------------------------------
        // HTTP reconnect
        // --------------------------------------------------------

        // Для HTTP-источников добавляем флаги автоматического переподключения.
        if let Some(pos) = args.iter().position(|v| v == "-i") {
            if let Some(src) = args.get(pos + 1) {
                if src.starts_with("http") {
                    let reconnect = [
                        "-reconnect",
                        "1",
                        "-reconnect_streamed",
                        "1",
                        "-reconnect_delay_max",
                        "5",
                        "-reconnect_on_network_error",
                        "1",
                    ]
                        .iter()
                        .map(|s| s.to_string());

                    args.splice(pos..pos, reconnect);
                }
            }
        }

        // --------------------------------------------------------
        // FFmpeg arguments
        // --------------------------------------------------------

        // Базовые флаги для минимальной задержки и тихого режима.
        let mut final_args = vec![
            "-analyzeduration".to_string(),
            "0".to_string(),

            "-probesize".to_string(),
            "32".to_string(),

            "-vn".to_string(),

            "-loglevel".to_string(),
            "error".to_string(),

            "-nostdin".to_string(),
            "-hide_banner".to_string(),
        ];

        final_args.extend(args);

        // --------------------------------------------------------
        // Spawn FFmpeg
        // --------------------------------------------------------

        let mut child = match Command::new(&ffmpeg_path)
            .args(&final_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,

            Err(error) => {
                self.reading_active.store(false, Ordering::Release);

                return Err(Error::from_reason(format!(
                    "FFmpeg spawn error: {}",
                    error
                )));
            }
        };

        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,

            None => {
                let _ = child.kill();
                let _ = child.wait();
                self.reading_active.store(false, Ordering::Release);

                return Err(Error::from_reason(
                    "Failed to open FFmpeg stdout",
                ));
            }
        };

        // Сохраняем процесс.
        {
            let mut guard = self.child.lock().unwrap();

            // Движок мог быть уничтожен во время подготовки.
            if self.destroyed.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();

                self.reading_active.store(false, Ordering::Release);

                return Err(Error::from_reason(
                    "AudioEngine was destroyed during start",
                ));
            }

            *guard = Some(child);
        }

        // --------------------------------------------------------
        // Reader state
        // --------------------------------------------------------

        let active = Arc::clone(&self.reading_active);
        let destroyed = Arc::clone(&self.destroyed);

        let pause_state = Arc::clone(&self.pause_state);
        let buffer_state = Arc::clone(&self.buffer);

        // --------------------------------------------------------
        // Reader thread
        // --------------------------------------------------------

        let handle = thread::Builder::new()
            .name("audio-reader".into())
            .spawn(move || {
                let mut reader = BufReader::with_capacity(65536, stdout);
                let mut parser = OggOpusDemuxer::new();
                let mut read_buf = [0u8; 16384];

                // Используемые буферы между итерациями.
                let mut frames = Vec::with_capacity(128);      // результат парсинга

                loop {
                    // ==================================================
                    // FAST EXIT
                    // ==================================================

                    if !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire) { break; }

                    // ==================================================
                    // PAUSE
                    // ==================================================

                    {
                        let (lock, cvar) = &*pause_state;

                        let mut paused = match lock.lock() {
                            Ok(guard) => guard,
                            Err(_) => break, // отравленный мьютекс — выход
                        };

                        // Ожидаем, пока не снимут паузу или не остановят/уничтожат движок.
                        while *paused
                            && active.load(Ordering::Acquire)
                            && !destroyed.load(Ordering::Acquire)
                        {
                            paused = match cvar.wait(paused) {
                                Ok(guard) => guard,
                                Err(_) => return,
                            };
                        }
                    }

                    // Повторная проверка после выхода из паузы.
                    if !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire) {
                        break;
                    }

                    // ==================================================
                    // READ FFmpeg
                    // ==================================================
                    match reader.read(&mut read_buf) {
                        Ok(0) => {
                            // EOF от ffmpeg.
                            parser.cleanup();
                            break;
                        }

                        Ok(n) => {
                            // Защита от бесконечного накопления незавершённой Ogg страницы.
                            if parser.pending_len() > MAX_PARSER_PENDING {
                                frames.clear();
                                break;
                            }

                            if parser.parse_internal(&read_buf[..n], &mut frames).is_err() {
                                parser.cleanup();
                                break;
                            }

                            let (buffer_lock, buffer_cvar) = &*buffer_state;
                            let mut buffer = buffer_lock.lock().unwrap();

                            // ==================================================
                            // PUSH INTO RING BUFFER
                            // ==================================================
                            for (kind, packet) in frames.drain(..) {
                                if !matches!(kind, PacketType::Frame | PacketType::Silent) {
                                    continue;
                                }

                                while buffer.is_full() {
                                    if !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire) { return; }

                                    buffer = match buffer_cvar.wait(buffer) {
                                        Ok(b) => b,
                                        Err(_) => return,
                                    };
                                }

                                if buffer.push(packet).is_err() {
                                    active.store(false, Ordering::Release);
                                    return;
                                }
                            }
                            frames.clear();
                        }

                        Err(_) => {
                            parser.cleanup();
                            break;
                        }
                    }
                }

                // ======================================================
                // READER EXIT
                // ======================================================

                // После выхода из цикла чтения сбрасываем флаг активности.
                active.store(false, Ordering::Release);
            })
            .map_err(|error| {
                // Если поток создать не удалось, убиваем ffmpeg и сбрасываем флаги.
                let mut child = {
                    match self.child.lock() {
                        Ok(mut guard) => guard.take(),
                        Err(_) => None,
                    }
                };

                if let Some(ref mut c) = child {
                    let _ = c.kill();
                    let _ = c.wait();
                }

                self.reading_active
                    .store(false, Ordering::Release);

                Error::from_reason(format!(
                    "Failed to spawn audio reader: {}",
                    error
                ))
            })?;

        // --------------------------------------------------------
        // Save reader handle
        // --------------------------------------------------------

        {
            let mut guard = self.reader_handle.lock().unwrap();

            // Между spawn и сохранением handle движок могли уничтожить.
            if self.destroyed.load(Ordering::Acquire) {
                self.reading_active.store(false, Ordering::Release);

                // Будим возможные ожидания, чтобы поток завершился.
                self.pause_state.1.notify_all();
                self.buffer.1.notify_all();

                drop(guard);

                // Убиваем ffmpeg.
                if let Ok(mut child_guard) = self.child.lock() {
                    if let Some(mut child) = child_guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }

                // Ждём завершения потока, чтобы избежать утечки.
                let _ = handle.join();

                return Err(Error::from_reason(
                    "AudioEngine destroyed during start",
                ));
            }

            *guard = Some(handle);
        }

        Ok(())
    }

    // ============================================================
    // DESTROY
    // ============================================================

    /// Уничтожает движок: останавливает поток чтения, убивает ffmpeg,
    /// очищает буфер. Идемпотентный.
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
        self.buffer
            .0
            .lock()
            .map(|buffer| buffer.len() as u32)
            .unwrap_or(0)
    }

    // ============================================================
    // POSITION
    // ============================================================

    /// Возвращает текущую позицию чтения.
    #[napi(getter)]
    pub fn get_position(&self) -> u32 {
        self.position
            .load(Ordering::Acquire) as u32
    }

    /// Устанавливает позицию чтения (перемотка).
    #[napi(setter)]
    pub fn set_position(&self, pos: u32) {
        self.position
            .store(pos as usize, Ordering::Release);
    }

    // ============================================================
    // GET PACKETS
    // ============================================================

    /// Извлекает до `count` пакетов из буфера за один вызов N-API.
    ///
    /// Возвращает вектор `Buffer`, готовый для передачи в JavaScript.
    /// Если пакетов меньше `count`, возвращает доступные.
    /// При `count == 0` извлекается 1 пакет.
    #[napi]
    pub fn get_packets(&self, count: u32) -> Vec<Buffer> {
        if self.destroyed.load(Ordering::Acquire) {
            return Vec::new();
        }

        let count = if count == 0 { 1 } else { count } as usize;
        let (buffer_lock, buffer_cvar) = &*self.buffer;
        let raw_packets = {
            let buffer = match buffer_lock.lock() {
                Ok(buffer) => buffer,
                Err(_) => return Vec::new(),
            };

            let limit = count.min(buffer.len());
            if limit == 0 { return Vec::new(); }

            let mut extracted = Vec::with_capacity(limit);

            buffer.pop_many(
                &mut extracted,
                limit,
            );

            if !extracted.is_empty() {
                self.position.fetch_add(
                    extracted.len(),
                    Ordering::Release,
                );
            }

            extracted
        };

        // Reader может быть заблокирован из-за полного буфера —
        // сообщаем, что место появилось.
        if !raw_packets.is_empty() {
            buffer_cvar.notify_one();
        }

        // Преобразование Vec<u8> в Buffer для передачи через FFI.
        raw_packets
            .into_iter()
            .map(Buffer::from)
            .collect()
    }

    // ============================================================
    // ADD PACKETS
    // ============================================================

    /// Массовое добавление пакетов из JavaScript в буфер.
    /// При переполнении добавление прекращается.
    #[napi]
    pub fn add_packets(&self, packets: Vec<Vec<u8>>) {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        let (buffer_lock, buffer_cvar) =
            &*self.buffer;

        let buffer = match buffer_lock.lock() {
            Ok(buffer) => buffer,
            Err(_) => return,
        };

        for packet in packets {
            // Не позволяем внешнему добавлению переполнить RingBuffer.
            if buffer.is_full() {
                break;
            }

            if buffer.push(packet).is_err() {
                return;
            }
        }

        // На случай, если reader ждал место.
        buffer_cvar.notify_one();
    }

    // ============================================================
    // CAN ACCEPT
    // ============================================================

    /// Проверяет, есть ли место хотя бы для одного нового пакета.
    #[napi]
    pub fn can_accept(&self) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        self.buffer
            .0
            .lock()
            .map(|buffer| {
                buffer.len() < self.max_capacity
            })
            .unwrap_or(false)
    }

    // ============================================================
    // CAN ACCEPT THRESHOLD
    // ============================================================

    /// Проверяет, что заполненность буфера ниже указанного процента от максимума.
    /// Процент обрезается до 100.
    #[napi]
    pub fn can_accept_threshold(&self, threshold_percent: u32) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        let threshold_percent = threshold_percent.min(100) as usize;
        let threshold = (self.max_capacity * threshold_percent) / 100;

        self.buffer
            .0
            .lock()
            .map(|buffer| {
                buffer.len() < threshold
            })
            .unwrap_or(false)
    }

    /// Принудительно уничтожает движок.
    /// Выполняет остановку потока чтения, убивает ffmpeg, очищает буфер.
    /// Идемпотентен.
    pub fn force_destroy(&self) {
        // Уже уничтожен — выходим.
        if self.destroyed.swap(true, Ordering::AcqRel) {
            return;
        }

        // Останавливаем reader.
        self.reading_active.store(false, Ordering::Release);

        // ============================================================
        // Убиваем FFmpeg.
        // Именно это гарантирует завершение blocking read().
        // ============================================================

        {
            let mut child = match self.child.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            if let Some(mut process) = child.take() {
                // Если процесс ещё жив — завершаем.
                if process.try_wait().ok().flatten().is_none() {
                    let _ = process.kill();
                }

                let _ = process.wait();
            }
        }

        // ============================================================
        // Будим все возможные ожидания.
        // ============================================================

        self.pause_state.1.notify_all();
        self.buffer.1.notify_all();

        // ============================================================
        // Ждём завершения reader thread.
        // ============================================================

        {
            let mut handle = match self.reader_handle.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            if let Some(join) = handle.take() {
                let _ = join.join();
            }
        }

        // ============================================================
        // Reader гарантированно завершён — очищаем буфер.
        // ============================================================

        {
            let buffer = match self.buffer.0.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            buffer.clear();
        }
    }
}

// ================================================================
// DROP
// ================================================================

impl Drop for AudioEngine {
    fn drop(&mut self) {
        self.force_destroy();
        
        #[cfg(debug_assertions)]
        {
            let alive = AUDIO_ENGINE_ALIVE.fetch_sub(1, Ordering::Relaxed) - 1;
            eprintln!(
                "[AudioEngine] DROP | destroyed={} alive={}",
                self.destroyed.load(Ordering::Relaxed),
                alive,
            );
        }
    }
}