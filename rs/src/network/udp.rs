use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use crate::timers::scheduler::balancer::{add_global_session, remove_global_session};
use crate::audio::ring_buffer::RingBuffer;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::{
    net::UdpSocket,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH}
};
use crate::timers::scheduler::cycle_manager::TICK_INTERVAL_MS;

/// Время до отправки keepalive пакета, для работы через NAT системы
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
        let last_ms = self.last_send_ms.load(Ordering::Relaxed);
        let count = ((now - last_ms) / TICK_INTERVAL_MS).clamp(1, 2);

        // Пробуем отправить хотя бы один пакет за тик
        for _ in 0..count {  // небольшой burst limit, чтобы не виснуть в одном session'е
            // Получаем аудио пакет для отправки
            let Some(packet) = self.buffer.pop()
            else { break; }; // Отменяем если нет данных в буфере

            match self.socket.send(&packet) {
                Ok(_) => {
                    self.counter.store(0, Ordering::Relaxed);
                    self.last_send_ms.store(now, Ordering::Relaxed);
                    // пакет успешно ушёл — продолжаем, вдруг есть ещё
                }
                Err(_e) => {
                    // Другие ошибки (NetworkUnreachable, InvalidInput и т.д.)
                    self.send_drops.fetch_add(1, Ordering::Relaxed);

                    // пакет потерян
                    #[cfg(debug_assertions)]
                    {
                        println!("UDP send error: {}", _e);
                    }
                    break; // не пытаемся дальше в этом тике
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
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
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

        socket.set_read_timeout(Some(Duration::from_millis(100)))
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
    pub fn push_packet(&self, packet: Uint8Array) {
        self.inner.push(packet.to_owned());
    }

    /// Добавляет несколько пакетов в очередь с проверкой мусора.
    ///
    /// # Аргументы
    /// * `packets` - массив Buffer с данными для отправки.
    #[napi]
    pub fn push_packets(&self, packets: Vec<Uint8Array>) {
        for packet in packets {
            self.inner.push(packet.to_owned());
        }
    }

    /// Начинает прослушивание входящих пакетов в отдельном потоке.
    ///
    /// # Аргументы
    /// * `callback` - JS-функция, которая будет вызываться при получении каждого пакета.
    ///   Функция получает один аргумент — Buffer с данными.
    ///
    /// Если прослушивание уже активно, метод ничего не делает.
    /// Поток работает, пока не будет вызван `stop_listening` или уничтожен объект.
    /// Для вызова из фонового потока используется ThreadsafeFunction.
    #[napi]
    pub fn start_listening(&self, callback: Function<Buffer, ()>) -> Result<()> {
        if self.listener_active.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let tsfn = callback.build_threadsafe_function().build()?;
        let socket = self.inner.socket.clone();
        let active = self.listener_active.clone();

        // Основной рабочий поток
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 2048];

            while active.load(Ordering::Relaxed) {
                match socket.recv(&mut buf) {
                    // Если сокет временно недоступен (нет данных), немного спим.
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // Поток будет спать сам
                    }
                    // Любая другая ошибка (например, сокет закрыт) завершает цикл.
                    Err(_) => break,
                    Ok(size) if size > 0 => {
                        let js_buffer = Buffer::from(buf[..size].as_ref());
                        tsfn.call(js_buffer, ThreadsafeFunctionCallMode::NonBlocking);
                    },
                    _ => {}
                }
            }

            drop(tsfn);
        });

        // Безопасное снятие блокировки с обработкой poisoning
        match self.listener_handle.lock() {
            Ok(mut lock) => { *lock = Some(handle); }
            Err(poisoned) => {
                let mut lock = poisoned.into_inner();
                *lock = Some(handle);
            }
        }

        Ok(())
    }

    /// Останавливает прослушивание входящих пакетов и дожидается завершения потока.
    #[napi]
    pub fn stop_listening(&self) {
        self.listener_active.store(false, Ordering::Relaxed);

        // Безопасное извлечение handle и ожидание завершения потока
        let handle = match self.listener_handle.lock() {
            Ok(mut lock) => lock.take(),
            Err(poisoned) => poisoned.into_inner().take()
        };

        if let Some(handle) = handle { let _ = handle.join(); }
    }

    /// Полностью уничтожает сессию: останавливает прослушивание, очищает очередь,
    /// удаляет себя из глобального балансировщика. Повторные вызовы игнорируются.
    #[napi]
    pub fn destroy(&self) {
        if self.destroyed.swap(true, Ordering::Relaxed) { return; }
        self.listener_active.store(false, Ordering::Relaxed);

        // Отключаем режим прослушивания UDP потока
        self.stop_listening();

        // Чистим данные в буфере
        self.inner.buffer.clear();

        // Отключаем UDP сессию от циклической системы
        remove_global_session(self.id);
    }

    /// Вычисляем когда надо отправить пакет или же надо догнать таймлайн
    pub fn process(&self, now: u64) {
        if self.inner.has_pending_packets() {
            // Если есть полезная нагрузка, отправляем её (сбросит таймер keepalive внутри)
            self.inner.tick(now);
        } else {
            // Если полезной нагрузки нет, проверяем, пора ли слать keepalive
            let last_ms = self.inner.last_send_ms.load(Ordering::Relaxed);
            if now.saturating_sub(last_ms) >= KEEP_ALIVE_INTERVAL {
                self.inner.tick_alive(now);
            }
        }
    }
}

/// При падении объекта автоматически вызывается destroy.
impl Drop for UdpBuffered {
    fn drop(&mut self) {
        self.destroy();
    }
}


/// Вспомогательная функция для получения текущего времени в мс
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}