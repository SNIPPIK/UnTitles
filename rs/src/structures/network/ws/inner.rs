use napi::{
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
    bindgen_prelude::*
};
use napi_derive::napi;
use parking_lot::Mutex;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU8},
        Arc
    }
};
use tokio::{
    task::JoinHandle,
    sync::mpsc
};
use tokio_tungstenite::tungstenite::Message;

/// Данные, передаваемые в JS при эмиссии события.
///
/// Содержит имя события, опциональную JSON-строку payload и опциональный
/// бинарный буфер. Поля опциональны, чтобы поддерживать разные типы событий
/// (текстовые, бинарные, без данных).
#[napi(object)]
pub struct EmitData {
    /// Имя события.
    pub event: String,

    /// Сериализованный JSON payload, если событие текстовое.
    pub payload: Option<String>,

    /// Бинарные данные, если событие бинарное.
    pub binary: Option<Buffer>,
}

/// Тип threadsafe-функции для одного JS-обработчика события.
///
/// Второй generic-параметр `Vec<serde_json::Value>` указывает, что JS-функция
/// принимает несколько позиционных аргументов, сформированных из этого вектора.
/// Флаг `false` в конце — «не callee-handled»: библиотека сама управляет
/// жизненным циклом функции.
pub type EventFn = ThreadsafeFunction<
    EmitData,
    (),
    Vec<serde_json::Value>,
    Status,
    false,
>;

/// Общее состояние WebSocket-клиента, разделяемое между JS-обёрткой
/// и Tokio-runtime.
///
/// Содержит канал отправки сообщений, отложенную очередь, атомарные флаги,
/// handles задач и таблицу зарегистрированных JS-обработчиков.
pub struct Inner {
    /// Канал отправки исходящих сообщений в runtime-задачу.
    /// `None`, пока соединение не установлено.
    pub ws_tx: Mutex<Option<mpsc::UnboundedSender<Message>>>,

    /// Очередь сообщений, накопленных до открытия соединения.
    pub queue: Mutex<Vec<Message>>,

    /// Последний полученный sequence. `-1` — ещё не получен.
    pub sequence: AtomicI64,

    /// Текущий статус соединения (код из `ws_status`).
    pub status: AtomicU8,

    /// Флаг готовности соединения (успешный handshake).
    pub ready: AtomicBool,

    /// Флаг уничтожения клиента.
    pub destroyed: AtomicBool,

    /// Флаг ожидания ACK на heartbeat.
    pub hb_pending: AtomicBool,

    /// Handle задачи heartbeat-цикла.
    pub hb_task: Mutex<Option<JoinHandle<()>>>,

    /// Handle задачи соединения.
    pub conn_task: Mutex<Option<JoinHandle<()>>>,

    /// Таблица JS-обработчиков: имя события → список threadsafe-функций.
    pub events: Mutex<HashMap<String, Vec<EventFn>>>,
}

impl Inner {
    /// Создаёт новое состояние в `Arc` с начальными значениями:
    /// статус `CLOSED`, seq `-1`, соединение и heartbeat не запущены.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            ws_tx: Mutex::new(None),
            queue: Mutex::new(Vec::new()),
            // -1 сигнализирует, что соединение ещё не получало seq.
            sequence: AtomicI64::new(-1),
            status: AtomicU8::new(crate::structures::network::ws::opcodes::ws_status::CLOSED),
            ready: AtomicBool::new(false),
            destroyed: AtomicBool::new(false),
            hb_pending: AtomicBool::new(false),
            hb_task: Mutex::new(None),
            conn_task: Mutex::new(None),
            events: Mutex::new(HashMap::new()),
        })
    }

    /// Вызывает событие во все зарегистрированные JS-обработчики.
    ///
    /// Клонирует `EmitData` для каждого обработчика, чтобы избежать
    /// перемещения владения. Вызовы выполняются в режиме `NonBlocking` —
    /// очередь JS-функции пополняется асинхронно, из runtime-потока.
    ///
    /// # Аргументы
    /// * `event` — имя события.
    /// * `payload_json` — сериализованный JSON-payload (если есть).
    /// * `binary` — бинарные данные (если есть).
    ///
    /// Если для события нет зарегистрированных обработчиков, вызов
    /// завершается без действий.
    pub fn emit(&self, event: &str, payload_json: Option<String>, binary: Option<Vec<u8>>) {
        // Захватываем таблицу обработчиков на время эмиссии.
        let events = self.events.lock();
        // Нет обработчиков — нечего делать.
        let Some(callbacks) = events.get(event) else { return; };

        // Копируем payload для каждого обработчика.
        for cb in callbacks {
            let data = EmitData {
                event: event.to_string(),
                payload: payload_json.clone(),
                binary: binary.as_ref().map(|b| Buffer::from(b.clone())),
            };
            // NonBlocking: ставим в очередь и не ждём выполнения JS.
            let _ = cb.call(data, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    /// Сериализует значение в JSON и вызываем его как событие.
    ///
    /// При ошибке сериализации payload заменяется на `"null"` —
    /// событие всё равно вызываем, чтобы JS-сторона могла отреагировать.
    ///
    /// # Аргументы
    /// * `event` — имя события.
    /// * `payload` — значение, реализующее `serde::Serialize`.
    pub fn emit_json<T: serde::Serialize>(&self, event: &str, payload: T) {
        // Сериализация с безопасным возвратом.
        let s = serde_json::to_string(&payload).unwrap_or_else(|_| "null".into());
        self.emit(event, Some(s), None);
    }
}