use tokio::time::{interval, Duration};
use serde_json::json;
use std::sync::{
    atomic::Ordering, Arc
};
use tokio_tungstenite::tungstenite::Message;
use crate::structures::network::ws::{
    opcodes::{close_codes, op},
    inner::Inner,
    runtime
};

/// Возвращает текущее время в миллисекундах с эпохи UNIX.
///
/// Используется для поля `t` в heartbeat-пакете. При ошибке системных
/// часов возвращает 0 — некорректное, но не критичное значение.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Запускает цикл отправки heartbeat-пакетов.
///
/// Порядок работы:
/// 1. Прерывает предыдущую задачу heartbeat, если она была.
/// 2. Сбрасывает флаг ожидания ACK.
/// 3. Создаёт задачу в собственном runtime с интервалом `interval_ms`.
/// 4. Пропускает первый тик (он нужен только для синхронизации интервала).
/// 5. На каждом следующем тике:
///    - если `hb_pending` уже установлен — значит предыдущий heartbeat
///      не подтверждён: вызываем `close` с кодом `SESSION_TIMEOUT` и выходим;
///    - иначе выставляет `hb_pending = true` и отправляет heartbeat-пакет
///      с текущим временем и последним полученным seq.
///
/// # Аргументы
/// * `inner` — общее состояние WebSocket-клиента.
/// * `interval_ms` — интервал между heartbeat в миллисекундах.
pub fn start(inner: Arc<Inner>, interval_ms: u64) {
    // Прерываем предыдущий heartbeat, если он ещё работает.
    if let Some(prev) = inner.hb_task.lock().take() {
        prev.abort();
    }
    // Начинаем с чистого состояния ожидания ACK.
    inner.hb_pending.store(false, Ordering::SeqCst);

    // Клонируем Arc для использования внутри задачи.
    let inner_task = Arc::clone(&inner);

    // Наш runtime, а не tokio::spawn.
    let handle = runtime::spawn(async move {
        // Тикер с заданным интервалом.
        let mut ticker = interval(Duration::from_millis(interval_ms));

        // Пропускаем первый тик — он срабатывает сразу и нужен только
        // для синхронизации последующих интервалов.
        ticker.tick().await;

        loop {
            // Ждём следующего тика.
            ticker.tick().await;

            // Если предыдущий heartbeat не получил ACK — это тайм-аут.
            // Swap возвращает предыдущее значение, что позволяет
            // обнаружить пропуск без дополнительных проверок.
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

            // Формируем heartbeat-пакет.
            let packet = json!({
                "op": op::HEARTBEAT,
                "d": {
                    "t": now_ms(),
                    "seq_ack": inner_task.sequence.load(Ordering::SeqCst),
                }
            });

            // Отправляем, только если соединение активно — heartbeat не
            // имеет смысла буферизовать до подключения (см. Inner::send_if_connected).
            inner_task.send_if_connected(Message::Text(packet.to_string().into()));
        }
    });

    // Сохраняем handle задачи, чтобы её можно было прервать.
    *inner.hb_task.lock() = Some(handle);
}

/// Останавливает цикл heartbeat. Безопасен для повторного вызова.
pub fn stop(inner: &Arc<Inner>) {
    // Прерываем задачу heartbeat, если она активна.
    if let Some(handle) = inner.hb_task.lock().take() { handle.abort(); }

    // Сбрасываем флаг ожидания ACK.
    inner.hb_pending.store(false, Ordering::SeqCst);
}

/// Обрабатывает получение ACK на heartbeat.
pub fn ack(inner: &Arc<Inner>) {
    inner.hb_pending.store(false, Ordering::SeqCst);
}