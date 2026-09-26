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
///
/// Примечание: поле `event` в текущей реализации `on()` не читается внутри
/// callback'а threadsafe-функции (там используется заранее захваченное имя),
/// но сохранено как часть публичного `#[napi(object)]`-типа, видимого в JS/TS.
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

/// Состояние канала отправки исходящих сообщений.
///
/// До момента подключения (`connect()` ещё не вызывался или сокет ещё
/// не в состоянии передавать данные — см. `connection::run`) все
/// сообщения буферизуются в `Buffering`. Как только соединение готово
/// принимать данные, `Inner::mark_connected` атомарно переносит буфер
/// в канал и переключает состояние на `Connected`.
///
/// Объединение "есть ли канал" и "что накопилось, пока его не было"
/// в один enum под одним `Mutex` устраняет гонку между проверкой
/// готовности и постановкой сообщения в очередь: раньше это были два
/// независимых примитива (`AtomicBool` + `Mutex<Vec<Message>>>`), и
/// сообщение, отправленное ровно в момент перехода в "готово", могло
/// быть потеряно (см. разбор проблем).
pub enum PacketSink {
    /// Соединение ещё не готово — сообщения копятся здесь по порядку.
    Buffering(Vec<Message>),
    /// Соединение активно — сообщения уходят напрямую в канал,
    /// который слушает write-задача в `connection::run`.
    Connected(mpsc::UnboundedSender<Message>),
}

/// Общее состояние WebSocket-клиента, разделяемое между JS-обёрткой
/// и Tokio-runtime.
pub struct Inner {
    /// Канал/буфер исходящих сообщений (см. `PacketSink`).
    sink: Mutex<PacketSink>,

    /// Последний полученный sequence. `-1` — ещё не получен.
    pub sequence: AtomicI64,

    /// Текущий статус соединения (код из `ws_status`).
    pub status: AtomicU8,

    /// Флаг готовности соединения (успешный handshake).
    ///
    /// Это чисто информационное состояние для JS-геттера `ready` и
    /// эмиссии событий. Решение "буферизовать или отправлять" теперь
    /// принимается независимо от него, через `PacketSink` — см. выше.
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
            sink: Mutex::new(PacketSink::Buffering(Vec::new())),
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

    // ========================================================================
    // PacketSink
    // ========================================================================

    /// Отправляет сообщение немедленно (если соединение активно) либо
    /// буферизует его (если ещё нет). Основной путь для `packet`/`set_packet`.
    pub fn enqueue_or_send(&self, msg: Message) {
        match &mut *self.sink.lock() {
            PacketSink::Connected(tx) => {
                let _ = tx.send(msg);
            }
            PacketSink::Buffering(queue) => queue.push(msg),
        }
    }

    /// Отправляет сообщение, только если соединение уже активно; иначе
    /// молча отбрасывает его (не буферизует).
    ///
    /// Используется heartbeat-циклом: heartbeat не имеет смысла копить
    /// до подключения — если соединения нет, следующий тик всё равно
    /// пересчитает состояние заново.
    pub fn send_if_connected(&self, msg: Message) {
        if let PacketSink::Connected(tx) = &*self.sink.lock() {
            let _ = tx.send(msg);
        }
    }

    /// Атомарно публикует канал отправки и переносит в него все ранее
    /// буферизованные сообщения, в порядке их поступления.
    ///
    /// Держит блокировку на всё время переноса (сам перенос — синхронные
    /// `tx.send`, без `.await`, так что это дёшево), поэтому ни одно
    /// сообщение, отправленное конкурентно через `enqueue_or_send` ровно
    /// в момент подключения, не может оказаться "потерянным в очереди"
    /// или прийти раньше уже накопленных сообщений.
    pub fn mark_connected(&self, tx: mpsc::UnboundedSender<Message>) {
        let mut sink = self.sink.lock();
        if let PacketSink::Buffering(queue) = &mut *sink {
            for msg in queue.drain(..) {
                let _ = tx.send(msg);
            }
        }
        *sink = PacketSink::Connected(tx);
    }

    /// Возвращает sink в состояние буферизации (пустой буфер) и отдаёт
    /// прежний отправитель канала, если он был.
    ///
    /// Вызывающий код должен дропнуть возвращённый `UnboundedSender`
    /// (или просто проигнорировать результат — Drop сделает это сам),
    /// чтобы закрыть канал и разбудить читающую его write-задачу.
    pub fn mark_disconnected(&self) -> Option<mpsc::UnboundedSender<Message>> {
        match std::mem::replace(&mut *self.sink.lock(), PacketSink::Buffering(Vec::new())) {
            PacketSink::Connected(tx) => Some(tx),
            PacketSink::Buffering(_) => None,
        }
    }

    // ========================================================================
    // Events
    // ========================================================================

    /// Вызывает событие во все зарегистрированные JS-обработчики.
    ///
    /// Для всех обработчиков, кроме последнего, `payload`/`binary`
    /// клонируются (нужно раздать данные каждому). Последнему обработчику
    /// данные передаются по владению без клонирования — в самом частом
    /// случае (ровно один подписчик на событие, типично для `binary`
    /// событий с RTP/Opus-данными) это устраняет лишнее копирование
    /// потенциально немаленького буфера на каждый пакет.
    ///
    /// Вызовы выполняются в режиме `NonBlocking` — очередь JS-функции
    /// пополняется асинхронно, из runtime-потока.
    pub fn emit(&self, event: &str, payload_json: Option<String>, binary: Option<Vec<u8>>) {
        let events = self.events.lock();
        let Some(callbacks) = events.get(event) else { return; };
        let Some((last, rest)) = callbacks.split_last() else { return; };

        for cb in rest {
            let data = EmitData {
                event: event.to_string(),
                payload: payload_json.clone(),
                binary: binary.as_ref().map(|b| Buffer::from(b.clone())),
            };
            let _ = cb.call(data, ThreadsafeFunctionCallMode::NonBlocking);
        }

        let data = EmitData {
            event: event.to_string(),
            payload: payload_json,
            binary: binary.map(Buffer::from),
        };
        let _ = last.call(data, ThreadsafeFunctionCallMode::NonBlocking);
    }

    /// Сериализует значение в JSON и вызывает его как событие.
    ///
    /// При ошибке сериализации payload заменяется на `"null"` —
    /// событие всё равно вызывается, чтобы JS-сторона могла отреагировать.
    pub fn emit_json<T: serde::Serialize>(&self, event: &str, payload: T) {
        let s = serde_json::to_string(&payload).unwrap_or_else(|_| "null".into());
        self.emit(event, Some(s), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> Message {
        Message::Text(s.to_string().into())
    }

    fn as_text(msg: &Message) -> String {
        match msg {
            Message::Text(t) => t.to_string(),
            other => panic!("expected text message, got {other:?}"),
        }
    }

    #[test]
    fn buffers_messages_before_connect() {
        let inner = Inner::new();
        inner.enqueue_or_send(text("a"));
        inner.enqueue_or_send(text("b"));

        match &*inner.sink.lock() {
            PacketSink::Buffering(queue) => assert_eq!(queue.len(), 2),
            PacketSink::Connected(_) => panic!("expected buffering state"),
        }
    }

    #[test]
    fn mark_connected_flushes_buffered_messages_in_order() {
        let inner = Inner::new();
        inner.enqueue_or_send(text("first"));
        inner.enqueue_or_send(text("second"));

        let (tx, mut rx) = mpsc::unbounded_channel();
        inner.mark_connected(tx);

        // Сообщение, отправленное уже после подключения, должно уйти
        // строго ПОСЛЕ ранее буферизованных — регрессия на исходную гонку.
        inner.enqueue_or_send(text("third"));

        let received: Vec<Message> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
        assert_eq!(received.len(), 3);
        assert_eq!(as_text(&received[0]), "first");
        assert_eq!(as_text(&received[1]), "second");
        assert_eq!(as_text(&received[2]), "third");
    }

    #[test]
    fn mark_disconnected_returns_to_buffering_and_closes_old_channel() {
        let inner = Inner::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        inner.mark_connected(tx);

        let old_tx = inner.mark_disconnected();
        assert!(old_tx.is_some());
        drop(old_tx);

        // Канал закрыт -> дальнейшие try_recv возвращают ошибку "disconnected".
        assert!(rx.try_recv().is_err());

        // Новая отправка снова буферизуется, а не паникует и не теряется.
        inner.enqueue_or_send(text("after reconnect"));
        match &*inner.sink.lock() {
            PacketSink::Buffering(queue) => assert_eq!(queue.len(), 1),
            PacketSink::Connected(_) => panic!("expected buffering state"),
        }
    }

    #[test]
    fn send_if_connected_drops_silently_when_buffering() {
        let inner = Inner::new();
        inner.send_if_connected(text("heartbeat"));

        match &*inner.sink.lock() {
            PacketSink::Buffering(queue) => assert!(queue.is_empty()),
            PacketSink::Connected(_) => panic!("expected buffering state"),
        }
    }

    #[test]
    fn send_if_connected_forwards_when_connected() {
        let inner = Inner::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        inner.mark_connected(tx);

        inner.send_if_connected(text("hb"));
        let received = rx.try_recv().expect("message should be forwarded");
        assert_eq!(as_text(&received), "hb");
    }
}