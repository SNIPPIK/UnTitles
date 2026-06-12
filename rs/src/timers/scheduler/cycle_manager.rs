use crate::network::udp::{now_ms, UdpBuffered};
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

pub const TICK_INTERVAL_MS: u64 = 20;

// ============================================================================
// CYCLE MANAGER
// ============================================================================

pub struct CycleManager {
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,

    running: Arc<AtomicBool>,

    handle: Mutex<Option<JoinHandle<()>>>,

    wake_state: Arc<(Mutex<()>, Condvar)>,
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

    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        let mut map = self.sessions.load_full();

        Arc::make_mut(&mut map).insert(id, session);

        self.sessions.store(map);

        self.start_if_needed();
        self.wake_thread();
    }

    pub fn remove_session(&self, id: u32) {
        let mut map = self.sessions.load_full();

        Arc::make_mut(&mut map).remove(&id);

        self.sessions.store(map);

        self.wake_thread();
    }

    pub fn session_count(&self) -> usize {
        self.sessions.load().len()
    }

    // =========================================================================
    // SHUTDOWN
    // =========================================================================

    pub fn shutdown(&self) {
        self.running.store(false, Ordering::Release);

        self.wake_thread();

        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }

    // =========================================================================
    // INTERNAL
    // =========================================================================

    #[inline(always)]
    fn wake_thread(&self) {
        self.wake_state.1.notify_one();
    }

    fn start_if_needed(&self) {
        if self
            .running
            .compare_exchange(
                false,
                true,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err()
        {
            return;
        }

        let mut handle_guard = self.handle.lock().unwrap();

        if handle_guard.is_some() {
            return;
        }

        let sessions = Arc::clone(&self.sessions);
        let running = Arc::clone(&self.running);
        let wake_state = Arc::clone(&self.wake_state);

        let handle = thread::Builder::new()
            .name("udp-cycle".into())
            .spawn(move || {
                let interval =
                    Duration::from_millis(TICK_INTERVAL_MS);

                let mut next_tick = Instant::now();

                while running.load(Ordering::Acquire) {
                    let snapshot = sessions.load();

                    // =========================================================
                    // Нет активных сессий -> спим до пробуждения
                    // =========================================================

                    if snapshot.is_empty() {
                        let (lock, cvar) = &*wake_state;

                        let guard = lock.lock().unwrap();

                        let _unused = cvar.wait(guard);

                        next_tick = Instant::now();

                        continue;
                    }

                    // =========================================================
                    // Tick
                    // =========================================================

                    let now = now_ms();

                    for session in snapshot.values() {
                        session.process(now);
                    }

                    // =========================================================
                    // Drift compensation
                    // =========================================================

                    next_tick += interval;

                    let current = Instant::now();

                    if current < next_tick {
                        let sleep_duration =
                            next_tick - current;

                        let (lock, cvar) = &*wake_state;

                        let guard = lock.lock().unwrap();

                        let _ = cvar
                            .wait_timeout(
                                guard,
                                sleep_duration,
                            )
                            .unwrap();
                    } else {
                        let lag =
                            current.duration_since(next_tick);

                        // Если сильно отстали —
                        // пересинхронизируем цикл.
                        if lag > interval * 5 {
                            next_tick = current;
                        }
                    }
                }
            })
            .expect("Failed to spawn udp-cycle thread");

        *handle_guard = Some(handle);
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