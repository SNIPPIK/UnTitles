use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::sync::OnceLock;

use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::structures::network::ws::heartbeat;
use crate::structures::network::ws::inner::Inner;
use crate::structures::network::ws::opcodes::{is_dave, op, ws_status};

static CRYPTO_INIT: OnceLock<()> = OnceLock::new();

#[inline]
fn ensure_crypto_provider() {
    CRYPTO_INIT.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

pub async fn run(
    inner: Arc<Inner>,
    url: String,
    mut rx: mpsc::UnboundedReceiver<Message>,
) {
    ensure_crypto_provider();

    inner.status.store(ws_status::CONNECTING, Ordering::SeqCst);

    // Собираем запрос с явным User-Agent. Discord иногда отдаёт
    // 400 Bad Request, если UA отсутствует.
    let request = match url.as_str().into_client_request() {
        Ok(mut req) => {
            req.headers_mut().insert(
                "User-Agent",
                HeaderValue::from_static("WatKLOK/1.0 (+https://github.com/)"),
            );
            req
        }
        Err(e) => {
            let msg = format!("invalid url: {e}");
            inner.emit_json("error", json!({ "message": msg.clone() }));
            inner.emit_json("close", json!({ "code": 4006, "reason": msg }));
            inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
            return;
        }
    };

    // Логируем URL ДО подключения — сильно помогает при отладке 400.
    inner.emit_json("info", json!(format!("[WebSocket] connecting to {url}")));

    let (ws, _) = match connect_async(request).await {
        Ok(v) => v,
        Err(e) => {
            let msg = e.to_string();
            inner.emit_json("error", json!({ "message": msg.clone() }));
            inner.emit_json("close", json!({ "code": 4006, "reason": msg }));
            inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
            return;
        }
    };

    let (mut sink, mut stream) = ws.split();

    inner.ready.store(true, Ordering::SeqCst);
    inner.status.store(ws_status::OPEN, Ordering::SeqCst);

    // Слив очереди: собираем в Vec, чтобы не держать guard через .await.
    let pending: Vec<Message> = {
        let mut queue = inner.queue.lock();
        queue.drain(..).collect()
    };
    for msg in pending {
        if sink.send(msg).await.is_err() {
            break;
        }
    }

    inner.emit("open", None, None);
    inner.emit_json("info", json!("[WebSocket] has open connection"));

    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    while let Some(result) = stream.next().await {
        match result {
            Ok(Message::Text(text)) => handle_text(&inner, text.as_str()),
            Ok(Message::Binary(data)) => handle_binary(&inner, &data),
            Ok(Message::Close(frame)) => {
                let (code, reason) = match frame {
                    Some(f) => (u16::from(f.code) as u32, f.reason.to_string()),
                    None => (1000, String::new()),
                };
                inner.emit_json("close", json!({ "code": code, "reason": reason }));
                break;
            }
            Ok(_) => {}
            Err(e) => {
                inner.emit_json("error", json!({ "message": e.to_string() }));
                break;
            }
        }
    }

    inner.status.store(ws_status::CLOSING, Ordering::SeqCst);
    inner.ready.store(false, Ordering::SeqCst);
    inner.ws_tx.lock().take();
    write_task.abort();
    heartbeat::stop(&inner);
    inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
}

fn handle_text(inner: &Arc<Inner>, text: &str) {
    let payload: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => {
            inner.emit_json("error", json!("Invalid JSON"));
            return;
        }
    };

    if let Some(seq) = payload.get("seq").and_then(|v| v.as_i64()) {
        inner.sequence.store(seq, Ordering::SeqCst);
    }

    let Some(op_code) = payload.get("op").and_then(|v| v.as_u64()) else {
        return;
    };
    let op_code = op_code as u8;

    match op_code {
        op::HEARTBEAT_ACK => heartbeat::ack(inner),
        op::HELLO => {
            if let Some(interval) = payload
                .get("d")
                .and_then(|d| d.get("heartbeat_interval"))
                .and_then(|v| v.as_u64())
            {
                heartbeat::start(inner.clone(), interval);
            }
        }
        op::SPEAKING => inner.emit_json("speaking", payload),
        op::CLIENTS_CONNECT | op::CLIENT_DISCONNECT => inner.emit_json("Users", payload),
        op::READY => inner.emit_json("ready", payload),
        op::SESSION_DESCRIPTION => inner.emit_json("sessionDescription", payload),
        op::RESUMED => inner.emit_json("resumed", payload),
        _ if is_dave(op_code) => inner.emit_json("daveSession", payload),
        _ => {}
    }
}

fn handle_binary(inner: &Arc<Inner>, data: &[u8]) {
    if data.len() < 3 {
        return;
    }

    let sequence = u16::from_be_bytes([data[0], data[1]]);
    let op_code = data[2];
    let payload = &data[3..];

    if sequence != 0 {
        inner.sequence.store(sequence as i64, Ordering::SeqCst);
    }

    inner.emit(
        "binary",
        Some(json!({ "op": op_code }).to_string()),
        Some(payload.to_vec()),
    );
}