use napi_derive::napi;
use crate::structures::{
    audio::ring_buffer::RingBuffer,
    timers::scheduler::{
        balancer::{add_global_session, remove_global_session}
    }
};
use napi::{
    bindgen_prelude::{Buffer, Function, Error, Result},
    threadsafe_function::ThreadsafeFunctionCallMode
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

/// Время до отправки keepalive пакета, для работы поверх NAT систем
const KEEP_ALIVE_INTERVAL: u64 = 10000;

/// Внутренние данные UDP-сокета с буфером исходящих пакетов и статистикой.
///
/// Хранит сам сокет (в Arc для разделения между несколькими экземплярами UdpBuffered,
/// которые могут быть клонированы для менеджера), очередь пакетов и счётчик сброшенных
/// пакетов (drops). Все методы работают с блокировкой очереди, но стараются минимизировать
/// время удержания блокировки.
pub struct UdpBufferedInner {
    /// Сокет UDP, обёрнутый в Arc для возможности разделения.
    pub socket: Arc<UdpSocket>,

    /// Очередь исходящих пакетов. Защищена мьютексом, так как используется из нескольких
    /// потоков: основной поток добавляет пакеты через push, а цикл тиков (в CycleManager)
    /// вызывает tick для отправки.
    pub buffer: RingBuffer,

    /// Счётчик количества пакетов, которые не были отправлены из-за переполнения буфера
    /// или временной недоступности сокета (WouldBlock). Атомарный для потокобезопасности
    /// без блокировок.
    pub send_drops: AtomicUsize,

    /// Последнее зафиксированное время отправки пакета
    pub last_send_ms: AtomicU64,

    /// Номер отправленного Keep-Alive пакета
    pub counter: AtomicU32
}

impl UdpBufferedInner {
    /// Добавляет пакет в очередь на отправку.
    pub fn push(&self, data: Vec<u8>) {
        if self.buffer.push(data).is_err() {
            self.send_drops.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Проверка, есть ли еще данные в кольцевом буфере и валиден ли сокет.
    pub fn has_pending_packets(&self) -> bool {
        !self.buffer.is_empty()
    }

    /// Попытка отправить один пакет из очереди.
    ///
    /// Вызывается из тика CycleManager. Пытается захватить блокировку очереди без ожидания
    /// (try_lock), чтобы не блокировать цикл, если очередь занята другим потоком.
    /// Если отправка завершается ошибкой WouldBlock (сокет временно недоступен),
    /// пакет возвращается в начало очереди (push_front) для повторной попытки позже,
    /// и счётчик drops увеличивается. Любая другая ошибка также приводит к возврату пакета.
    pub fn tick(&self, now: u64) {
        if let Some(packet) = self.buffer.pop() {
            match self.socket.send(&packet) {
                Ok(_) => {
                    self.counter.store(0, Ordering::Relaxed);
                    self.last_send_ms.store(now, Ordering::Relaxed);
                }
                Err(_e) => {
                    self.send_drops.fetch_add(1, Ordering::Relaxed);
                    #[cfg(debug_assertions)]
                    {
                        println!("UDP send error: {}", _e);
                    }
                }
            }
        }
    }

    /// Отправка keep-alive пакета для поддержания NAT.
    pub fn tick_alive(&self, now: u64) {
        let count = self.counter.fetch_add(1, Ordering::Relaxed);
        let mut keep_alive_packet = [0u8; 8];
        keep_alive_packet[0..4].copy_from_slice(&count.to_le_bytes());

        match self.socket.send(&keep_alive_packet) {
            Ok(_) => {
                self.last_send_ms.store(now, Ordering::Relaxed);
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                // keepalive не критичен, можно просто пропустить
            }
            Err(_e) => {
                #[cfg(debug_assertions)]
                {
                    println!("Keepalive send failed: {}", _e);
                }
            }
        }
    }
}

/// Бактеризованный UDP-сокет, доступный из JavaScript через N-API.
#[napi(js_name = "UDPSocket")]
#[derive(Clone)]
pub struct UdpBuffered {
    /// Внутренние данные, разделяемые между клонами (например, для менеджера).
    inner: Arc<UdpBufferedInner>,

    /// Флаг активности потока, слушающего входящие пакеты.
    listener_active: Arc<AtomicBool>,

    /// Дескриптор потока для прослушивания входящих пакетов.
    listener_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,

    /// Флаг, указывающий, что объект был уничтожен (чтобы избежать повторного удаления).
    destroyed: Arc<AtomicBool>,

    /// Уникальный идентификатор сессии, используемый для регистрации в глобальном балансировщике.
    id: u32
}

#[napi]
impl UdpBuffered {
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

        let inner = Arc::new(UdpBufferedInner {
            socket: Arc::new(socket),
            buffer: RingBuffer::new(2048),
            send_drops: AtomicUsize::new(0),
            last_send_ms: AtomicU64::new(0),
            counter: AtomicU32::new(0)
        });

        // Генерируем случайный идентификатор для этой сессии.
        let id = rand::random::<u32>();

        let udp = UdpBuffered {
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
    /// | Смещение | Размер (байт) | Описание                          |
    /// |----------|---------------|-----------------------------------|
    /// | 0..2     | 2             | Тип пакета (0x0001, big-endian)   |
    /// | 2..4     | 2             | Длина пакета (0x0046 = 70, big-endian) |
    /// | 4..8     | 4             | SSRC источника (big-endian)       |
    /// | 8..74    | 66            | Заполнитель (нули)                |
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
    pub fn discovery(&self, ssrc: u32) -> Vec<Buffer> {
        // Создаём буфер фиксированного размера (74 байта), заполненный нулями.
        let mut packet = vec![0u8; 74];
        
        // Записываем тип пакета: 1 (2 байта, big-endian).
        packet[0..2].copy_from_slice(&1u16.to_be_bytes());
        
        // Длина пакета: 70 (2 байта, big-endian).
        packet[2..4].copy_from_slice(&70u16.to_be_bytes());
        
        // SSRC: 4 байта, big-endian.
        packet[4..8].copy_from_slice(&ssrc.to_be_bytes());

        // Возвращаем вектор, содержащий единственный Buffer.
        let mut vec = Vec::with_capacity(1);
        vec.push(Buffer::from(packet));
        vec
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
        let tsfn = callback.build_threadsafe_function().build()?;

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

                        // Неблокирующе отправляем пакет в JS.
                        let _ = tsfn.call(
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
            drop(tsfn);
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
    }

    /// Определяет, что нужно отправить: накопленные пакеты или keepalive-сигнал.
    ///
    /// Вызывается циклически из глобального менеджера с текущим временем в миллисекундах.
    /// Если в очереди есть пакеты, отправляет их (внутренний `tick` также обновляет таймер keepalive).
    /// Иначе проверяет, не пора ли отправить keepalive (если с последней отправки прошло
    /// больше `KEEP_ALIVE_INTERVAL`).
    pub fn process(&self, now: u64) {
        // Проверяем, есть ли пакеты, ожидающие отправки.
        if self.inner.has_pending_packets() {
            // Отправляем накопленные пакеты (внутри также сбрасывается таймер keepalive).
            self.inner.tick(now);
        } else {
            // Если пакетов нет, проверяем время последней отправки.
            let last_ms = self.inner.last_send_ms.load(Ordering::Relaxed);

            // Если прошло достаточно времени, отправляем keepalive.
            if now.saturating_sub(last_ms) >= KEEP_ALIVE_INTERVAL {
                self.inner.tick_alive(now);
            }
        }
    }
}

/// Деструктор для `UdpBuffered`.
///
/// Выполняет корректную остановку фонового потока приёма пакетов
/// и очистку буфера отправки. Гарантирует, что после уничтожения объекта
/// не останется активных потоков, удерживающих ссылки на ресурсы.
impl Drop for UdpBuffered {
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

/// При падении объекта автоматически вызывается destroy.
impl Drop for UdpBufferedInner {
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        {
            use std::sync::atomic::Ordering;

            println!("====================");
            println!("UdpBufferedInner::drop");
            println!("send_drops={}", self.send_drops.load(Ordering::Relaxed));
            println!("last_send_ms={}", self.last_send_ms.load(Ordering::Relaxed));
            println!("keep_alive_counter={}", self.counter.load(Ordering::Relaxed));
            println!("buffer_len={}", self.buffer.len());
            //println!("buffer_cap={}", self.buffer.capacity());
            println!("socket_strong={}", Arc::strong_count(&self.socket));
            println!("UdpBufferedInner dropped");
            println!("====================");
        }
    }
}