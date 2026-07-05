use crate::audio::demuxers::ogg::{OggOpusDemuxer, PacketType};
use crate::audio::ring_buffer::RingBuffer;
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

// ============================================================================
// CONSTANTS
// ============================================================================
/// Максимальный размер внутреннего буфера парсера OggOpusParser (байт).
const MAX_PARSER_PENDING: usize = 8 * 1024 * 1024;

// ============================================================================
// AUDIO ENGINE
// ============================================================================

#[napi]
pub struct AudioEngine {
    /// FFmpeg child process.
    child: Arc<Mutex<Option<Child>>>,

    /// Флаг активности reader thread.
    reading_active: Arc<AtomicBool>,

    /// Флаг, что destroy уже отработал.
    destroyed: Arc<AtomicBool>,

    /// Хэндлер потока-читателя.
    reader_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,

    /// Пауза пользователя: (флаг, condvar).
    pause_state: Arc<(Mutex<bool>, Condvar)>,

    /// Кольцевой буфер пакетов, спаренный с Condvar для реализации автопаузы (backpressure).
    buffer: Arc<(Mutex<RingBuffer>, Condvar)>,

    /// Максимальная ёмкость буфера (количество пакетов).
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
            buffer: Arc::new((Mutex::new(RingBuffer::new(capacity)), Condvar::new())),
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

        let mut child = match Command::new(&ffmpeg_path)
            .args(&final_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                self.reading_active.store(false, Ordering::Relaxed);
                return Err(Error::from_reason(format!("FFmpeg spawn error: {}", e)));
            }
        };

        let stdout = match child.stdout.take() {
            Some(out) => out,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                self.reading_active.store(false, Ordering::Relaxed);
                return Err(Error::from_reason("Failed to open FFmpeg stdout"));
            }
        };

        *self.child.lock().unwrap() = Some(child);

        // ===== Reader thread =====
        // Клонируем Arc'и, чтобы передать в поток.
        let active = Arc::clone(&self.reading_active);
        let pause_state = Arc::clone(&self.pause_state);
        let buffer_ptr = Arc::clone(&self.buffer);

        let handle = thread::spawn(move || {
            // Буферизованный ридер: буфер 64KB уменьшает количество syscall'ов.
            let mut reader = BufReader::with_capacity(65536, stdout);
            let mut parser = OggOpusDemuxer::new();
            let mut read_buf = [0u8; 16384];

            // Используем векторы повторно, чтобы не аллоцировать на каждой итерации.
            let mut frames = Vec::with_capacity(64);
            let mut pending_push: Vec<bytes::Bytes> = Vec::with_capacity(128);

            // Внутри потока:
            loop {
                // Проверка внешнего флага остановки.
                if !active.load(Ordering::Relaxed) { break; }

                // ===== Пользовательская пауза =====
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
                        drop(parser);
                        drop(frames);
                        drop(pending_push);
                        break;
                    },
                    Ok(n) => {
                        if parser.pending_len() > MAX_PARSER_PENDING { break; }

                        frames.clear();

                        // Парсим Ogg страницы, извлекаем Opus пакеты.
                        if parser.parse_internal(&read_buf[..n], &mut frames).is_err() {
                            break;
                        }

                        pending_push.clear();

                        // Добавляем реальные Opus фреймы (PacketType::Frame или Silent) в pending_push.
                        pending_push.extend(
                            frames.drain(..).filter_map(|(kind, data)| match kind {
                                PacketType::Frame | PacketType::Silent => Some(data),
                                _ => None,
                            }),
                        );

                        // ===== Запись в кольцевой буфер с АВТОПАУЗОЙ =====
                        if !pending_push.is_empty() {
                            let (buffer_lock, buffer_cvar) = &*buffer_ptr;
                            let mut buffer = buffer_lock.lock().unwrap();

                            for packet in pending_push.drain(..) {
                                // Если буфер полон, поток засыпает на condvar, ожидая, пока JS заберет пакеты
                                while buffer.is_full() && active.load(Ordering::SeqCst) {
                                    buffer = buffer_cvar.wait(buffer).unwrap();
                                }

                                // Если во время ожидания поток попросили завершиться
                                if !active.load(Ordering::SeqCst) {
                                    break;
                                }

                                let _ = buffer.push(packet.to_vec());
                            }
                        }
                    }
                    Err(_) => {
                        drop(parser);
                        drop(frames);
                        drop(pending_push);
                        break;
                    },
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

        // Будим поток, если он на паузе
        {
            let (lock, cvar) = &*self.pause_state;
            *lock.lock().unwrap() = false;
            cvar.notify_all();
        }

        // Будим поток, если он заблокирован из-за переполнения буфера (автопаузы)
        {
            let (_, buffer_cvar) = &*self.buffer;
            buffer_cvar.notify_all();
        }

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
    // BUFFER INFO
    // =========================================================================

    #[napi(getter)]
    pub fn get_size(&self) -> u32 {
        self.buffer.0.lock().unwrap().len() as u32
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

    /// Выдать `count` пакетов за раз (уменьшает количество вызовов через FFI).
    #[napi]
    pub fn get_packets(&self, count: u32) -> Vec<Buffer> {
        let (buffer_lock, buffer_cvar) = &*self.buffer;
        let counter = {
            if count == 0 { 1 }
            else { count }
        };

        // Получение пакетов
        let raw_packets = {
            let buffer = buffer_lock.lock().unwrap();
            let limit = usize::min(counter as usize, buffer.len());
            let mut extracted = Vec::with_capacity(limit);

            // Получаем кол-во пакетов вместо 1
            buffer.pop_many(&mut extracted, limit);

            // Добавляем к позиции
            self.position.fetch_add(extracted.len(), Ordering::Relaxed);

            extracted
        };

        // notify вне lock (очень важно)
        if !raw_packets.is_empty() {
            buffer_cvar.notify_one();
        }

        // conversion stage отдельно (FFI boundary)
        let mut packets = Vec::with_capacity(raw_packets.len());

        // Преобразуем пакеты в Buffer
        for packet in raw_packets {
            packets.push(Buffer::from(packet));
        }

        packets
    }

    /// Клонировать пакет по абсолютной позиции (не извлекая).
    #[napi]
    pub fn get_packet_at(&self, idx: u32) -> Option<Buffer> {
        // Просто берем лок из кортежа
        let raw_packet = self.buffer.0.lock().unwrap().get_clone_at(idx as usize);
        raw_packet.map(Buffer::from)
    }

    // =========================================================================
    // MANUAL PUSH
    // =========================================================================

    /// Массовое добавление пакетов.
    #[napi]
    pub fn add_packets(&self, packets: Vec<Buffer>) {
        let buffer = self.buffer.0.lock().unwrap();

        for packet in packets {
            if buffer.is_full() { buffer.pop(); }
            let _ = buffer.push(packet.to_vec());
        }
    }

    // =========================================================================
    // BUFFER CONTROL
    // =========================================================================

    /// Проверка, есть ли место хотя бы для одного нового пакета.
    #[napi]
    pub fn can_accept(&self) -> bool {
        self.buffer.0.lock().unwrap().len() < self.max_capacity
    }

    /// Проверка, что заполненность буфера ниже указанного процента от max_capacity.
    /// Используется для backpressure из JavaScript.
    #[napi]
    pub fn can_accept_threshold(&self, threshold_percent: u32) -> bool {
        let threshold = (self.max_capacity * threshold_percent as usize) / 100;
        self.buffer.0.lock().unwrap().len() < threshold
    }

    /// Полная очистка буфера и сброс позиции.
    #[napi]
    pub fn clear(&self) {
        let (buffer_lock, buffer_cvar) = &*self.buffer;
        buffer_lock.lock().unwrap().clear();

        // Буфер пуст, места много — даем сигнал потоку проснуться
        buffer_cvar.notify_all();
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