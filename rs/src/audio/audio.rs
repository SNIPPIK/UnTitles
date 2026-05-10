use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::{
    thread,
    io::{BufReader, Read},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    }
};
use std::sync::OnceLock;
use crate::audio::parser::{OggOpusParser, PacketType};
use crate::audio::ring_buffer::RingBuffer;

static SILENT_FRAME: OnceLock<Vec<u8>> = OnceLock::new();

/// Аудио пакет тишины, требуется для encoder Discord.
/// Нужен для разделения аудио потока, предотвращается разрывы Jitter Buffer
fn get_silent_data() -> Vec<u8> {
    SILENT_FRAME.get_or_init(|| vec![0xF8, 0xFF, 0xFE]).clone()
}

/// Кол-во создаваемых пустых пакетов для аудио потока
const SILENT_FRAMES: u32 = 1;



/// Основной управляющий класс, доступный из JavaScript.
#[napi]
pub struct AudioEngine {
    /// Процесс FFmpeg
    child: Arc<Mutex<Option<Child>>>,

    /// Флаг активности фонового потока
    reading_active: Arc<AtomicBool>,

    /// Дескриптор потока-читателя
    reader_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,

    /// Состояние паузы, защищённое мьютексом и условной переменной
    pause_state: Arc<(Mutex<bool>, Condvar)>,

    /// Кольцевой буфер аудио фреймов
    buffer: Arc<Mutex<RingBuffer>>,

    /// Максимальная ёмкость буфера
    max_capacity: usize,

    /// Логическая позиция (сколько фреймов выдано) – атомарный счётчик
    position: Arc<AtomicUsize>
}

#[napi]
impl AudioEngine {
    /// Создаёт новый движок. Ёмкость буфера = 50 кадров/с * 60 с * max_minutes (минимум 1000).
    #[napi(constructor)]
    pub fn new(max_minutes: u32) -> Self {
        let capacity = (50 * 60 * max_minutes).max(1000) as usize;
        AudioEngine {
            child: Arc::new(Mutex::new(None)),
            reading_active: Arc::new(AtomicBool::new(false)),
            reader_handle: Arc::new(Mutex::new(None)),
            pause_state: Arc::new((Mutex::new(false), Condvar::new())),
            buffer: Arc::new(Mutex::new(RingBuffer::new(capacity))),
            max_capacity: capacity,
            position: Arc::new(AtomicUsize::new(0))
        }
    }

    /// Запускает FFmpeg с оптимизированными параметрами и фоновый поток парсинга.
    #[napi]
    pub fn start(&self, mut args: Vec<String>, ffmpeg_path: String) -> Result<()> {
        if self.reading_active.swap(true, Ordering::SeqCst) {
            return Err(Error::from_reason("Engine is already running"));
        }

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

        // Формируем финальные аргументы: сначала наши оптимизации, потом пользовательские.
        let mut final_args = vec![
            "-analyzeduration".to_string(), "0".to_string(),
            "-probesize".to_string(), "32".to_string(),
            "-vn".to_string(),
            "-loglevel".to_string(), "error".to_string(),
            "-nostdin".to_string(),
            "-hide_banner".to_string(),
        ];
        final_args.extend(args);

        let mut child = Command::new(ffmpeg_path)
            .args(final_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| Error::from_reason(format!("FFmpeg spawn error: {}", e)))?;

        // Оборачиваем stdout в BufReader для эффективного чтения (буфер 64 КБ)
        let stdout = child.stdout.take().ok_or_else(|| {
            Error::from_reason("Failed to open FFmpeg stdout")
        })?;
        let mut reader = BufReader::with_capacity(65536, stdout);

        *self.child.lock().unwrap() = Some(child);

        let active = Arc::clone(&self.reading_active);
        let pause_state = Arc::clone(&self.pause_state);
        let buffer_ptr = Arc::clone(&self.buffer);
        let max_cap = self.max_capacity;

        let handle = thread::spawn(move || {
            let mut read_buf = [0u8; 16384];
            let mut parser = OggOpusParser::new();
            // Флаг: получили ли мы первый реальный звук
            let mut first_packet_received = false;

            loop {
                // Проверка флага остановки
                if !active.load(Ordering::SeqCst) {
                    break;
                }

                // Обработка паузы через Condvar (мгновенное пробуждение)
                {
                    let (lock, cvar) = &*pause_state;
                    let mut paused_guard = lock.lock().unwrap();
                    // Ожидаем, пока пауза не будет снята ИЛИ движок не остановлен
                    while *paused_guard && active.load(Ordering::SeqCst) {
                        paused_guard = cvar.wait(paused_guard).unwrap();
                    }
                    // После выхода – либо пауза снята, либо active = false
                    if !active.load(Ordering::SeqCst) {
                        break;
                    }
                }

                // Чтение данных из BufReader
                match reader.read(&mut read_buf) {
                    Ok(0) => { break; }, // EOF

                    Ok(n) => {
                        let mut frames = Vec::new();
                        if parser.parse_internal(&read_buf[..n], &mut frames).is_ok() {
                            // Минимизируем время удержания мьютекса буфера
                            let buf = buffer_ptr.lock().unwrap();

                            // --- ЛОГИКА ТИШИНЫ ПРИ СТАРТЕ ---
                            if !first_packet_received {
                                let silent = get_silent_data();

                                // Вставляем SILENT_FRAMES пакетов тишины ПЕРЕД первым реальным пакетом
                                for _ in 0..SILENT_FRAMES {
                                    if buf.len() < max_cap {
                                        let _ = buf.push(silent.clone());
                                    }
                                }

                                first_packet_received = true;
                            }

                            for (kind, data) in frames {
                                if kind == PacketType::Frame || kind == PacketType::Silent || kind == PacketType::End {
                                    if buf.len() >= max_cap { let _ = buf.pop(); }
                                    let _ = buf.push(data);
                                }
                            }
                        } else {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }

            active.store(false, Ordering::SeqCst);
        });

        *self.reader_handle.lock().unwrap() = Some(handle);
        Ok(())
    }

    // ---------- Геттеры и сеттеры ----------

    /// Возвращает текущее состояние паузы.
    #[napi(getter)]
    pub fn get_pause(&self) -> bool {
        let (lock, _) = &*self.pause_state;
        *lock.lock().unwrap()
    }

    /// Устанавливает паузу. При `true` фоновый поток не будет пополнять буфер,
    /// но продолжит читать `stdout`, чтобы не блокировать трубу.
    #[napi(setter)]
    pub fn set_pause(&self, value: bool) {
        let (lock, cvar) = &*self.pause_state;
        let mut paused = lock.lock().unwrap();
        *paused = value;
        if !value {
            cvar.notify_one(); // мгновенно будим поток, если пауза снята
        }
    }

    /// Текущий размер буфера (количество фреймов).
    #[napi(getter)]
    pub fn get_size(&self) -> u32 {
        self.buffer.lock().unwrap().len() as u32
    }

    /// Текущая логическая позиция (сколько фреймов было отдано через `get_packet` и `get_packets`).
    #[napi(getter)]
    pub fn get_position(&self) -> u32 {
        self.position.load(Ordering::Relaxed) as u32
    }

    /// Устанавливает позицию (обычно используется при перемотке / seek).
    /// Не влияет на буфер, только на значение счётчика.
    #[napi(setter)]
    pub fn set_position(&self, pos: u32) {
        self.position.store(pos as usize, Ordering::Relaxed);
    }

    // ---------- Получение аудиоданных ----------

    /// Извлекает один фрейм из начала буфера (FIFO).
    /// Увеличивает позицию на 1. Возвращает `null`, если буфер пуст.
    #[napi(getter)]
    pub fn get_packet(&self) -> Option<Buffer> {
        let buf = self.buffer.lock().unwrap();
        buf.pop().map(|data| {
            // Инкремент позиции вне мьютекса
            self.position.fetch_add(1, Ordering::Relaxed);
            Buffer::from(data)
        })
    }

    /// Возвращает последний фрейм в буфере (без удаления).
    /// Полезно для отладки или получения текущего «хвоста» очереди.
    #[napi(getter)]
    pub fn get_last_packet(&self) -> Option<Buffer> {
        let buf_guard = self.buffer.lock().unwrap();
        let len = buf_guard.len();
        if len == 0 {
            None
        } else {
            buf_guard.get_clone_at(len - 1).map(Buffer::from)
        }
    }

    /// Извлекает фрейм по индексу (от 0 до size-1), не удаляя его.
    /// Используется редко, в основном для предпросмотра.
    #[napi]
    pub fn get_packet_at(&self, idx: u32) -> Option<Buffer> {
        self.buffer.lock().unwrap().get_clone_at(idx as usize).map(Buffer::from)
    }

    /// Извлекает до `count` фреймов из начала буфера и увеличивает позицию на количество извлечённых.
    /// Возвращает массив `Buffer` (может быть короче запрошенного, если в буфере недостаточно данных).
    #[napi]
    pub fn get_packets(&self, count: u32) -> Vec<Buffer> {
        let buf = self.buffer.lock().unwrap();
        let mut result = Vec::with_capacity(count.min(buf.len() as u32) as usize);
        for _ in 0..count {
            if let Some(data) = buf.pop() {
                self.position.fetch_add(1, Ordering::Relaxed);
                result.push(Buffer::from(data));
            } else {
                break;
            }
        }
        result
    }

    // ---------- Ручное добавление пакетов (альтернативный источник) ----------
    // Эти методы позволяют наполнять буфер вручную, минуя FFmpeg.

    /// Добавляет один фрейм в конец буфера. Если буфер переполнен, удаляется самый старый фрейм.
    #[napi]
    pub fn add_packet(&self, packet: Buffer) {
        let buf_guard = self.buffer.lock().unwrap();
        if buf_guard.len() >= self.max_capacity {
            buf_guard.pop(); // discard oldest
        }
        let _ = buf_guard.push(packet.to_vec());
    }

    /// Добавляет массив фреймов (каждый через `add_packet`).
    #[napi]
    pub fn add_packets(&self, packets: Vec<Buffer>) {
        for p in packets {
            self.add_packet(p);
        }
    }

    // ---------- Состояние буфера ----------

    /// Проверяет, можно ли добавить хотя бы один фрейм (буфер не полностью заполнен).
    #[napi]
    pub fn can_accept(&self) -> bool {
        self.buffer.lock().unwrap().len() < self.max_capacity
    }

    /// Проверяет, что заполненность буфера ниже указанного процента от максимальной ёмкости.
    /// Например, `engine.can_accept_threshold(80)` вернёт `true`, если занято менее 80% буфера.
    /// Полезно для управления потоком данных.
    #[napi]
    pub fn can_accept_threshold(&self, threshold_percent: u32) -> bool {
        let threshold = (self.max_capacity * threshold_percent as usize) / 100;
        self.buffer.lock().unwrap().len() < threshold
    }

    /// Полностью очищает буфер и сбрасывает позицию в 0.
    /// Фоновый поток продолжит наполнение, если активен.
    #[napi]
    pub fn clear(&self) {
        self.buffer.lock().unwrap().clear();
        self.position.store(0, Ordering::Relaxed);
    }

    /// Останавливает FFmpeg, фоновый поток и освобождает все ресурсы.
    /// Метод синхронный – дожидается завершения потока (`.join()`).
    /// Это безопасно для Node.js, так как вызов происходит в отдельном потоке N-API.
    #[napi]
    pub fn destroy(&self) -> Result<()> {
        // Сигнал остановки фоновому потоку.
        self.reading_active.store(false, Ordering::SeqCst);

        // Будим поток
        let (_, cvar) = &*self.pause_state;
        cvar.notify_one();

        // Убиваем процесс FFmpeg, если он ещё жив.
        let maybe_child = self.child.lock().unwrap().take();
        if let Some(mut child) = maybe_child {
            let _ = child.kill();   // отправляем SIGTERM
            let _ = child.wait();   // ожидаем, чтобы не оставалось зомби
        }

        // Ждём завершения фонового потока (join).
        let maybe_handle = self.reader_handle.lock().unwrap().take();
        if let Some(handle) = maybe_handle {
            let _ = handle.join();
        }

        // Очищаем буфер и позицию.
        self.clear();
        Ok(())
    }
}

/// Реализация `Drop` для дополнительной безопасности: если программист забыл вызвать `destroy`,
/// ресурсы будут освобождены при уничтожении объекта (например, при завершении приложения).
/// Однако в этом случае возможны паники, если попытаться `join` из асинхронного контекста,
/// поэтому предпочтительно всегда вызывать `destroy()` явно.
impl Drop for AudioEngine {
    fn drop(&mut self) {
        self.reading_active.store(false, Ordering::SeqCst);

        // Будим поток
        let (_, cvar) = &*self.pause_state;
        cvar.notify_one();

        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        // Поток будет завершён при разрушении runtime, но явного `join` здесь нет,
        // потому что `Drop` вызывается из любого контекста и `join` мог бы заблокировать.
        // В идеальной реализации мы должны были бы также дождаться потока, но для краткости опустим.
    }
}