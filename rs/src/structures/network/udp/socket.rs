use crate::structures::{
    audio::ring_buffer::RingBuffer,
    crypto::aes::VoiceRTPSocket,
    network::udp::inner_socket::SocketInner,
    timers::scheduler::{
        balancer::{ add_global_session, remove_global_session }
    }
};
use std::{
    io::ErrorKind,
    net::UdpSocket,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{ Duration }
};
use napi::{
    bindgen_prelude::{Buffer, Function, Error, Result},
    threadsafe_function::ThreadsafeFunctionCallMode
};
use napi_derive::napi;

/// Бактеризованный UDP-сокет, доступный из JavaScript через N-API.
#[napi(js_name = "UDPSocket")]
#[derive(Clone)]
pub struct SocketBuffered {
    /// Внутренние данные, разделяемые между клонами (например, для менеджера).
    inner: Arc<SocketInner>,

    /// Флаг активности потока, слушающего входящие пакеты.
    listener_active: Arc<AtomicBool>,

    /// Дескриптор потока для прослушивания входящих пакетов.
    listener_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,

    /// Флаг, указывающий, что объект был уничтожен (чтобы избежать повторного удаления).
    destroyed: Arc<AtomicBool>,

    /// Уникальный идентификатор сессии, используемый для регистрации в глобальном балансировщике
    id: u32
}

#[napi]
impl SocketBuffered {
    /// Создаёт новый UDP-сокет, подключается к указанному удалённому адресу и
    /// регистрируется в глобальном балансировщике.
    ///
    /// # Аргументы
    /// * `remote_addr` - адрес удалённого хоста в формате "ip:port" (например, "127.0.0.1:12345").
    ///
    /// Сокет создаётся с неблокирующим режимом (set_nonblocking(true)), чтобы операции
    /// send/recv не блокировали поток.
    #[napi(constructor)]
    pub fn new(remote_addr: String) -> Result<Self> {
        // Привязываемся к любому свободному порту на всех интерфейсах.
        let socket = UdpSocket::bind("0.0.0.0:0")
            .map_err(|e| Error::from_reason(format!("Bind error: {}", e)))?;

        socket.connect(&remote_addr)
            .map_err(|e| Error::from_reason(format!("Connect error: {}", e)))?;

        socket.set_read_timeout(Some(Duration::from_millis(20)))
            .map_err(|e| Error::from_reason(format!("Read timeout error: {}", e)))?;

        let inner = Arc::new(SocketInner {
            rtp: VoiceRTPSocket::new(),
            socket: Arc::new(socket),
            buffer: RingBuffer::new(2048),
            send_drops: AtomicUsize::new(0),
            last_send_ms: AtomicU64::new(0),
            keepalive_counter: AtomicU32::new(0),
            consecutive_failures: AtomicU32::new(0),
        });

        // Генерируем случайный идентификатор для этой сессии.
        let id = rand::random::<u32>();

        let udp = SocketBuffered {
            inner,
            listener_active: Arc::new(AtomicBool::new(false)),
            listener_handle: Arc::new(Mutex::new(None)),
            destroyed: Arc::new(AtomicBool::new(false)),
            id
        };

        // Регистрируем сессию в глобальном балансировщике.
        // Передаём клон, специально подготовленный для менеджера (без listener_handle).
        add_global_session(id, udp.clone());
        Ok(udp)
    }

    ///
    pub fn tick(&self, now: u64) {
        self.inner.auto_tick(now);
    }

    /// Инициализирует RTP-шифр с новым SSRC и ключом.
    /// Безопасен для повторного вызова при подключении.
    ///
    /// # Аргументы
    /// * `ssrc` — идентификатор источника синхронизации.
    /// * `key` — 32-байтовый ключ AES-256-GCM.
    #[napi(js_name = "initialize_rtp")]
    pub fn initialize_rtp(&self, ssrc: u32, key: Vec<u8>) -> Result<()> {
        self.inner.rtp.initialize(ssrc, key)
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    /// Текущее количество пакетов в очереди на отправку.
    #[napi(getter)]
    pub fn packets(&self) -> u32 {
        self.inner.buffer.len() as u32
    }

    /// Количество пакетов, сброшенных из-за переполнения очереди или временных ошибок.
    #[napi(getter)]
    pub fn drops(&self) -> u32 {
        self.inner.send_drops.load(Ordering::Relaxed) as u32
    }

    /// Добавляет пакет в очередь на отправку. С проверкой мусора.
    #[napi]
    pub fn push_packet(&self, packet: Buffer) {
        self.inner.push(packet.to_vec());
    }

    /// Добавляет несколько пакетов в очередь с проверкой мусора.
    ///
    /// # Аргументы
    /// * `packets` - массив Buffer с данными для отправки.
    #[napi]
    pub fn push_packets(&self, packets: Vec<Buffer>) {
        for packet in packets {
            self.inner.push(packet.to_vec());
        }
    }

    /// Формирует discovery-пакет для голосового соединения Discord и возвращает его
    /// в виде массива из одного элемента (`Buffer[]`).
    ///
    /// Discovery-пакет используется на начальном этапе установки голосового UDP-соединения
    /// и имеет фиксированный размер 74 байта. Структура пакета:
    ///
    /// # Аргументы
    /// - `ssrc` — 32-битный идентификатор источника синхронизации, уникальный для данного
    ///   голосового потока.
    ///
    /// # Возвращаемое значение
    /// `Vec<Buffer>` длины 1, содержащий сформированный discovery-пакет.
    /// Возврат вектора (а не одиночного `Buffer`) обеспечивает единообразие API
    /// с другими методами, возвращающими массивы пакетов (например, `packets`).
    #[napi]
    pub fn discovery(&self, ssrc: u32) {
        // Создаём буфер фиксированного размера (74 байта), заполненный нулями.
        let mut packet = vec![0u8; 74];

        // Записываем тип пакета: 1 (2 байта, big-endian).
        packet[0..2].copy_from_slice(&1u16.to_be_bytes());

        // Длина пакета: 70 (2 байта, big-endian).
        packet[2..4].copy_from_slice(&70u16.to_be_bytes());

        // SSRC: 4 байта, big-endian.
        packet[4..8].copy_from_slice(&ssrc.to_be_bytes());

        // Возвращаем вектор, содержащий единственный Buffer.
        self.inner.push(packet);
    }

    /// Запускает фоновый поток для приёма входящих UDP-пакетов.
    /// Каждый принятый пакет передаётся в JavaScript через `callback`.
    /// Если прослушивание уже активно, вызов игнорируется.
    #[napi]
    pub fn start_listening(&self, callback: Function<Buffer, ()>) -> Result<()> {
        // Устанавливаем флаг активности. Если он уже был true, значит поток уже работает — выходим.
        if self.listener_active.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        // Создаём потокобезопасную функцию для вызова JS из фонового потока.
        let js_fn = callback.build_threadsafe_function().build()?;

        // Клонируем сокет и флаг активности для передачи в поток.
        let socket = self.inner.socket.clone();
        let active = self.listener_active.clone();

        // Запускаем рабочий поток.
        let handle = thread::spawn(move || {
            // Буфер для приёма одного пакета.
            let mut buf = [0u8; 2048];

            // Основной цикл чтения, пока флаг активности установлен.
            while active.load(Ordering::Acquire) {
                match socket.recv(&mut buf) {
                    // Успешно получен пакет ненулевой длины.
                    Ok(size) if size > 0 => {
                        // Повторная проверка флага после блокирующего чтения.
                        if !active.load(Ordering::Acquire) {
                            break;
                        }

                        // Копируем данные в Buffer (владеющий) для передачи в JS.
                        let js_buffer = Buffer::from(buf[..size].to_vec());

                        // Не блокируя отправляем пакет в JS.
                        let _ = js_fn.call(
                            js_buffer,
                            ThreadsafeFunctionCallMode::NonBlocking,
                        );
                    }

                    // Ошибки "не готов" (неблокирующий сокет) — просто продолжаем цикл.
                    Err(ref e)
                    if e.kind() == ErrorKind::WouldBlock
                        || e.kind() == ErrorKind::TimedOut =>
                        {
                            continue;
                        }

                    // Любая другая ошибка — завершаем поток.
                    Err(_) => {
                        break;
                    }

                    // Пустой пакет — игнорируем.
                    _ => {}
                }
            }

            // Явно освобождаем threadsafe-функцию.
            drop(js_fn);
        });

        // Сохраняем JoinHandle для последующего join при остановке.
        match self.listener_handle.lock() {
            Ok(mut lock) => {
                *lock = Some(handle);
            }
            Err(poisoned) => {
                // Если мьютекс отравлен, всё равно сохраняем handle, используя into_inner.
                let mut lock = poisoned.into_inner();
                *lock = Some(handle);
            }
        }

        Ok(())
    }

    /// Останавливает прослушивание входящих пакетов и дожидается завершения потока.
    #[napi]
    pub fn stop_listening(&self) {
        // Сбрасываем флаг активности, чтобы поток вышел из цикла.
        self.listener_active.store(false, Ordering::Release);

        // Забираем JoinHandle из мьютекса, обрабатывая возможное отравление.
        let handle = match self.listener_handle.lock() {
            Ok(mut lock) => lock.take(),
            Err(poisoned) => {
                poisoned.into_inner().take()
            }
        };

        // Если поток был запущен, ждём его завершения.
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }

    /// Полная очистка ресурсов UDP-сессии.
    ///
    /// Метод идемпотентен: повторный вызов не выполняет действий.
    /// Останавливает прослушивание, очищает буфер, сбрасывает счётчик потерянных пакетов
    /// и удаляет сессию из глобального реестра.
    fn cleanup(&self) {
        // Атомарно устанавливаем флаг destroyed в true.
        // Если он уже был true, значит cleanup уже выполнялся — выходим.
        if self.destroyed.swap(true, Ordering::AcqRel) {
            return;
        }

        // Останавливаем фоновый поток приёма пакетов (если он был запущен).
        self.stop_listening();

        // Очищаем внутренний кольцевой буфер отправки.
        self.inner.buffer.clear();

        // Сбрасываем счётчик отброшенных пакетов (для статистики).
        self.inner.send_drops.store(0, Ordering::Relaxed);

        // Удаляем сессию из глобального менеджера циклов (больше не будет обрабатываться).
        remove_global_session(self.id);
    }

    /// Уничтожает сессию, вызывая `cleanup`.
    /// Метод доступен из JavaScript через N-API.
    #[napi]
    pub fn destroy(&self) {
        self.cleanup();
        self.inner.rtp.destroy();
    }
}


/// Деструктор для `UdpBuffered`.
///
/// Выполняет корректную остановку фонового потока приёма пакетов
/// и очистку буфера отправки. Гарантирует, что после уничтожения объекта
/// не останется активных потоков, удерживающих ссылки на ресурсы.
impl Drop for SocketBuffered {
    fn drop(&mut self) {
        // Останавливаем поток приёма: атомарно снимаем флаг активности.
        // Поток, находящийся в блокирующем `recv`, проснётся и выйдет из цикла.
        self.listener_active.store(false, Ordering::Release);

        // Забираем JoinHandle из мьютекса, обрабатывая возможное отравление.
        let handle = match self.listener_handle.lock() {
            Ok(mut lock) => lock.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        };

        // Если поток был запущен, дожидаемся его завершения, чтобы
        // избежать утечки ресурсов и гонок при освобождении памяти.
        if let Some(handle) = handle {
            let _ = handle.join();
        }

        // Очищаем внутренний кольцевой буфер отправки.
        // Это освобождает накопленные, но ещё не отправленные пакеты.
        self.inner.buffer.clear();
    }
}