use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use dashmap::DashMap;
use crate::net::udp::UdpBuffered;

/// Менеджер цикла с точным планированием на f64
pub struct CycleManager {
    sessions: Arc<DashMap<u32, Arc<UdpBuffered>>>,
    running: Arc<AtomicBool>,
    handle: Mutex<Option<thread::JoinHandle<()>>>,
    interval: Duration, // храним как Duration для точности
}

impl CycleManager {
    pub fn new(interval_ms: f64) -> Self {
        let interval = Duration::from_secs_f64(interval_ms / 1000.0);
        Self {
            sessions: Arc::new(DashMap::new()),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            interval,
        }
    }

    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        self.sessions.insert(id, session);
        self.start_if_needed();
    }

    pub fn remove_session(&self, id: u32) {
        self.sessions.remove(&id);
    }

    fn start_if_needed(&self) {
        if self.running.load(Ordering::Acquire) {
            return;
        }
        // Пытаемся переключить флаг с false на true
        if self.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return; // уже кто-то запустил
        }

        let sessions = self.sessions.clone();
        let running_flag = self.running.clone();
        let interval = self.interval;

        let handle = thread::spawn(move || {
            let start_time = Instant::now();
            let mut next_tick = start_time + interval;

            loop {
                if !running_flag.load(Ordering::Acquire) {
                    break;
                }

                // Если нет активных сессий – спим с проверкой, не тратим ресурсы
                if sessions.is_empty() {
                    thread::sleep(Duration::from_millis(100));
                    // переустанавливаем start_time и next_tick при появлении данных?
                    // Лучше просто перейти к началу цикла, флаг проверится
                    continue;
                }

                // Ожидание до следующего тика с учётом возможного опоздания
                let now = Instant::now();
                if now < next_tick {
                    let sleep_dur = next_tick - now;
                    if sleep_dur > Duration::from_millis(2) {
                        // Спим почти всё время, оставляя 1 мс на точность
                        thread::sleep(sleep_dur - Duration::from_millis(1));
                    }
                    // Активное ожидание остатка
                    while Instant::now() < next_tick && running_flag.load(Ordering::Acquire) {
                        std::hint::spin_loop();
                    }
                }

                // Проверка флага после ожидания
                if !running_flag.load(Ordering::Acquire) {
                    break;
                }

                // Выполняем тик всех сессий
                sessions.iter().for_each(|kv| kv.value().tick());

                // Планируем следующий тик
                let now = Instant::now();
                let mut target = next_tick + interval;

                // Если мы отстали (например, тик занял много времени), догоняем
                while now > target && running_flag.load(Ordering::Acquire) {
                    // Пропущенный тик – выполняем ещё один немедленно
                    sessions.iter().for_each(|kv| kv.value().tick());
                    target = target + interval;
                }

                // Устанавливаем следующее целевое время
                next_tick = target;
            }
        });

        *self.handle.lock().unwrap() = Some(handle);
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::Release);
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }
}

impl Drop for CycleManager {
    fn drop(&mut self) {
        self.stop();
    }
}

use once_cell::sync::Lazy;
use std::sync::Mutex as StdMutex;

// Глобальный менеджер, обёрнутый в Mutex для безопасного доступа из нескольких потоков
pub static GLOBAL_MANAGER: Lazy<Arc<StdMutex<CycleManager>>> = Lazy::new(|| {
    Arc::new(StdMutex::new(CycleManager::new(20.0)))
});

// Вспомогательные функции для работы с глобальным менеджером
pub fn add_global_session(id: u32, session: Arc<UdpBuffered>) {
    let guard = GLOBAL_MANAGER.lock().unwrap();
    guard.add_session(id, session);
}

pub fn remove_global_session(id: u32) {
    let guard = GLOBAL_MANAGER.lock().unwrap();
    guard.remove_session(id);
}