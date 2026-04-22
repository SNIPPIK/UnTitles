use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use crate::timers::scheduler::balancer::{add_global_session, remove_global_session};
use crate::audio::ring_buffer::RingBuffer;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::{
    net::UdpSocket,
    time::{ SystemTime, UNIX_EPOCH },
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering, AtomicU64},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

/// Время до отправки keepalive пакета, для работы через nat системы
const KEEP_ALIVE_TIMEOUT: u64 = 5000;

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
    pub last_send_ms: AtomicU64
}

impl UdpBufferedInner {
    /// Добавляет пакет в очередь на отправку.
    ///
    /// Если очередь переполнена (достигнут MAX_BUFFER_ITEMS), удаляет самый старый пакет
    /// (pop_front) и увеличивает счётчик сброшенных пакетов.
    pub fn push(&self, data: Vec<u8>) {
        if self.buffer.push(data).is_err() {
            self.send_drops.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Проверка есть ли еще данные в кольцевом буфере
    ///
    /// Если нет буфера, то и нет смысла вызывать tick
    pub fn has_ticked(&self) -> bool {
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
        // Пробуем взять пакет
        if let Some(packet) = self.buffer.pop() {
            match self.socket.send(&packet) {
                Ok(_) => {
                    self.last_send_ms.store(now, Ordering::Relaxed);
                }
                Err(_) => {
                    self.send_drops.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    }

    /// Тот же tick, но для поддержания подключения через системы NAT
    ///
    /// Отправляем пакеты через KEEP_ALIVE_TIMEOUT интервалы
    pub fn tick_alive(&self, now: u64) {
        // Keep-alive логика
        let last_send = self.last_send_ms.load(Ordering::Relaxed);

        if now.saturating_sub(last_send) >= KEEP_ALIVE_TIMEOUT {
            // Стандартный тихий кадр Opus для Discord
            static SILENT_FRAME: [u8; 8] = [0u8; 8];

            if self.socket.send(&SILENT_FRAME).is_ok() {
                self.last_send_ms.store(now, Ordering::Relaxed);
            }
        }
    }
}

/// Буферизованный UDP-сокет, доступный из JavaScript через N-API.
///
/// Предоставляет методы для отправки дейтаграмм (с буферизацией), получения входящих
/// пакетов через вызов, а также статистику. Интегрируется с глобальным балансировщиком
/// CycleManager для регулярного вызова tick(), который отправляет накопленные пакеты.
///
/// Конструктор создаёт сокет, привязывается к случайному порту, подключается к указанному
/// удалённому адресу и регистрирует себя в глобальном балансировщике для автоматической
/// отправки.
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
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Устанавливаем соединение (фильтрует входящие пакеты только от этого адреса).
        socket
            .connect(&remote_addr)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Переводим в неблокирующий режим.
        socket.set_nonblocking(true).ok();

        let inner = Arc::new(UdpBufferedInner {
            socket: Arc::new(socket),
            buffer: RingBuffer::new(1024),
            send_drops: AtomicUsize::new(0),
            last_send_ms: AtomicU64::new(now_ms())
        });

        // Генерируем случайный идентификатор для этой сессии.
        let id = rand::random::<u32>();

        let udp = Self {
            inner,
            listener_active: Arc::new(AtomicBool::new(false)),
            listener_handle: Arc::new(Mutex::new(None)),
            destroyed: Arc::new(AtomicBool::new(false)),
            id
        };

        // Регистрируем сессию в глобальном балансировщике.
        // Передаём клон, специально подготовленный для менеджера (без listener_handle).
        add_global_session(id, Arc::new(udp.clone_for_manager()));

        Ok(udp)
    }

    /// Добавляет пакет в очередь на отправку. С проверкой мусора
    ///
    /// # Аргументы
    /// * `packet` - Buffer с данными для отправки.
    ///
    /// Если длина пакета будет равна 3, он будет проверен, допустим ли он!
    /// Если размер пакета более 3, то позволяем ему отправится в циклической системе
    #[napi]
    pub fn push_packet(&self, packet: Buffer) {
        self.try_push(packet.as_ref());
    }

    /// Добавляет несколько пакетов в очередь с проверкой мусора.
    ///
    /// # Аргументы
    /// * `packets` - массив Buffer с данными для отправки.
    #[napi]
    pub fn push_packets(&self, packets: Vec<Buffer>) {
        for packet in packets {
            self.try_push(packet.as_ref());
        }
    }

    /// Текущее количество пакетов в очереди на отправку.
    #[napi(getter)]
    pub fn packets(&self) -> usize {
        self.inner.buffer.len()
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
    pub fn start_listening(&self, callback: JsFunction) -> Result<()> {
        // Проверяем, не запущен ли уже поток.
        if self.listener_active.load(Ordering::SeqCst) {
            return Ok(());
        }

        self.listener_active.store(true, Ordering::SeqCst);

        // Создаём потоко-безопасную обёртку над JS-вызовом.
        let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| {
                // Преобразуем полученные данные в Buffer и передаём как единственный аргумент.
                ctx.env
                    .create_buffer_with_data(ctx.value)
                    .map(|b| vec![b.into_unknown()])
            })?;

        let socket = self.inner.socket.clone();
        let active = self.listener_active.clone();

        // Запускаем поток для чтения из сокета.
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 2048]; // буфер для входящих данных

            while active.load(Ordering::SeqCst) {
                match socket.recv(&mut buf) {
                    Ok(size) if size > 0 => {
                        let data = buf[..size].to_vec();
                        // Вызываем вызов
                        tsfn.call(data, ThreadsafeFunctionCallMode::NonBlocking);
                    }
                    // Если сокет временно недоступен (нет данных), немного спим.
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    // Любая другая ошибка (например, сокет закрыт) завершает цикл.
                    Err(_) => break,
                    _ => {}
                }
            }

            // Сообщаем JS-стороне, что больше данных не будет.
            let _ = tsfn.abort();
        });

        *self.listener_handle.lock().unwrap() = Some(handle);

        Ok(())
    }

    /// Останавливает прослушивание входящих пакетов и дожидается завершения потока.
    #[napi]
    pub fn stop_listening(&self) {
        self.listener_active.store(false, Ordering::Release);

        if let Some(handle) = self.listener_handle.lock().unwrap().take() {
            let _ = handle.join(); // дожидаемся завершения потока
        }
    }

    /// Полностью уничтожает сессию: останавливает прослушивание, очищает очередь,
    /// удаляет себя из глобального балансировщика. Повторные вызовы игнорируются.
    #[napi]
    pub fn destroy(&self) {
        // Предотвращаем повторное уничтожение.
        if self.destroyed.swap(true, Ordering::AcqRel) {
            return;
        }

        self.stop_listening();
        remove_global_session(self.id);
    }

    /// Пытается добавить байты во внутренний буфер для последующей отправки.
    #[inline]
    fn try_push(&self, bytes: &[u8]) {
        self.inner.push(bytes.to_vec());
    }

    /// Создаёт клон UdpBuffered, предназначенный для использования в менеджере (CycleManager).
    /// В таком клоне поле listener_handle не копируется (оно остаётся пустым), чтобы
    /// управление потоком прослушивания оставалось только у основного экземпляра.
    fn clone_for_manager(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            listener_active: self.listener_active.clone(),
            listener_handle: Arc::new(Mutex::new(None)), // новый пустой handle
            destroyed: self.destroyed.clone(),
            id: self.id
        }
    }

    /// Метод, вызываемый из CycleManager для отправки одного пакета из очереди.
    /// (Внутренний, не экспортируется в JS).
    pub fn tick(&self) {
        let now = now_ms();

        // Если есть пакеты для обычной отправки
        if self.inner.has_ticked() { self.inner.tick(now); }
        else { self.inner.tick_alive(now); }
    }

    /// Количество пакетов, сброшенных из-за переполнения очереди или временных ошибок.
    #[napi(getter)]
    pub fn drops(&self) -> usize { self.inner.send_drops.load(Ordering::Relaxed) }
}

/// При падении объекта автоматически вызывается destroy.
impl Drop for UdpBuffered {
    fn drop(&mut self) {
        self.destroy();
    }
}


/// Вспомогательная функция для получения текущего времени в мс
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}