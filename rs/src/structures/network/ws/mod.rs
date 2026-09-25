pub mod connection;
pub mod heartbeat;
pub mod inner;
pub mod opcodes;
pub mod runtime;

use napi::{
    threadsafe_function::ThreadsafeCallContext,
    bindgen_prelude::*
};
use napi_derive::napi;
use std::sync::{
    atomic::Ordering,
    Arc
};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use crate::structures::network::ws::{
    inner::{EmitData, EventFn, Inner},
    opcodes::ws_status
};

/// Обёртка Voice WebSocket для JavaScript.
///
/// Управляет подключением к Discord Voice Gateway, отправкой/приёмом
/// сообщений и эмиссией событий в JS через threadsafe-функции.
/// Вся работа с сетью и таймерами выполняется в Tokio-runtime, JS-сторона
/// получает только события и управляет жизненным циклом.
#[napi]
pub struct VoiceWebSocket {
    /// Разделяемое внутреннее состояние (сокет, очередь, флаги, события).
    inner: Arc<Inner>,
}

#[napi]
impl VoiceWebSocket {
    /// Создаёт объект без активного подключения.
    #[napi(constructor)]
    pub fn new() -> Self {
        Self { inner: Inner::new() }
    }

    /// `true`, если WebSocket-соединение активно.
    #[napi(getter)]
    pub fn ready(&self) -> bool {
        self.inner.ready.load(Ordering::SeqCst)
    }

    /// Текущий статус соединения (код из `ws_status`).
    #[napi(getter)]
    pub fn status(&self) -> u32 {
        self.inner.status.load(Ordering::SeqCst) as u32
    }

    /// Последний полученный seq от Discord (для Resume).
    #[napi(getter)]
    pub fn sequence(&self) -> i64 {
        self.inner.sequence.load(Ordering::SeqCst)
    }

    /// Регистрирует обработчик JS-события.
    ///
    /// Внутри создаётся threadsafe-функция, которая при срабатывании
    /// преобразует `EmitData` в набор JSON-значений и передаёт их
    /// JS-функции как позиционные аргументы.
    ///
    /// Формат аргументов зависит от имени события:
    /// * `open` | `resumed` | `disconnect` — без аргументов;
    /// * `info` — строка;
    /// * `error` — объект `{ message, stack }`;
    /// * `close` — `(code: number, reason: string)`;
    /// * `binary` — `{ op, payload: number[] }`;
    /// * прочие события — разобранным JSON-payload.
    ///
    /// # Аргументы
    /// * `event` — имя события.
    /// * `callback` — JS-функция-обработчик.
    ///
    /// # Ошибки
    /// Возвращает ошибку, если не удалось построить threadsafe-функцию.
    #[napi]
    pub fn on(&self, event: String, callback: Function<(), ()>) -> Result<()> {
        // Имя события нужно внутри callback — клонируем заранее.
        let event_name = event.clone();

        let js_fn: EventFn = callback
            .build_threadsafe_function()
            .build_callback(move |ctx: ThreadsafeCallContext<EmitData>| {
                let data = ctx.value;

                // Набор аргументов формируется как Vec<serde_json::Value>,
                // каждый элемент — отдельный аргумент JS-функции.
                let _null = || serde_json::Value::Null;
                let args: Vec<serde_json::Value> = match event_name.as_str() {
                    // Без аргументов.
                    "open" | "resumed" | "disconnect" => vec![],

                    // Одна строка.
                    "info" => vec![serde_json::Value::String(data.payload.unwrap_or_default())],

                    // Объект с полями message/stack.
                    "error" => {
                        let parsed: serde_json::Value = serde_json::from_str(
                            data.payload.as_deref().unwrap_or("null"),
                        ).unwrap_or(serde_json::Value::Null);

                        // Подставляем значения по умолчанию, если поля отсутствуют.
                        let message = parsed.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown WebSocket error");
                        let stack   = parsed.get("stack").and_then(|v| v.as_str()).unwrap_or(message);

                        let mut obj = serde_json::Map::new();
                        obj.insert("message".into(), serde_json::Value::String(message.into()));
                        obj.insert("stack".into(),   serde_json::Value::String(stack.into()));
                        vec![serde_json::Value::Object(obj)]
                    }

                    // Два аргумента: код и причина.
                    "close" => {
                        let parsed: serde_json::Value = serde_json::from_str(
                            data.payload.as_deref().unwrap_or("null"),
                        ).unwrap_or(serde_json::Value::Null);

                        // 1006 — код "abnormal closure", используется как дефолт.
                        let code = parsed.get("code").and_then(|v| v.as_u64()).unwrap_or(1006);
                        let reason = parsed.get("reason").and_then(|v| v.as_str()).unwrap_or("").to_string();

                        vec![
                            serde_json::Value::Number(code.into()),
                            serde_json::Value::String(reason),
                        ]
                    }

                    // Объект { op, payload: number[] }.
                    "binary" => {
                        let parsed: serde_json::Value = serde_json::from_str(
                            data.payload.as_deref().unwrap_or("null"),
                        ).unwrap_or(serde_json::Value::Null);
                        let op = parsed.get("op").and_then(|v| v.as_u64()).unwrap_or(0);

                        let mut obj = serde_json::Map::new();
                        obj.insert("op".into(), serde_json::Value::Number(op.into()));

                        // Бинарные данные передаются как массив байтов.
                        if let Some(buf) = data.binary {
                            let arr: Vec<serde_json::Value> = buf.iter()
                                .map(|b| serde_json::Value::Number((*b).into()))
                                .collect();
                            obj.insert("payload".into(), serde_json::Value::Array(arr));
                        }
                        vec![serde_json::Value::Object(obj)]
                    }

                    // Универсальная ветка: весь JSON-payload как единственный аргумент.
                    _ => {
                        let s = data.payload.unwrap_or_else(|| "null".to_string());
                        let parsed: serde_json::Value = serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
                        vec![parsed]
                    }
                };

                Ok(args)
            })?;

        // Регистрируем обработчик в списке событий (многопоточный доступ).
        self.inner
            .events
            .lock()
            .entry(event)
            .or_default()
            .push(js_fn);
        Ok(())
    }

    /// Отправляет пакет в WebSocket.
    ///
    /// Если соединение ещё не готово, пакет помещается в очередь
    /// и будет отправлен после установления соединения.
    ///
    /// # Аргументы
    /// * `payload` — `Buffer` (бинарный) или `String` (текстовый).
    #[napi(js_name = "packet", setter)]
    pub fn send_packet(&self, payload: Either<Buffer, String>) -> Result<()> {
        // Преобразуем вход в формат tungstenite.
        let msg = match payload {
            Either::A(buf) => Message::Binary(buf.to_vec().into()),
            Either::B(s) => Message::Text(s.into()),
        };

        // Если соединение ещё не готово — кладём в очередь.
        if !self.inner.ready.load(Ordering::SeqCst) {
            self.inner.queue.lock().push(msg);
            return Ok(());
        }

        // Иначе отправляем через канал в runtime-задачу.
        if let Some(tx) = self.inner.ws_tx.lock().as_ref() {
            let _ = tx.send(msg);
        }
        Ok(())
    }

    /// Открывает WebSocket-подключение к указанному endpoint'у.
    ///
    /// Нормализует переданный адрес: убирает схему (`ws://`, `wss://`)
    /// и ведущий `/`, после чего формирует итоговый URL с `/?v=8` —
    /// так Discord ожидает на голосовом шлюзе.
    ///
    /// # Аргументы
    /// * `endpoint` — адрес шлюза (может содержать схему или нет).
    /// * `_code` — необязательный код переподключения (не используется).
    #[napi]
    pub fn connect(&self, endpoint: String, _code: Option<u32>) -> Result<()> {
        // Сбрасываем предыдущее соединение, если оно было.
        self.reset();

        // Нормализация endpoint: убираем схему и ведущий "/".
        let host = endpoint
            .trim_start_matches("wss://")
            .trim_start_matches("ws://")
            .trim_start_matches('/');

        // Discord ждёт "/?v=8" — со слешем перед query.
        let url = format!("wss://{host}/?v=8");
        let inner = self.inner.clone();

        // Канал для отправки сообщений в runtime-задачу.
        let (tx, rx) = mpsc::unbounded_channel::<Message>();
        *inner.ws_tx.lock() = Some(tx);

        // Запускаем задачу в Tokio-runtime — она держит соединение и обрабатывает сообщения.
        let handle = runtime::spawn(async move {
            connection::run(inner, url, rx).await;
        });
        *self.inner.conn_task.lock() = Some(handle);
        Ok(())
    }

    /// Сбрасывает текущее соединение и очищает ресурсы.
    ///
    /// Прерывает runtime-задачу, останавливает heartbeat, закрывает канал
    /// отправки, очищает очередь и приводит флаги к состоянию "отключено".
    /// Безопасен для повторного вызова.
    #[napi]
    pub fn reset(&self) {
        // Прерываем текущую задачу соединения, если она запущена.
        if let Some(t) = self.inner.conn_task.lock().take() {
            t.abort();
        }
        // Останавливаем heartbeat.
        heartbeat::stop(&self.inner);

        // Закрываем канал отправки (drop tx завершит recv в задаче).
        if let Some(tx) = self.inner.ws_tx.lock().take() {
            drop(tx);
        }
        // Очищаем очередь отложенных сообщений.
        self.inner.queue.lock().clear();

        // Приводим флаги к исходному состоянию.
        self.inner.ready.store(false, Ordering::SeqCst);
        self.inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
        self.inner.hb_pending.store(false, Ordering::SeqCst);
    }

    /// Полностью уничтожает объект WebSocket.
    ///
    /// Помимо `reset` очищает зарегистрированные события и сбрасывает
    /// sequence в -1. Повторное использование после вызова невозможно.
    #[napi]
    pub fn destroy(&self) {
        // Освобождаем соединение и все связанные ресурсы.
        self.reset();

        // Помечаем объект как уничтоженный.
        self.inner.destroyed.store(true, Ordering::SeqCst);

        // Убираем зарегистрированные JS-обработчики.
        self.inner.events.lock().clear();

        // Сбрасываем последний полученный seq.
        self.inner.sequence.store(-1, Ordering::SeqCst);
    }

    /// Устанавливает пакет для отправки.
    ///
    /// Синоним для `send_packet`, используется там, где ожидается
    /// setter-семантика (например, при `ws.packet = value`).
    #[napi]
    pub fn set_packet(&self, payload: Either<Buffer, String>) -> Result<()> {
        self.send_packet(payload)
    }
}