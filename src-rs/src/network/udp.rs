use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use napi_derive::napi;

use std::{
    collections::VecDeque,
    net::UdpSocket,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use crate::timers::cycle::{add_global_session, remove_global_session};

/// Максимальное количество пакетов, которое может храниться в очереди на отправку.
/// При превышении лимита самый старый пакет отбрасывается.
const MAX_BUFFER_ITEMS: usize = 1024 ;

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
    pub buffer: Mutex<VecDeque<Vec<u8>>>,

    /// Счётчик количества пакетов, которые не были отправлены из-за переполнения буфера
    /// или временной недоступности сокета (WouldBlock). Атомарный для потокобезопасности
    /// без блокировок.
    pub send_drops: AtomicUsize,
}

impl UdpBufferedInner {
    /// Добавляет пакет в очередь на отправку.
    ///
    /// Если очередь переполнена (достигнут MAX_BUFFER_ITEMS), удаляет самый старый пакет
    /// (pop_front) и увеличивает счётчик сброшенных пакетов.
    pub fn push(&self, data: Vec<u8>) {
        let mut buf = self.buffer.lock().unwrap();

        if buf.len() >= MAX_BUFFER_ITEMS {
            buf.pop_front(); // теряем самый старый пакет
            self.send_drops.fetch_add(1, Ordering::Relaxed);
        }

        buf.push_back(data);
    }

    /// Попытка отправить один пакет из очереди.
    ///
    /// Вызывается из тика CycleManager. Пытается захватить блокировку очереди без ожидания
    /// (try_lock), чтобы не блокировать цикл, если очередь занята другим потоком.
    /// Если отправка завершается ошибкой WouldBlock (сокет временно недоступен),
    /// пакет возвращается в начало очереди (push_front) для повторной попытки позже,
    /// и счётчик drops увеличивается. Любая другая ошибка также приводит к возврату пакета.
    pub fn tick(&self) {
        if let Ok(mut buf) = self.buffer.try_lock() {
            if let Some(data) = buf.pop_front() {
                match self.socket.send(&data) {
                    Ok(_) => {}

                    // Если очередь отправки сокета переполнена, возвращаем пакет обратно
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        buf.push_front(data); // повторная попытка в следующем тике
                        self.send_drops.fetch_add(1, Ordering::Relaxed);
                    }

                    // Любая другая ошибка (например, закрытый сокет) – тоже возвращаем пакет,
                    // хотя в дальнейшем он может быть отправлен, если ошибка временная.
                    Err(_) => {
                        buf.push_front(data);
                        self.send_drops.fetch_add(1, Ordering::Relaxed);
                    }
                }
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
    id: u32,
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
            buffer: Mutex::new(VecDeque::with_capacity(256)),
            send_drops: AtomicUsize::new(0),
        });

        // Генерируем случайный идентификатор для этой сессии.
        let id = rand::random::<u32>();

        let udp = Self {
            inner,
            listener_active: Arc::new(AtomicBool::new(false)),
            listener_handle: Arc::new(Mutex::new(None)),
            destroyed: Arc::new(AtomicBool::new(false)),
            id,
        };

        // Регистрируем сессию в глобальном балансировщике.
        // Передаём клон, специально подготовленный для менеджера (без listener_handle).
        add_global_session(id, Arc::new(udp.clone_for_manager()));

        Ok(udp)
    }

    /// Добавляет пакет в очередь на отправку.
    ///
    /// # Аргументы
    /// * `packet` - Buffer с данными для отправки.
    ///
    /// Если длина пакета меньше или равна 2, пакет игнорируется (эвристика для отсеивания
    /// пустых или служебных пакетов). В реальном приложении это может быть настроено.
    #[napi]
    pub fn push_packet(&self, packet: Buffer) {
        if !packet.is_empty() {
            self.inner.push(packet.as_ref().to_vec());
        }
    }

    /// Текущее количество пакетов в очереди на отправку.
    #[napi(getter)]
    pub fn packets(&self) -> u32 {
        self.inner.buffer.lock().unwrap().len() as u32
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
                        let _ = tsfn.call(data, ThreadsafeFunctionCallMode::NonBlocking);
                    }
                    // Если сокет временно недоступен (нет данных), немного спим.
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
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
        self.inner.buffer.lock().unwrap().clear();
        remove_global_session(self.id);
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
            id: self.id,
        }
    }

    /// Метод, вызываемый из CycleManager для отправки одного пакета из очереди.
    /// (Внутренний, не экспортируется в JS).
    pub fn tick(&self) {
        self.inner.tick();
    }

    /// Количество пакетов, сброшенных из-за переполнения очереди или временных ошибок.
    #[napi(getter)]
    pub fn drops(&self) -> u32 {
        self.inner.send_drops.load(Ordering::Relaxed) as u32
    }
}

/// При падении объекта автоматически вызывается destroy.
impl Drop for UdpBuffered {
    fn drop(&mut self) {
        self.destroy();
    }
}