pub mod connection;
pub mod heartbeat;
pub mod inner;
pub mod opcodes;
pub mod runtime;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeCallContext;
use napi_derive::napi;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::structures::network::ws::inner::{EmitData, EventFn, Inner};
use crate::structures::network::ws::opcodes::ws_status;

#[napi]
pub struct VoiceWebSocket {
    inner: Arc<Inner>,
}

#[napi]
impl VoiceWebSocket {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self { inner: Inner::new() }
    }

    #[napi(getter)]
    pub fn ready(&self) -> bool {
        self.inner.ready.load(Ordering::SeqCst)
    }

    #[napi(getter)]
    pub fn status(&self) -> u32 {
        self.inner.status.load(Ordering::SeqCst) as u32
    }

    #[napi(getter)]
    pub fn sequence(&self) -> i64 {
        self.inner.sequence.load(Ordering::SeqCst)
    }

    #[napi]
    pub fn on(&self, event: String, callback: Function<(), ()>) -> Result<()> {
        let event_name = event.clone();

        let tsfn: EventFn = callback
            .build_threadsafe_function()
            .build_callback(move |ctx: ThreadsafeCallContext<EmitData>| {
                let data = ctx.value;

                // Возвращаем кортеж (Value, Value). Оба значения будут
                // переданы как отдельные аргументы JS-функции.
                let null = || serde_json::Value::Null;
                let args: Vec<serde_json::Value> = match event_name.as_str() {
                    // 0 аргументов
                    "open" | "resumed" | "disconnect" => vec![],

                    // 1 аргумент: строка
                    "info" => vec![serde_json::Value::String(data.payload.unwrap_or_default())],

                    // 1 аргумент: объект {message, stack}
                    "error" => {
                        let parsed: serde_json::Value = serde_json::from_str(
                            data.payload.as_deref().unwrap_or("null"),
                        ).unwrap_or(serde_json::Value::Null);

                        let message = parsed.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown WebSocket error");
                        let stack   = parsed.get("stack").and_then(|v| v.as_str()).unwrap_or(message);

                        let mut obj = serde_json::Map::new();
                        obj.insert("message".into(), serde_json::Value::String(message.into()));
                        obj.insert("stack".into(),   serde_json::Value::String(stack.into()));
                        vec![serde_json::Value::Object(obj)]
                    }

                    // 2 аргумента: code, reason
                    "close" => {
                        let parsed: serde_json::Value = serde_json::from_str(
                            data.payload.as_deref().unwrap_or("null"),
                        ).unwrap_or(serde_json::Value::Null);

                        let code = parsed.get("code").and_then(|v| v.as_u64()).unwrap_or(1006);
                        let reason = parsed.get("reason").and_then(|v| v.as_str()).unwrap_or("").to_string();

                        vec![
                            serde_json::Value::Number(code.into()),
                            serde_json::Value::String(reason),
                        ]
                    }

                    // 1 аргумент: {op, payload}
                    "binary" => {
                        let parsed: serde_json::Value = serde_json::from_str(
                            data.payload.as_deref().unwrap_or("null"),
                        ).unwrap_or(serde_json::Value::Null);
                        let op = parsed.get("op").and_then(|v| v.as_u64()).unwrap_or(0);

                        let mut obj = serde_json::Map::new();
                        obj.insert("op".into(), serde_json::Value::Number(op.into()));
                        if let Some(buf) = data.binary {
                            let arr: Vec<serde_json::Value> = buf.iter()
                                .map(|b| serde_json::Value::Number((*b).into()))
                                .collect();
                            obj.insert("payload".into(), serde_json::Value::Array(arr));
                        }
                        vec![serde_json::Value::Object(obj)]
                    }

                    // 1 аргумент: весь конверт {op, d, seq}
                    _ => {
                        let s = data.payload.unwrap_or_else(|| "null".to_string());
                        let parsed: serde_json::Value = serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
                        vec![parsed]
                    }
                };

                Ok(args)
            })?;

        self.inner
            .events
            .lock()
            .entry(event)
            .or_default()
            .push(tsfn);
        Ok(())
    }

    #[napi(js_name = "packet", setter)]
    pub fn send_packet(&self, payload: Either<Buffer, String>) -> Result<()> {
        let msg = match payload {
            Either::A(buf) => Message::Binary(buf.to_vec().into()),
            Either::B(s) => Message::Text(s.into()),
        };

        if !self.inner.ready.load(Ordering::SeqCst) {
            self.inner.queue.lock().push(msg);
            return Ok(());
        }
        if let Some(tx) = self.inner.ws_tx.lock().as_ref() {
            let _ = tx.send(msg);
        }
        Ok(())
    }

    #[napi]
    pub fn connect(&self, endpoint: String, _code: Option<u32>) -> Result<()> {
        self.reset();
        // Нормализуем endpoint: убираем возможный "wss://" и ведущий "/".
        let host = endpoint
            .trim_start_matches("wss://")
            .trim_start_matches("ws://")
            .trim_start_matches('/');

        // Discord ждёт "/?v=8" — со слешем перед query.
        let url = format!("wss://{host}/?v=8");
        let inner = self.inner.clone();

        let (tx, rx) = mpsc::unbounded_channel::<Message>();
        *inner.ws_tx.lock() = Some(tx);

        let handle = runtime::spawn(async move {
            connection::run(inner, url, rx).await;
        });
        *self.inner.conn_task.lock() = Some(handle);
        Ok(())
    }

    #[napi]
    pub fn reset(&self) {
        if let Some(t) = self.inner.conn_task.lock().take() {
            t.abort();
        }
        heartbeat::stop(&self.inner);
        if let Some(tx) = self.inner.ws_tx.lock().take() {
            drop(tx);
        }
        self.inner.queue.lock().clear();
        self.inner.ready.store(false, Ordering::SeqCst);
        self.inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
        self.inner.hb_pending.store(false, Ordering::SeqCst);
    }

    #[napi]
    pub fn destroy(&self) {
        self.reset();
        self.inner.destroyed.store(true, Ordering::SeqCst);
        self.inner.events.lock().clear();
        self.inner.sequence.store(-1, Ordering::SeqCst);
    }

    #[napi]
    pub fn set_packet(&self, payload: Either<Buffer, String>) -> Result<()> {
        self.send_packet(payload)
    }
}