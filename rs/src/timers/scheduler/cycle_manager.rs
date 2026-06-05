use crate::network::udp::UdpBuffered;
use arc_swap::ArcSwap;
use std::{
    collections::HashMap,
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

// ============================================================================
// CONFIG
// ============================================================================

pub const TICK_INTERVAL_MS: u64 = 20;      // 50 Гц
const MAX_CATCH_UP_TICKS: u32 = 1;         // Ограничение догоняющих тиков

// ============================================================================
// CYCLE MANAGER (Универсальный кроссплатформенный вариант)
// ============================================================================

pub struct CycleManager {
    sessions: Arc<ArcSwap<HashMap<u32, UdpBuffered>>>,
    running: Arc<AtomicBool>,
    handle: Mutex<Option<JoinHandle<()>>>,

    // Связка для управления ожиданием и пробуждением потока (Condvar + фиктивный Mutex)
    wake_state: Arc<(Mutex<()>, Condvar)>
}

impl CycleManager {
    // =========================================================================
    // NEW
    // =========================================================================

    pub fn new() -> io::Result<Self> {
        Ok(Self {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            wake_state: Arc::new((Mutex::new(()), Condvar::new())),
        })
    }

    // =========================================================================
    // API
    // =========================================================================

    // Добавить сессию. Если поток ещё не запущен – запускаем (lazy start).
    // После изменения карты – пробуждаем цикл, чтобы он пересчитал таймеры (необязательно, но безопасно).
    pub fn add_session(&self, id: u32, session: UdpBuffered) {
        let mut map = self.sessions.load_full();
        Arc::make_mut(&mut map).insert(id, session);
        self.sessions.store(map);

        self.start_if_needed();
        self.wake_thread();
    }

    /// Удаление сессии из цикла
    /// После удаления, поток может работать дальше если есть еще активные сессии
    pub fn remove_session(&self, id: u32) {
        let mut map = self.sessions.load_full();
        Arc::make_mut(&mut map).remove(&id);
        self.sessions.store(map);

        self.wake_thread();
    }

    // =========================================================================
    // SHUTDOWN
    // =========================================================================

    // Остановка цикла и ожидание завершения потока.
    pub fn shutdown(&self) {
        self.running.store(false, Ordering::Release);
        self.wake_thread();

        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }

    // =========================================================================
    // INTERNAL LOGIC
    // =========================================================================

    /// Будит рабочий поток, прерывая его ожидание (Condvar::notify_one)
    fn wake_thread(&self) {
        self.wake_state.1.notify_one();
    }

    fn start_if_needed(&self) {
        // Защита от гонок: поток запускается только если running был false
        if self.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return;
        }

        let mut guard = self.handle.lock().unwrap();
        if guard.is_some() { return; }

        let sessions = Arc::clone(&self.sessions);
        let running = Arc::clone(&self.running);
        let wake_state = Arc::clone(&self.wake_state);
        let interval = Duration::from_millis(TICK_INTERVAL_MS);

        let handle = thread::spawn(move || {
            let mut next_tick = Instant::now() + interval;

            while running.load(Ordering::Acquire) {
                let now = Instant::now();
                let mut ticks_to_run = 0;

                // ---- Вычисление тиков и коррекция дрейфа ----
                if now >= next_tick {
                    let elapsed = now - next_tick;
                    let missed = (elapsed.as_nanos() / interval.as_nanos()) as u32;

                    // Ограничиваем количество "догоняющих" тиков за одну итерацию
                    ticks_to_run = 1 + missed.min(MAX_CATCH_UP_TICKS);

                    if missed > 2 {
                        // Жесткий сброс: если лаг слишком большой, не пытаемся догнать
                        next_tick = now + interval;
                    } else {
                        // Плавная коррекция: прибавляем точное время
                        next_tick += interval * (1 + missed);
                    }
                }

                // ---- Выполнение сессий ----
                if ticks_to_run > 0 {
                    let snapshot = sessions.load();

                    if !snapshot.is_empty() {
                        for _ in 0..ticks_to_run {
                            for session in snapshot.values() {
                                session.tick();
                            }
                        }
                    }
                }

                // ---- Ожидание до следующего тика (или пробуждения) ----
                let now = Instant::now();
                if let Some(timeout) = next_tick.checked_duration_since(now) {
                    let (lock, cvar) = &*wake_state;
                    let guard = lock.lock().unwrap();
                    // wait_timeout усыпляет поток, не расходуя CPU
                    let _ = cvar.wait_timeout(guard, timeout).unwrap();
                }
            }
        });

        *guard = Some(handle);
    }
}

// ============================================================================
// DROP
// ============================================================================

impl Drop for CycleManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}