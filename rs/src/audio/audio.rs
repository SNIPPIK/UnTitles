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
/// Вставляется в начало потока, чтобы звуковая карта/декодер не щёлкали.
static SILENT_FRAME: &[u8] = &[0xF8, 0xFF, 0xFE];

/// Количество молчаливых фреймов перед первым реальным пакетом.
/// Даём время аудиосистеме стабилизироваться.
const SILENT_FRAMES: usize = 3;

/// Максимальный размер внутреннего буфера парсера OggOpusParser (байт).
/// Если парсер накопил больше – стрим битый, выходим.
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

    /// Логическая позиция воспроизведения (количество выданных наружу пакетов).
    /// Атомарная, инкрементируется при get_packet / get_packets.
    /// Не синхронизирована с буфером – может расходиться, если буфер очистили.
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
        // Почему 50? Opus в Ogg контейнере обычно идёт с частотой кадров 50 Гц (20 мс фреймы).
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
        // Атомарный swap: если уже true – повторный вызов start не разрешён.
        if self.reading_active.swap(true, Ordering::SeqCst) {
            return Err(Error::from_reason("Engine already running"));
        }

        self.destroyed.store(false, Ordering::SeqCst);

        // ===== HTTP source specific flags =====
        // Если входной URL начинается с http, добавляем параметры reconnect для FFmpeg.
        // Это позволяет переживать временные разрывы сети.
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

        // ===== Базовые аргументы FFmpeg =====
        // -analyzeduration 0 / -probesize 32 – минимальный анализ, быстрое начало.
        // -vn – отключаем видео.
        // -loglevel error – только ошибки, stdout чистый от логов.
        // -nostdin – запрещаем интерактивный ввод.
        let mut final_args = vec![
            "-analyzeduration",
            "0",
            "-probesize",
            "32",
            "-vn",
            "-loglevel",
            "error",
            "-nostdin",
            "-hide_banner",
        ]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>();

        final_args.extend(args);

        // ===== Запуск FFmpeg =====
        let mut child = Command::new(&ffmpeg_path)
            .args(&final_args)
            .stdout(Stdio::piped())    // читаем аудиоданные из stdout
            .stderr(Stdio::null())     // stderr игнорируем (в нём только логи)
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
        let max_cap = self.max_capacity;

        let handle = thread::spawn(move || {
            // Буферизованный ридер: буфер 64KB уменьшает количество syscall'ов.
            let mut reader = BufReader::with_capacity(65536, stdout);
            let mut parser = OggOpusParser::new();
            let mut read_buf = [0u8; 16384];
            let mut first_packet_received = false;

            // Используем векторы повторно, чтобы не аллоцировать на каждой итерации.
            let mut frames = Vec::with_capacity(64);
            let mut pending_push = Vec::with_capacity(128);

            loop {
                // Проверка внешнего флага остановки.
                if !active.load(Ordering::SeqCst) {
                    break;
                }

                // ===== Пауза =====
                // Condvar: ждём, пока флаг pause_state не станет false.
                // Важно: проверка active внутри цикла, чтобы при destroy мы могли выйти.
                {
                    let (lock, cvar) = &*pause_state;
                    let mut paused = lock.lock().unwrap();
                    while *paused && active.load(Ordering::SeqCst) {
                        paused = cvar.wait(paused).unwrap();
                    }
                    if !active.load(Ordering::SeqCst) {
                        break;
                    }
                }

                // ===== Чтение из FFmpeg =====
                match reader.read(&mut read_buf) {
                    Ok(0) => break, // EOF
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

                        // Первые SILENT_FRAMES пакетов – тишина, чтобы аудио успело инициализироваться.
                        if !first_packet_received {
                            for _ in 0..SILENT_FRAMES {
                                pending_push.push(SILENT_FRAME.to_vec());
                            }
                            
                            first_packet_received = true;
                        }

                        // Добавляем реальные Opus фреймы (PacketType::Frame или Silent) в pending_push.
                        pending_push.extend(
                            frames.drain(..).filter_map(|(kind, data)| match kind {
                                PacketType::Frame | PacketType::Silent => Some(data),
                                _ => None, // Комментарии, заголовки и прочее отбрасываем.
                            }),
                        );

                        // ===== Запись в кольцевой буфер =====
                        if !pending_push.is_empty() {
                            let buffer = buffer_ptr.lock().unwrap();
                            for packet in pending_push.drain(..) {
                                // Если буфер переполнен (len >= max_cap), выбрасываем самый старый пакет (pop).
                                // RingBuffer сам умеет отказывать при push, но здесь политика "drop oldest".
                                // Это костыль: в идеале проверять buffer.is_full() и не пушить, но мы перестраховываемся.
                                while buffer.len() >= max_cap {
                                    buffer.pop();
                                }
                                let _ = buffer.push(packet);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }

            // При выходе из цикла сбрасываем флаг активности.
            active.store(false, Ordering::SeqCst);
        });

        *self.reader_handle.lock().unwrap() = Some(handle);

        Ok(())
    }

    // =========================================================================
    // DESTROY
    // =========================================================================

    fn cleanup(&self) {
        // Защита от повторного вызова.
        if self.destroyed.swap(true, Ordering::SeqCst) {
            return;
        }

        // Сигнал потоку остановиться.
        self.reading_active.store(false, Ordering::SeqCst);

        // Пробуждение потока, если он висит на condvar (пауза).
        let (_, cvar) = &*self.pause_state;
        cvar.notify_all();

        // Убиваем FFmpeg процесс, если он ещё жив.
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait(); // ждём, чтобы не осталось зомби
            }
        }

        // Дожидаемся завершения reader thread.
        if let Ok(mut guard) = self.reader_handle.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }

        // Очищаем буфер от оставшихся данных.
        if let Ok(mut buffer) = self.buffer.lock() {
            buffer.clear();
        }

        // Сбрасываем логическую позицию.
        self.position.store(0, Ordering::Relaxed);
    }

    #[napi]
    pub fn destroy(&self) -> Result<()> {
        self.cleanup();
        Ok(())
    }

    // =========================================================================
    // PAUSE
    // =========================================================================

    #[napi(getter)]
    pub fn get_pause(&self) -> bool {
        let (lock, _) = &*self.pause_state;
        *lock.lock().unwrap()
    }

    #[napi(setter)]
    pub fn set_pause(&self, value: bool) {
        let (lock, cvar) = &*self.pause_state;
        let mut paused = lock.lock().unwrap();
        *paused = value;
        if !value {
            cvar.notify_all(); // если снимаем паузу – будим reader thread.
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
    // PACKETS
    // =========================================================================

    /// Выдать один пакет (FIFO). Если буфер не пуст – увеличиваем position.
    #[napi(getter)]
    pub fn get_packet(&self) -> Option<Buffer> {
        let buffer = self.buffer.lock().unwrap();
        buffer.pop().map(|packet| {
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
        if buffer.len() == 0 {
            return None;
        }
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
        let buffer = self.buffer.lock().unwrap();
        while buffer.len() >= self.max_capacity {
            buffer.pop();
        }
        let _ = buffer.push(packet.to_vec());
    }

    /// Массовое добавление пакетов.
    #[napi]
    pub fn add_packets(&self, packets: Vec<Buffer>) {
        let buffer = self.buffer.lock().unwrap();
        for packet in packets {
            while buffer.len() >= self.max_capacity {
                buffer.pop();
            }
            let _ = buffer.push(packet.to_vec());
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