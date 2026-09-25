use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use serde_json::{json, Value};
use std::sync::{
    atomic::Ordering,
    Arc, OnceLock
};
use tokio_tungstenite::{
    tungstenite::{
        client::IntoClientRequest,
        Message
    },
    connect_async
};
use crate::structures::network::ws::{
    opcodes::{is_dave, op, ws_status},
    inner::Inner,
    heartbeat
};

/// Одноразовая инициализация крипто-провайдера rustls.
///
/// `OnceLock` гарантирует, что `install_default` вызывается ровно один раз
/// на процесс, независимо от количества соединений.
static CRYPTO_INIT: OnceLock<()> = OnceLock::new();

/// Устанавливает дефолтный крипто-провайдер rustls (ring).
///
/// Нужен для корректной работы TLS в tokio-tungstenite. Повторные
/// вызовы безопасны — реальная инициализация происходит только при
/// первом обращении.
#[inline]
fn ensure_crypto_provider() {
    CRYPTO_INIT.get_or_init(|| {
        // Ошибку игнорируем: если провайдер уже установлен другим параметром,
        // это не считается проблемой.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Основной цикл WebSocket-соединения.
///
/// Отвечает за:
/// - установку TCP/TLS-соединения с указанным URL;
/// - пересылку сообщений из `rx` в сокет;
/// - приём входящих сообщений и их диспетчеризацию по хендлерам
///   (`handle_text` / `handle_binary`);
/// - обновление статуса соединения и эмиссию событий в JS.
///
/// # Аргументы
/// * `inner` — общее состояние WebSocket-клиента.
/// * `url` — полный URL для подключения.
/// * `rx` — канал исходящих сообщений от JS-стороны.
///
/// Функция завершается при закрытии соединения, ошибке или остановке
/// write-задачи.
pub async fn run(inner: Arc<Inner>, url: String, mut rx: mpsc::UnboundedReceiver<Message>) {
    // Инициализируем TLS-провайдер до первого соединения.
    ensure_crypto_provider();

    // Статус "устанавливается соединение".
    inner.status.store(ws_status::CONNECTING, Ordering::SeqCst);

    // Формируем HTTP-запрос для WebSocket-хендшейка.
    let request = match url.as_str().into_client_request() {
        Ok(req) => { req }
        Err(e) => {
            // Невалидный URL — вызываем ошибку и close, затем выходим.
            let msg = format!("invalid url: {e}");
            inner.emit_json("error", json!({ "message": msg.clone() }));
            inner.emit_json("close", json!({ "code": 4006, "reason": msg }));
            inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
            return;
        }
    };

    // Логируем URL ДО подключения — сильно помогает при отладке 400.
    inner.emit_json("info", json!(format!("[WebSocket] connecting to {url}")));

    // Устанавливаем соединение.
    let (ws, _) = match connect_async(request).await {
        Ok(v) => v,
        Err(e) => {
            // Не удалось подключиться — вызываем ошибку и close.
            let msg = e.to_string();
            inner.emit_json("error", json!({ "message": msg.clone() }));
            inner.emit_json("close", json!({ "code": 4006, "reason": msg }));
            inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
            return;
        }
    };

    // Разделяем сокет на sink (отправка) и stream (приём).
    let (mut sink, mut stream) = ws.split();

    // Отмечаем соединение как активное.
    inner.ready.store(true, Ordering::SeqCst);
    inner.status.store(ws_status::OPEN, Ordering::SeqCst);

    // Слив очереди: собираем в Vec, чтобы не держать guard через .await.
    let pending: Vec<Message> = {
        let mut queue = inner.queue.lock();
        queue.drain(..).collect()
    };
    // Отправляем накопленные сообщения по порядку.
    for msg in pending {
        if sink.send(msg).await.is_err() {
            break;
        }
    }

    // Оповещаем JS об открытии.
    inner.emit("open", None, None);
    inner.emit_json("info", json!("[WebSocket] has open connection"));

    // Отдельная задача на отправку: перекладывает сообщения из канала в sink.
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
        // Закрываем sink при выходе.
        let _ = sink.close().await;
    });

    // Основной цикл приёма сообщений.
    while let Some(result) = stream.next().await {
        match result {
            // Текстовое сообщение — разбираем как JSON.
            Ok(Message::Text(text)) => handle_text(&inner, text.as_str()),

            // Бинарное сообщение — обрабатываем отдельным хендлером.
            Ok(Message::Binary(data)) => handle_binary(&inner, &data),

            // Закрытие соединения: извлекаем код и причину.
            Ok(Message::Close(frame)) => {
                let (code, reason) = match frame {
                    Some(f) => (u16::from(f.code) as u32, f.reason.to_string()),
                    None => (1000, String::new()), // штатное закрытие по умолчанию
                };
                inner.emit_json("close", json!({ "code": code, "reason": reason }));
                break;
            }

            // Ping/Pong и прочие служебные кадры — игнорируем.
            Ok(_) => {}

            // Ошибка чтения — вызываем и завершаем цикл.
            Err(e) => {
                inner.emit_json("error", json!({ "message": e.to_string() }));
                break;
            }
        }
    }

    // Переводим состояние в "закрывается".
    inner.status.store(ws_status::CLOSING, Ordering::SeqCst);
    inner.ready.store(false, Ordering::SeqCst);

    // Очищаем канал отправки, чтобы write-задача завершилась.
    inner.ws_tx.lock().take();

    // Останавливаем write-задачу и heartbeat.
    write_task.abort();
    heartbeat::stop(&inner);

    // Финальный статус.
    inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
}

/// Обрабатывает текстовое сообщение от Discord Voice Gateway.
///
/// Разбирает JSON, обновляет seq, создает сообщение по полю `op`:
/// - `HEARTBEAT_ACK` — подтверждение heartbeat;
/// - `HELLO` — запускает heartbeat с указанным интервалом;
/// - `SPEAKING` / `CLIENTS_CONNECT` / `CLIENT_DISCONNECT` — события клиентов;
/// - `READY` / `SESSION_DESCRIPTION` / `RESUMED` — ключевые фазы подключения;
/// - op-коды DAVE — отдельное событие `daveSession`.
///
/// # Аргументы
/// * `inner` — общее состояние.
/// * `text` — сырой JSON.
fn handle_text(inner: &Arc<Inner>, text: &str) {
    // Парсим JSON, при ошибке вызываем событие и выходим.
    let payload: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => {
            inner.emit_json("error", json!("Invalid JSON"));
            return;
        }
    };

    // Обновляем seq, если он присутствует в сообщении.
    if let Some(seq) = payload.get("seq").and_then(|v| v.as_i64()) {
        inner.sequence.store(seq, Ordering::SeqCst);
    }

    // Без поля `op` сообщение не несёт полезной нагрузки — выходим.
    let Some(op_code) = payload.get("op").and_then(|v| v.as_u64()) else {
        return;
    };
    let op_code = op_code as u8;

    // Диспетчеризация по op-коду.
    match op_code {
        // Discord подтверждает наш heartbeat.
        op::HEARTBEAT_ACK => heartbeat::ack(inner),

        // Discord сообщает интервал heartbeat — запускаем цикл.
        op::HELLO => {
            if let Some(interval) = payload
                .get("d")
                .and_then(|d| d.get("heartbeat_interval"))
                .and_then(|v| v.as_u64())
            {
                heartbeat::start(inner.clone(), interval);
            }
        }

        // Участник начал/перестал говорить.
        op::SPEAKING => inner.emit_json("speaking", payload),

        // Изменения списка клиентов — пользователь подключился/отключился.
        op::CLIENTS_CONNECT | op::CLIENT_DISCONNECT => inner.emit_json("Users", payload),

        // Готовность голосового канала.
        op::READY => inner.emit_json("ready", payload),

        // Описание сессии (SSRC, ключи шифрования).
        op::SESSION_DESCRIPTION => inner.emit_json("sessionDescription", payload),

        // Подтверждение возобновления сессии.
        op::RESUMED => inner.emit_json("resumed", payload),

        // DAVE/MLS-сообщения обрабатываются TS-стороной.
        _ if is_dave(op_code) => inner.emit_json("daveSession", payload),

        // Прочие op-коды игнорируем.
        _ => {}
    }
}

/// Обрабатывает бинарное сообщение от Discord Voice Gateway.
///
/// Формат бинарного пакета (специфика Discord Voice):
/// * байты 0..2 — sequence (u16, big-endian);
/// * байт 2 — op-код;
/// * байты 3 — payload.
///
/// Если sequence ненулевой — обновляет общее состояние. Само сообщение
/// вызывается как событие `binary` с объектом `{ op }` и массивом байтов
/// payload.
///
/// # Аргументы
/// * `inner` — общее состояние.
/// * `data` — сырые байты сообщения.
fn handle_binary(inner: &Arc<Inner>, data: &[u8]) {
    // Минимальный размер: 2 байта sequence + 1 байт op.
    if data.len() < 3 {
        return;
    }

    // Извлекаем sequence и op.
    let sequence = u16::from_be_bytes([data[0], data[1]]);
    let op_code = data[2];
    let payload = &data[3..];

    // Обновляем seq, если он ненулевой (0 — незначащее значение).
    if sequence != 0 {
        inner.sequence.store(sequence as i64, Ordering::SeqCst);
    }

    // Вызываем событие с op-кодом и сырым payload.
    inner.emit(
        "binary",
        Some(json!({ "op": op_code }).to_string()),
        Some(payload.to_vec()),
    );
}