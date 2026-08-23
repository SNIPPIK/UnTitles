use crate::structures::network::udp::UdpBuffered;
use crate::utils::duration::now_ms;
use arc_swap::ArcSwap;
use std::{
    collections::HashMap,
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant}
};

// ============================================================================
// КОНФИГУРАЦИЯ
// ============================================================================

/// Интервал между тактами управляющего потока (в миллисекундах).
/// Задаёт частоту, с которой вызывается `process` для каждой сессии.
pub const TICK_INTERVAL_MS: u64 = 20;

const SPIN_MARGIN: Duration = Duration::from_micros(200);
const MIN_SLEEP: Duration = Duration::from_micros(600);

// ============================================================================
// ДИСПЕТЧЕР ЦИКЛА
// ============================================================================

/// Менеджер жизненного цикла UDP-сессий.
///
/// Запускает фоновый поток (если есть хотя бы одна сессия), который
/// с фиксированным интервалом `TICK_INTERVAL_MS` обходит все активные сессии
/// и вызывает у них метод `process`.
///
/// Поток автоматически останавливается, когда множество сессий становится
/// пустым (реализовано косвенно через флаг `running` и пустую карту –
/// поток продолжает крутиться, пока `running == true`; при отсутствии сессий
/// он фактически ничего не делает, но флаг остаётся взведённым, чтобы не
/// перезапускать поток каждый раз. При вызове `shutdown` флаг снимается
/// и поток корректно завершается).
///
/// # Concurrency
///
/// - Карта сессий хранится в [`ArcSwap`], что даёт возможность читать её
///   без блокировок (дешёвое клонирование `Arc`) и атомарно заменять при
///   добавлении/удалении.
/// - Флаг `running` – атомарный, чтобы основной поток и воркер могли
///   синхронизироваться без мьютексов.
/// - Дескриптор воркера спрятан за `Mutex`, так как к нему имеют доступ
///   и публичные методы, и `Drop`.
/// - `wake_state` спроектирован для немедленного пробуждения воркера,
///   однако в текущей реализации воркер **не ожидает на condition variable**,
///   поэтому `wake_thread()` не сокращает задержку при выключении
///   (воркер проснётся только по окончании текущего `sleep`).
pub struct CycleManager {
    /// Карта активных сессий, обёрнутая в `ArcSwap` для атомарных
    /// snapshot‑чтений и замен.
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,

    /// Атомарный флаг, управляющий временем жизни воркера.
    /// Пока `true`, поток продолжает работать.
    running: Arc<AtomicBool>,

    /// Join-хэндл фонового потока. Защищён мьютексом, так как доступ
    /// возможен из нескольких потоков (например, `add_session` и `shutdown`).
    handle: Mutex<Option<JoinHandle<()>>>,

    /// Пара (флаг, condvar) для пробуждения воркера.
    /// Флаг (`Mutex<bool>`) хранит признак «есть событие».
    /// Воркер **не ожидает** эту condvar – элемент оставлен для будущего
    /// рефакторинга или немедленного уведомления.
    wake_state: Arc<(Mutex<bool>, Condvar)>,
}

impl CycleManager {
    // =========================================================================
    // Создание
    // =========================================================================

    /// Создаёт новый экземпляр менеджера с пустой картой сессий.
    ///
    /// Фоновый поток **не** запускается до первого вызова `add_session`.
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            wake_state: Arc::new((Mutex::new(false), Condvar::new())),
        })
    }

    // =========================================================================
    // Публичное API
    // =========================================================================

    /// Регистрирует сессию с заданным идентификатором.
    ///
    /// Если это первая сессия, запускает фоновый поток.
    /// Поток начнёт обходить сессии на следующем такте.
    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        let mut map = self.sessions.load_full();

        Arc::make_mut(&mut map).insert(id, session);
        self.sessions.store(map);
        self.start_if_needed();
    }

    /// Удаляет сессию по идентификатору.
    ///
    /// Если сессия была последней, поток продолжает работать (флаг `running`
    /// остаётся `true`), но в холостом режиме ничего не делает.
    /// Для полной остановки используйте `shutdown`.
    pub fn remove_session(&self, id: u32) {
        let mut map = self.sessions.load_full();
        Arc::make_mut(&mut map).remove(&id);
        self.sessions.store(map);
    }

    /// Возвращает текущее количество активных сессий.
    /*pub fn session_count(&self) -> usize {
        self.sessions.load().len()
    }*/

    // =========================================================================
    // Остановка
    // =========================================================================

    /// Корректно останавливает фоновый поток и дожидается его завершения.
    ///
    /// Поток может быть заблокирован в `thread::sleep` до окончания
    /// текущего интервала – в таком случае остановка задержится на
    /// время до `TICK_INTERVAL_MS`.
    ///
    /// Безопасно вызывать повторно.
    pub fn shutdown(&self) {
        // Даём команду остановиться.
        self.running.store(false, Ordering::Release);
        // Уведомляем (хотя воркер не ждёт condvar, лишним не будет).
        self.wake_thread();

        // Забираем JoinHandle (если есть) и ждём завершения.
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }

    // =========================================================================
    // Внутренние методы
    // =========================================================================

    /// Безусловное уведомление condition variable.
    /// (Воркер эту переменную не ожидает – см. комментарий в `add_session`.)
    #[inline(always)]
    fn wake_thread(&self) {
        self.wake_state.1.notify_one();
    }

    /// Проверяет, не запущен ли уже воркер, и если нет — запускает его
    /// в отдельном потоке с именем `udp-cycle`.
    fn start_if_needed(&self) {
        // Быстрая проверка без лишней записи в память.
        if self
            .running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }

        let mut handle_guard = self.handle.lock().unwrap();

        debug_assert!(handle_guard.is_none());

        let sessions = Arc::clone(&self.sessions);
        let running = Arc::clone(&self.running);

        let handle = thread::Builder::new()
            .name("udp-cycle".into())
            .spawn(move || {
                let interval = Duration::from_millis(TICK_INTERVAL_MS);
                let mut next_deadline = Instant::now();

                while running.load(Ordering::Acquire) {
                    // ================================================================
                    // PROCESS
                    // ================================================================

                    let snapshot = sessions.load_full();

                    if !snapshot.is_empty() {
                        let now = now_ms();

                        for session in snapshot.values() {
                            session.process(now);
                        }
                    }

                    // ================================================================
                    // SCHEDULE
                    // ================================================================

                    next_deadline += interval;

                    let now = Instant::now();

                    if now < next_deadline {
                        let sleep = next_deadline - now;

                        if sleep > MIN_SLEEP {
                            thread::sleep(sleep - SPIN_MARGIN);
                        }

                        while Instant::now() < next_deadline {
                            std::hint::spin_loop();
                        }
                    } else {
                        next_deadline = Instant::now() + interval;
                    }
                }
            })
            .unwrap();

        *handle_guard = Some(handle);
    }
}

// ============================================================================
// Деструктор – гарантирует остановку потока при удалении менеджера.
// ============================================================================

impl Drop for CycleManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}