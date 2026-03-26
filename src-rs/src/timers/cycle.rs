use std::{
    collections::{
        HashMap
    },
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use dashmap::DashMap;
use arc_swap::ArcSwap;
use once_cell::sync::Lazy;
use crate::network::udp::UdpBuffered;

/// Максимальное количество UDP-сессий, обслуживаемых одним рабочим потоком (worker).
/// При превышении этого лимита создаётся новый worker.
const MAX_PER_WORKER: usize = 50;

/// Минимальное количество рабочих потоков, которое всегда должно существовать,
/// даже если они пусты (чтобы избежать лишних созданий/удалений).
const MIN_WORKERS: usize = 1;

/// -------------------------------------
/// CycleManager — управляет периодическим вызовом tick() для группы UDP-сессий.
/// Каждый worker владеет одним CycleManager, который в фоновом потоке
/// равномерно распределяет вызовы tick() между своими сессиями в течение заданного интервала.
/// -------------------------------------
pub struct CycleManager {
    /// Хранилище активных сессий, привязанных к этому менеджеру.
    /// Ключ — идентификатор сессии, значение — Arc<UdpBuffered>.
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,

    /// Флаг, сигнализирующий фоновому потоку о необходимости остановиться.
    running: Arc<AtomicBool>,

    /// Дескриптор фонового потока, в котором выполняется цикл тиков.
    handle: Mutex<Option<tokio::task::JoinHandle<()>>>,

    /// Интервал между полными циклами обработки всех сессий (в миллисекундах,
    /// преобразуется в Duration).
    interval: Duration,
}

impl CycleManager {
    /// Создаёт новый CycleManager с заданным интервалом в миллисекундах.
    pub fn new(interval_ms: f64) -> Self {
        let interval = Duration::from_secs_f64(interval_ms / 1000.0);
        Self {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            interval,
        }
    }

    /// Добавляет сессию в менеджере. Если фоновый поток ещё не запущен,
    /// запускает его (через `start_if_needed`).
    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        let mut map = self.sessions.load_full();
        Arc::make_mut(&mut map).insert(id, session);
        self.sessions.store(map);

        self.start_if_needed();
    }

    /// Удаляет сессию из менеджера.
    pub fn remove_session(&self, id: u32) {
        let mut map = self.sessions.load_full();
        Arc::make_mut(&mut map).remove(&id);
        self.sessions.store(map);
    }

    /// Запускает фоновый поток, если он ещё не запущен и есть необходимость.
    /// Использует атомарный compare_exchange для безопасного запуска из нескольких потоков.
    fn start_if_needed(&self) {
        if self.running.load(Ordering::Acquire) {
            return;
        }

        let mut handle_guard = self.handle.lock().unwrap();
        if self.running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }

        let sessions_ptr = self.sessions.clone();
        let running_flag = self.running.clone();
        let interval = self.interval;

        let handle = tokio::spawn(async move {
            const SPIN_THRESHOLD: Duration = Duration::from_micros(50); // финальная дотяжка для точности

            let mut next_tick = Instant::now() + interval;

            loop {
                if !running_flag.load(Ordering::Acquire) {
                    break;
                }

                let now = Instant::now();

                // ===== SLEEP PHASE =====
                if next_tick > now {
                    let mut remaining = next_tick - now;
                    while remaining > SPIN_THRESHOLD {
                        tokio::time::sleep(remaining - SPIN_THRESHOLD).await;
                        remaining = next_tick - Instant::now();
                    }
                }

                // ===== SPIN PHASE =====
                while Instant::now() < next_tick {
                    std::hint::spin_loop(); // короткий busy-wait
                }

                // ===== EXECUTION =====
                let snapshot = sessions_ptr.load();
                let sessions: Vec<_> = snapshot.values().collect();

                for chunk in sessions.chunks(8) {
                    for session in chunk {
                        session.tick();
                    }
                    // небольшая пауза между чанками, чтобы не блокировать другие async-таски
                    tokio::task::yield_now().await;
                }

                // ===== NEXT TICK =====
                next_tick += interval;

                // ===== DRIFT COMPENSATION =====
                let now = Instant::now();
                if now > next_tick {
                    let drift = now.duration_since(next_tick);
                    let missed_ticks = (drift.as_nanos() / interval.as_nanos()) as u32 + 1;
                    next_tick += interval * missed_ticks;
                }
            }
        });

        *handle_guard = Some(handle);
    }

    /// Останавливает фоновый поток и дожидается его завершения.
    /// Может быть вызван явно или автоматически в Drop.
    pub async fn stop(&self) {
        self.running.store(false, Ordering::Release);

        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.await;
        }
    }
}

impl Drop for CycleManager {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// -------------------------------------
/// Worker — объединяет CycleManager и множество сессий, закреплённых за ним.
/// Используется внутри AutoBalancer для группировки сессий по worker.
/// -------------------------------------
struct Worker {
    /// Менеджер, который управляет циклом вызовов tick() для сессий этого workers.
    manager: Arc<CycleManager>,

    /// Сессии, принадлежащие данному worker's.
    sessions: DashMap<u32, Arc<UdpBuffered>>,
}

/// AutoBalancer — балансировщик нагрузки, распределяющий UDP-сессии по рабочим потокам (worker).
/// Каждый worker имеет свой CycleManager и лимит на количество сессий.
/// При достижении лимита создаётся новый worker. Пустые workers удаляются,
/// но не меньше MIN_WORKERS.
pub struct AutoBalancer {
    /// Вектор всех существующих worker. Каждый worker обёрнут в Arc<Mutex>,
    /// чтобы можно было безопасно изменять его содержимое из разных потоков
    /// (хотя в текущей реализации все операции с балансировщиком предполагают
    /// внешнюю синхронизацию через Mutex на уровне глобального балансировщика).
    workers: Vec<Arc<Mutex<Worker>>>,
}

impl AutoBalancer {
    /// Создаёт новый балансировщик с одним worker.
    pub fn new() -> Self {
        let mut balancer = Self { workers: Vec::new() };
        balancer.create_worker();
        balancer
    }

    /// Создаёт нового worker's с собственным CycleManager (интервал 20 мс)
    /// и добавляет его в список workers. Возвращает Arc<Mutex<Worker>>.
    fn create_worker(&mut self) -> Arc<Mutex<Worker>> {
        let manager = Arc::new(CycleManager::new(20.0));
        let worker = Arc::new(Mutex::new(Worker {
            manager: manager.clone(),
            sessions: DashMap::new(),
        }));
        self.workers.push(worker.clone());
        worker
    }

    /// Удаляет пустые worker's из списка, оставляя как минимум MIN_WORKERS.
    fn cleanup_empty_workers(&mut self) {
        let len = self.workers.len();
        self.workers.retain(|w| {
            let w_lock = w.lock().unwrap();
            // Оставляем worker, если в нём есть сессии, или если общее количество
            // после удаления станет меньше MIN_WORKERS.
            !w_lock.sessions.is_empty() || len <= MIN_WORKERS
        });
    }

    /// Добавляет сессию в балансировщике. Выбирает worker с наименьшей загрузкой
    /// (первый, у которого меньше MAX_PER_WORKER сессий), либо создаёт нового,
    /// если все заняты. После добавления удаляет пустые workers.
    pub fn add_session(&mut self, id: u32, session: Arc<UdpBuffered>) {
        // Ищем worker, у которого ещё есть свободные места.
        let mut target = None;
        for w in &self.workers {
            let w_lock = w.lock().unwrap();
            if w_lock.sessions.len() < MAX_PER_WORKER {
                target = Some(w.clone());
                break;
            }
        }

        // Если не нашли, создаём нового worker
        if target.is_none() {
            target = Some(self.create_worker());
        }

        let worker = target.unwrap();
        {
            let w_lock = worker.lock().unwrap();
            w_lock.sessions.insert(id, session.clone());
            w_lock.manager.add_session(id, session);
        }

        // Удаляем пустые workers (кроме минимального количества).
        self.cleanup_empty_workers();
    }

    /// Удаляет сессию из балансировщика. Ищет worker, содержащий данную сессию,
    /// и удаляет её оттуда. После удаления также запускает очистку пустых worker.
    pub fn remove_session(&mut self, id: u32) {
        for w in &self.workers {
            let w_lock = w.lock().unwrap();
            if w_lock.sessions.remove(&id).is_some() {
                w_lock.manager.remove_session(id);
                break;
            }
        }

        self.cleanup_empty_workers();
    }
}

/// -------------------------------------
/// Глобальный экземпляр AutoBalancer (синглтон), доступный из любого места программы.
/// Используется для добавления и удаления сессий без необходимости явно создавать
/// и хранить балансировщик.
/// -------------------------------------
pub static GLOBAL_BALANCER: Lazy<Mutex<AutoBalancer>> = Lazy::new(|| {
    Mutex::new(AutoBalancer::new())
});

/// Добавляет сессию в глобальном балансировщике
pub fn add_global_session(id: u32, session: Arc<UdpBuffered>) {
    let mut bal = GLOBAL_BALANCER.lock().unwrap();
    bal.add_session(id, session);
}

/// Удаляет сессию из глобального балансировщика.
pub fn remove_global_session(id: u32) {
    let mut bal = GLOBAL_BALANCER.lock().unwrap();
    bal.remove_session(id);
}