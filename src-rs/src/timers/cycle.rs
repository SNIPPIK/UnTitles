use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use dashmap::DashMap;
use crate::net::udp::UdpBuffered;

/// Менеджер цикла с учётом реальной задержки UDP send
pub struct CycleManager {
    pub sessions: Arc<DashMap<u32, Arc<UdpBuffered>>>,
    pub running: Arc<AtomicBool>,
    pub interval_ms: u64,
    pub max_catchup_ticks: u32,
    pub max_acceleration_ms: u64,
}

impl CycleManager {
    pub fn new(interval_ms: u64) -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            running: Arc::new(AtomicBool::new(false)),
            interval_ms,
            max_catchup_ticks: 0,
            max_acceleration_ms: 0,
        }
    }

    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        self.sessions.insert(id, session);
        if !self.running.load(Ordering::SeqCst) {
            self.start();
        }
    }

    pub fn remove_session(&self, id: u32) {
        self.sessions.remove(&id);
    }

    pub fn start(&self) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }

        let sessions = self.sessions.clone();
        let running_flag = self.running.clone();
        let interval = self.interval_ms;
        let max_catchup_ticks = self.max_catchup_ticks;
        let max_accel = self.max_acceleration_ms;

        thread::spawn(move || {
            let start_time = Instant::now();
            let mut next_tick = start_time;
            let mut total_elapsed_ms: u128 = 0;
            let mut last_tick_duration_ms: u64 = 0;

            while running_flag.load(Ordering::SeqCst) {
                if sessions.is_empty() {
                    running_flag.store(false, Ordering::SeqCst);
                    break;
                }

                // --- Tick всех сессий и измерение времени ---
                let tick_start = Instant::now();
                sessions.iter().for_each(|kv| kv.value().tick());
                last_tick_duration_ms = tick_start.elapsed().as_millis() as u64;

                // --- Планирование следующего тика с учётом реального времени tick ---
                let mut next_interval = interval;
                if last_tick_duration_ms > interval / 12 {
                    next_interval = interval.saturating_sub(last_tick_duration_ms);
                    if next_interval < interval.saturating_sub(max_accel) {
                        next_interval = interval.saturating_sub(max_accel);
                    }
                }

                total_elapsed_ms += next_interval as u128;
                next_tick = start_time + Duration::from_millis(total_elapsed_ms as u64);

                // --- Catch-up loop для догонки пропущенных тиков ---
                let mut catchup_count = 0;
                while Instant::now() > next_tick && catchup_count < max_catchup_ticks {
                    sessions.iter().for_each(|kv| kv.value().tick());
                    total_elapsed_ms += interval as u128;
                    next_tick = start_time + Duration::from_millis(total_elapsed_ms as u64);
                    catchup_count += 1;
                }

                // --- Высокоточный sleep с учётом фактической длительности tick ---
                let now = Instant::now();
                if now < next_tick {
                    let mut sleep_duration = next_tick - now;
                    if sleep_duration > Duration::from_millis(last_tick_duration_ms) {
                        sleep_duration -= Duration::from_millis(last_tick_duration_ms);
                    } else {
                        sleep_duration = Duration::ZERO;
                    }

                    if sleep_duration > Duration::from_millis(2) {
                        thread::sleep(sleep_duration - Duration::from_millis(1));
                    }

                    while Instant::now() < next_tick {
                        std::hint::spin_loop();
                    }
                } else {
                    next_tick = Instant::now();
                }
            }
        });
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

use once_cell::sync::Lazy;
pub static GLOBAL_MANAGER: Lazy<Arc<CycleManager>> = Lazy::new(|| {
    let manager = Arc::new(CycleManager::new(20));
    manager.start();
    manager
});