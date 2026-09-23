use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU8};
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

#[napi(object)]
pub struct EmitData {
    pub event: String,
    pub payload: Option<String>,
    pub binary: Option<Buffer>,
}

/// Кортеж всегда из 2 элементов — napi-rs распаковывает кортеж
/// в 2 отдельных JS-аргумента. Для 0/1-аргументных событий
/// второй элемент = Null (JS его игнорирует).
pub type EventFn = ThreadsafeFunction<
    EmitData,
    (),
    Vec<serde_json::Value>,
    Status,
    false,
>;

pub struct Inner {
    pub ws_tx: Mutex<Option<mpsc::UnboundedSender<Message>>>,
    pub queue: Mutex<Vec<Message>>,
    pub sequence: AtomicI64,
    pub status: AtomicU8,
    pub ready: AtomicBool,
    pub destroyed: AtomicBool,
    pub hb_pending: AtomicBool,
    pub hb_task: Mutex<Option<JoinHandle<()>>>,
    pub conn_task: Mutex<Option<JoinHandle<()>>>,
    pub events: Mutex<HashMap<String, Vec<EventFn>>>,
}

impl Inner {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            ws_tx: Mutex::new(None),
            queue: Mutex::new(Vec::new()),
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

    pub fn emit(&self, event: &str, payload_json: Option<String>, binary: Option<Vec<u8>>) {
        let events = self.events.lock();
        let Some(callbacks) = events.get(event) else { return; };

        for cb in callbacks {
            let data = EmitData {
                event: event.to_string(),
                payload: payload_json.clone(),
                binary: binary.as_ref().map(|b| Buffer::from(b.clone())),
            };
            // ВАЖНО: call(value, mode) — value без Result.
            let _ = cb.call(data, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    pub fn emit_json<T: serde::Serialize>(&self, event: &str, payload: T) {
        let s = serde_json::to_string(&payload).unwrap_or_else(|_| "null".into());
        self.emit(event, Some(s), None);
    }
}