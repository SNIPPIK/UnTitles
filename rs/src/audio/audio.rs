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
};

use crate::audio::parser::{OggOpusParser, PacketType};
use crate::audio::ring_buffer::RingBuffer;

// ============================================================================
// CONSTANTS
// ============================================================================

/// Opus silent frame (3 байта, код F8 FF FE – это не‑TLV, а конкретный паттерн для PLC).
/// Вставляется в начало и конец потока, чтобы звуковая карта/декодер не щёлкал.
static SILENT_FRAME: &[u8] = &[0xF8, 0xFF, 0xFE];

/// Количество молчаливых фреймов для стабилизации аудиосистемы.
const START_SILENT_FRAMES: usize = 5;
const END_SILENT_FRAMES: usize = 5;

/// Максимальный размер внутреннего буфера парсера OggOpusParser (байт).
const MAX_PARSER_PENDING: usize = 8 * 1024 * 1024;

// ============================================================================
// AUDIO ENGINE
// ============================================================================

#[napi]
pub struct AudioEngine {
    /// FFmpeg child process.
    /// Обёрнут в Mutex, потому что kill() вызывается из cleanup (drop / destroy), а чтение идёт из reader thread.
    child: Arc<Mutex<Option<Child>>>,

    /// Флаг активности reader thread. Выставляется в false при destroy() или при ошибке чтения.
    reading_active: Arc<AtomicBool>,

    /// Флаг, что destroy уже отработал. Предотвращает двойную очистку.
    destroyed: Arc<AtomicBool>,

    /// Хэндлер потока-читателя. Join-ится в cleanup.
    reader_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,

    /// Пауза: (флаг, condvar).
    /// Reader thread внутри цикла ожидает на condvar, пока флаг паузы не сбросится.
    pause_state: Arc<(Mutex<bool>, Condvar)>,

    /// Сам кольцевой буфер с пакетами Vec<u8>.
    /// Mutex нужен, потому что доступ идёт из reader thread (push) и из main thread (pop / get_packet).
    /// SPSC RingBuffer не поддерживает конкурентный доступ, поэтому внешний Mutex.
    buffer: Arc<Mutex<RingBuffer>>,

    /// Максимальная ёмкость буфера (количество пакетов).
    /// Передаётся в RingBuffer::new при создании.
    max_capacity: usize,

    /// Логическая позиция воспроизведения.
    position: Arc<AtomicUsize>
}

#[napi]
impl AudioEngine {
    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    #[napi(constructor)]
    pub fn new(max_minutes: u32) -> Self {
        // Расчёт ёмкости буфера: 50 пакетов/сек * 60 сек * минуты.
        // Ну и 1500 – минимальный размер буфера (чтобы не создавать слишком маленький).
        let capacity = (50 * 60 * max_minutes).max(1500) as usize;

        Self {
            child: Arc::new(Mutex::new(None)),
            reading_active: Arc::new(AtomicBool::new(false)),
            destroyed: Arc::new(AtomicBool::new(false)),
            reader_handle: Arc::new(Mutex::new(None)),
            pause_state: Arc::new((Mutex::new(false), Condvar::new())),
            buffer: Arc::new(Mutex::new(RingBuffer::new(capacity))),
            max_capacity: capacity,
            position: Arc::new(AtomicUsize::new(0))
        }
    }

    // =========================================================================
    // START
    // =========================================================================

    #[napi]
    pub fn start(&self, mut args: Vec<String>, ffmpeg_path: String) -> Result<()> {
        if self.reading_active.swap(true, Ordering::Relaxed) {
            return Err(Error::from_reason("Engine already running"));
        }

        self.destroyed.store(false, Ordering::Relaxed);

        // ===== HTTP source specific flags =====
        // Если входной URL начинается с http, добавляем параметры reconnect для FFmpeg.
        // Это позволяет переживать временные разрывы сети.
        if let Some(pos) = args.iter().position(|v| v == "-i") {
            if let Some(src) = args.get(pos + 1) {
                if src.starts_with("http") {
                    let reconnect = [
                        "-reconnect",                   "1",
                        "-reconnect_streamed",          "1",
                        "-reconnect_delay_max",         "5",
                        "-reconnect_on_network_error",  "1",
                    ]
                        .iter()
                        .map(|s| s.to_string());

                    args.splice(pos..pos, reconnect);
                }
            }
        }

        // ===== Базовые аргументы FFmpeg =====
        let mut final_args: Vec<String> = vec![
            "-analyzeduration",      "0",
            "-probesize",            "32",
            "-vn",
            "-loglevel",             "error",
            "-nostdin",
            "-hide_banner",
        ]
            .into_iter()
            .map(String::from)
            .collect();

        final_args.extend(args);

        // ===== Запуск FFmpeg =====
        let mut child = Command::new(&ffmpeg_path)
            .args(&final_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| Error::from_reason(format!("FFmpeg spawn error: {}", e)))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::from_reason("Failed to open FFmpeg stdout"))?;

        *self.child.lock().unwrap() = Some(child);

        // ===== Reader thread =====
        // Клонируем Arc'и, чтобы передать в поток.
        let active = Arc::clone(&self.reading_active);
        let pause_state = Arc::clone(&self.pause_state);
        let buffer_ptr = Arc::clone(&self.buffer);

        let handle = thread::spawn(move || {
            // Буферизованный ридер: буфер 64KB уменьшает количество syscall'ов.
            let mut reader = BufReader::with_capacity(65536, stdout);
            let mut parser = OggOpusParser::new();
            let mut read_buf = [0u8; 16384];
            let mut first_packet_received = false;

            // Используем векторы повторно, чтобы не аллоцировать на каждой итерации.
            let mut frames = Vec::with_capacity(64);
            let mut pending_push = Vec::with_capacity(128);

            // Внутри потока:
            loop {
                // Проверка внешнего флага остановки.
                if !active.load(Ordering::Relaxed) { break; }

                // ===== Пауза =====
                // Condvar: ждём, пока флаг pause_state не станет false.
                // Важно: проверка active внутри цикла, чтобы при destroy мы могли выйти.
                {
                    let (lock, cvar) = &*pause_state;
                    let mut paused = lock.lock().unwrap();
                    // Используем wait_timeout или проверяем активен ли поток после пробуждения
                    while *paused && active.load(Ordering::SeqCst) {
                        let result = cvar.wait_timeout(paused, std::time::Duration::from_millis(500)).unwrap();
                        paused = result.0;
                        // Если после пробуждения (или таймаута) поток стал неактивен — выходим
                        if !active.load(Ordering::SeqCst) { return; }
                    }
                }

                // ===== Чтение из FFmpeg =====
                match reader.read(&mut read_buf) {
                    Ok(0) => {
                        // Если поток не был закрыт принудительно, плавно завершаем его тишиной
                        if active.load(Ordering::Relaxed) {
                            let buffer = buffer_ptr.lock().unwrap();
                            for _ in 0..END_SILENT_FRAMES {
                                if buffer.is_full() { buffer.pop(); }
                                let _ = buffer.push(SILENT_FRAME.to_vec());
                            }
                        }
                        break; // Выходим из цикла, так как достигли конца файла/стрима
                    }
                    Ok(n) => {
                        // Защита от переполнения парсера: если накопилось слишком много сырых данных – битый стрим.
                        if parser.pending_len() > MAX_PARSER_PENDING {
                            break;
                        }

                        frames.clear();
                        // Парсим Ogg страницы, извлекаем Opus пакеты.
                        // parse_internal возвращает Result; ошибка – выходим из потока.
                        if parser.parse_internal(&read_buf[..n], &mut frames).is_err() {
                            break;
                        }

                        pending_push.clear();

                        // Первые SILENT_FRAMES пакетов – тишина в начале
                        if !first_packet_received {
                            for _ in 0..START_SILENT_FRAMES {
                                pending_push.push(SILENT_FRAME.to_vec());
                            }
                            
                            first_packet_received = true;
                        }

                        // Добавляем реальные Opus фреймы (PacketType::Frame или Silent) в pending_push.
                        pending_push.extend(
                            frames.drain(..).filter_map(|(kind, data)| match kind {
                                PacketType::Frame | PacketType::Silent => Some(data),
                                _ => None,
                            }),
                        );

                        // ===== Запись в кольцевой буфер =====
                        if !pending_push.is_empty() {
                            let buffer = buffer_ptr.lock().unwrap();

                            for packet in pending_push.drain(..) {
                                // Если буфер переполнен (len >= max_cap), выбрасываем самый старый пакет (pop).
                                if buffer.is_full() { buffer.pop(); }
                                let _ = buffer.push(packet);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }

            active.store(false, Ordering::Relaxed);
        });

        *self.reader_handle.lock().unwrap() = Some(handle);

        Ok(())
    }

    // =========================================================================
    // DESTROY & CLEANUP
    // =========================================================================

    fn cleanup(&self) {
        if self.destroyed.swap(true, Ordering::Relaxed) {
            return;
        }

        // Сигнал потоку остановиться.
        self.reading_active.store(false, Ordering::Relaxed);

        // Пробуждение потока, если он висит на condvar (пауза).
        {
            let (lock, cvar) = &*self.pause_state;
            *lock.lock().unwrap() = false;
            cvar.notify_all();
        }

        // Убиваем FFmpeg процесс, если он ещё жив.
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }

        // Дожидаемся завершения reader thread.
        let mut handle_guard = self.reader_handle.lock().unwrap();
        if let Some(handle) = handle_guard.take() {
            let _ = handle.join();
        }
    }

    #[napi]
    pub fn destroy(&self) -> Result<()> {
        self.cleanup();
        Ok(())
    }

    // =========================================================================
    // PAUSE & INFO
    // =========================================================================

    #[napi(getter)]
    pub fn get_pause(&self) -> bool {
        *self.pause_state.0.lock().unwrap()
    }

    #[napi(setter)]
    pub fn set_pause(&self, value: bool) {
        let (lock, cvar) = &*self.pause_state;
        let mut paused = lock.lock().unwrap();
        *paused = value;
        if !value {
            cvar.notify_all();
        }
    }

    // =========================================================================
    // BUFFER INFO
    // =========================================================================

    #[napi(getter)]
    pub fn get_size(&self) -> u32 {
        self.buffer.lock().unwrap().len() as u32
    }

    #[napi(getter)]
    pub fn get_position(&self) -> u32 {
        self.position.load(Ordering::Relaxed) as u32
    }

    #[napi(setter)]
    pub fn set_position(&self, pos: u32) {
        self.position.store(pos as usize, Ordering::Relaxed);
    }

    // =========================================================================
    // PACKETS GETTERS
    // =========================================================================

    /// Выдать один пакет (FIFO). Если буфер не пуст – увеличиваем position.
    #[napi(getter)]
    pub fn get_packet(&self) -> Option<Buffer> {
        let raw_packet = {
            let buffer = self.buffer.lock().unwrap();
            buffer.pop()
        };

        raw_packet.map(|packet| {
            self.position.fetch_add(1, Ordering::Relaxed);
            Buffer::from(packet)
        })
    }

    /// Выдать `count` пакетов за раз (уменьшает количество вызовов через FFI).
    #[napi]
    pub fn get_packets(&self, count: u32) -> Vec<Buffer> {
        let buffer = self.buffer.lock().unwrap();
        let mut packets = Vec::with_capacity(count.min(buffer.len() as u32) as usize);
        for _ in 0..count {
            match buffer.pop() {
                Some(packet) => {
                    self.position.fetch_add(1, Ordering::Relaxed);
                    packets.push(Buffer::from(packet));
                }
                None => break,
            }
        }
        packets
    }

    /// Клонировать самый свежий (последний) пакет без извлечения.
    /// Используется для визуализации текущего аудио или отладки.
    #[napi(getter)]
    pub fn get_last_packet(&self) -> Option<Buffer> {
        let buffer = self.buffer.lock().unwrap();
        if buffer.len() == 0 { return None; }

        // get_clone_at требует внешней синхронизации – но мы уже внутри Mutex, так что безопасно.
        buffer.get_clone_at(buffer.len() - 1).map(Buffer::from)
    }

    /// Клонировать пакет по абсолютной позиции (не извлекая).
    #[napi]
    pub fn get_packet_at(&self, idx: u32) -> Option<Buffer> {
        self.buffer
            .lock()
            .unwrap()
            .get_clone_at(idx as usize)
            .map(Buffer::from)
    }

    // =========================================================================
    // MANUAL PUSH
    // =========================================================================

    /// Ручное добавление пакета (для тестов, либо для прямого внедрения данных).
    /// При превышении max_capacity вытесняет старые пакеты (pop).
    #[napi]
    pub fn add_packet(&self, packet: Buffer) {
        let data = packet.to_vec();
        let buffer = self.buffer.lock().unwrap();

        // Если в буфере уже достигнут лимит
        if buffer.is_full() { buffer.pop(); }
        let _ = buffer.push(data);
    }

    /// Массовое добавление пакетов.
    #[napi]
    pub fn add_packets(&self, packets: Vec<Buffer>) {
        let raw_packets: Vec<Vec<u8>> = packets.iter().map(|p| p.to_vec()).collect();
        let buffer = self.buffer.lock().unwrap();

        for packet in raw_packets {
            if buffer.is_full() { buffer.pop(); }
            let _ = buffer.push(packet);
        }
    }

    // =========================================================================
    // BUFFER CONTROL
    // =========================================================================

    /// Проверка, есть ли место хотя бы для одного нового пакета.
    #[napi]
    pub fn can_accept(&self) -> bool {
        self.buffer.lock().unwrap().len() < self.max_capacity
    }

    /// Проверка, что заполненность буфера ниже указанного процента от max_capacity.
    /// Используется для backpressure из JavaScript.
    #[napi]
    pub fn can_accept_threshold(&self, threshold_percent: u32) -> bool {
        let threshold = (self.max_capacity * threshold_percent as usize) / 100;
        self.buffer.lock().unwrap().len() < threshold
    }

    /// Полная очистка буфера и сброс позиции.
    #[napi]
    pub fn clear(&self) {
        self.buffer.lock().unwrap().clear();
        self.position.store(0, Ordering::Relaxed);
    }
}

// ============================================================================
// DROP
// ============================================================================

impl Drop for AudioEngine {
    fn drop(&mut self) {
        self.cleanup();
    }
}