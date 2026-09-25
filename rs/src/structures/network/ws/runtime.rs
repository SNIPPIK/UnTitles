use tokio::runtime::{Builder, Runtime};
use std::sync::OnceLock;

/// Глобальный Tokio-runtime, разделяемый всеми WebSocket-сессиями.
///
/// Инициализируется лениво при первом обращении. `OnceLock` гарантирует
/// единственный экземпляр runtime на процесс.
static RUNTIME: OnceLock<Runtime> = OnceLock::new();

/// Возвращает ссылку на глобальный Tokio-runtime.
///
/// При первом вызове создаёт многопоточный runtime со всеми включёнными
/// драйверами (I/O, timers) и именем потока `voice-ws`.
///
/// # Паника
/// Паникует, если не удалось создать runtime. Это фатальная ошибка —
/// без runtime работа голосовых WebSocket-сессий невозможна.
pub fn runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        Builder::new_multi_thread()
            // Включаем таймеры и I/O-драйверы.
            .enable_all()
            // Имя потоков runtime для удобства отладки.
            .thread_name("voice-ws")
            .build()
            .expect("Failed to build runtime")
    })
}

/// Запускает future в глобальном runtime.
///
/// Удобная обёртка над `Runtime::spawn`, использующая общий runtime.
///
/// # Аргументы
/// * `future` — асинхронная задача, `Send + 'static`.
///
/// # Возвращаемое значение
/// `JoinHandle` для отслеживания завершения и прерывания задачи.
#[inline]
pub fn spawn<F>(future: F) -> tokio::task::JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    runtime().spawn(future)
}