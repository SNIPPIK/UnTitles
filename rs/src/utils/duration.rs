use std::time::{SystemTime, UNIX_EPOCH};

/// Вспомогательная функция для получения текущего времени в мс
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}