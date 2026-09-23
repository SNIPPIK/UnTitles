use tokio::time::{interval, Duration};
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tokio_tungstenite::tungstenite::Message;

use crate::structures::network::ws::inner::Inner;
use crate::structures::network::ws::opcodes::{close_codes, op};
use crate::structures::network::ws::runtime;   // ← наш runtime

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn start(inner: Arc<Inner>, interval_ms: u64) {
    if let Some(prev) = inner.hb_task.lock().take() {
        prev.abort();
    }
    inner.hb_pending.store(false, Ordering::SeqCst);

    let inner_task = Arc::clone(&inner);

    // Наш runtime, а не tokio::spawn.
    let handle = runtime::spawn(async move {
        let mut ticker = interval(Duration::from_millis(interval_ms));
        ticker.tick().await;

        loop {
            ticker.tick().await;

            if inner_task.hb_pending.swap(true, Ordering::SeqCst) {
                inner_task.emit_json(
                    "close",
                    json!({
                        "code": close_codes::SESSION_TIMEOUT,
                        "reason": "HEARTBEAT_ACK timeout"
                    }),
                );
                return;
            }

            let packet = json!({
                "op": op::HEARTBEAT,
                "d": {
                    "t": now_ms(),
                    "seq_ack": inner_task.sequence.load(Ordering::SeqCst),
                }
            });

            if let Some(tx) = inner_task.ws_tx.lock().as_ref() {
                let _ = tx.send(Message::Text(packet.to_string().into()));
            }
        }
    });

    *inner.hb_task.lock() = Some(handle);
}

pub fn stop(inner: &Arc<Inner>) {
    if let Some(handle) = inner.hb_task.lock().take() {
        handle.abort();
    }
    inner.hb_pending.store(false, Ordering::SeqCst);
}

pub fn ack(inner: &Arc<Inner>) {
    inner.hb_pending.store(false, Ordering::SeqCst);
}