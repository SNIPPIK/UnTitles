use crate::timers::scheduler::cycle_manager::CycleManager;
use crate::network::udp::UdpBuffered;
use once_cell::sync::Lazy;
use dashmap::DashMap;
use std::sync::{Arc, Mutex};

/// Максимальное количество UDP-сессий, обслуживаемых одним рабочим потоком (worker).
/// При превышении этого лимита создаётся новый worker.
/// Выбрано 50, потому что:
/// - Каждая сессия требует вызова `tick()` ~раз в 20 мс (50 Гц). 50 сессий дают 2500 вызовов/сек — комфортная нагрузка.
/// - При большем количестве возрастает задержка обработки (jitter) из-за последовательного обхода.
const MAX_PER_WORKER: usize = 50;

/// Воркер теперь без Mutex
struct Worker {
    /// Менеджер потов, хранящий в себе udp сессии
    manager: Arc<CycleManager>,
    
    /// Ссылки на udp сессии, для быстрого поиска и распределения между потоками
    sessions: DashMap<u32, UdpBuffered>
}

impl Worker {
    fn new() -> Self {
        let manager = CycleManager::new().expect("Failed to create timer");
        Worker {
            manager: Arc::new(manager),
            sessions: DashMap::new()
        }
    }
}

/// Балансировщик нагрузки, распределяющий сессии между несколькими `Worker`.
/// Каждый worker имеет свой независимый цикл `tick()`.
/// Балансировщик старается равномерно заполнять воркеры, но не перераспределяет сессии после добавления.
/// При добавлении сессии ищется первый воркер, у которого число сессий меньше `MAX_PER_WORKER`.
/// При удалении сессии воркер может стать пустым, и тогда он будет удалён (кроме `MIN_WORKERS`).
pub struct AutoBalancer {
    // Вектор воркеров защищён собственным мьютексом (или блокировкой AutoBalancer)
    workers: Vec<Arc<Worker>>,
    
    // Быстрый поиск воркера по session_id
    session_map: DashMap<u32, Arc<Worker>>
}

impl AutoBalancer {
    pub fn new() -> Self {
        let mut balancer = AutoBalancer {
            workers: Vec::new(),
            session_map: DashMap::new()
        };
        
        balancer.create_worker();
        balancer
    }

    /// Создаёт нового воркера с собственным `CycleManager` (интервал 20 мс = 50 тиков/сек).
    /// Возвращает `Arc<Mutex<Worker>>` для безопасного доступа из нескольких потоков балансировщика.
    fn create_worker(&mut self) -> Arc<Worker> {
        let worker = Arc::new(Worker::new());
        self.workers.push(worker.clone());
        worker
    }

    /// Удаляет пустые воркеры, оставляя минимум `MIN_WORKERS`.
    /// **Важно:** вызывается после каждого добавления/удаления. Если бы воркеров было много (тысячи),
    /// эта операция могла бы стать затратной, но при `MAX_PER_WORKER = 50` общее число воркеров обычно невелико.
    fn cleanup_empty_workers(&mut self) {
        let mut current_len = self.workers.len();

        self.workers.retain(|w| {
            if w.sessions.is_empty() {
                current_len -= 1;
                w.manager.shutdown();
                false
            } else {
                true
            }
        });
    }

    /// Добавляет сессию в балансировщике.
    /// Ищет первый воркер с числом сессий < MAX_PER_WORKER. Если такого нет, создаёт новый воркер.
    /// Затем вставляет сессию в выбранный воркер и добавляет её в `CycleManager` этого воркера.
    /// В конце удаляет пустые воркеры.
    pub fn add_session(&mut self, id: u32, session: UdpBuffered) {
        // Ищем подходящий воркер.
        // Если воркеров много, можно хранить индекс последнего неполного воркера,
        // чтобы не итерироваться с самого начала каждый раз.
        let target_worker = self.workers
            .iter()
            .find(|w| w.sessions.len() < MAX_PER_WORKER)
            .cloned()
            .unwrap_or_else(|| self.create_worker());

        target_worker.sessions.insert(id, session.clone());
        target_worker.manager.add_session(id, session);
        self.session_map.insert(id, target_worker);

        // cleanup_empty_workers() здесь НЕ нужен. Мы только что добавили сессию,
        // количество пустых воркеров не могло увеличиться.
    }

    /// Удаляет сессию из балансировщика.
    /// Ищет воркер, содержащий данную сессию, удаляет её оттуда и из `CycleManager` этого воркера.
    /// После удаления запускает очистку пустых воркеров.
    pub fn remove_session(&mut self, id: u32) {
        // Быстрый поиск воркера через индекс (O(1))
        if let Some((_, worker)) = self.session_map.remove(&id) {
            worker.sessions.remove(&id);
            worker.manager.remove_session(id);
            self.cleanup_empty_workers();
        }
    }
}

/// Глобальный синглтон балансировщика, защищённый мьютексом.
/// Все операции добавления/удаления сессий проходят через него.
pub static GLOBAL_BALANCER: Lazy<Mutex<AutoBalancer>> = Lazy::new(|| {
    Mutex::new(AutoBalancer::new())
});

/// Добавляет сессию в глобальный балансировщик
/// Обычно вызывается из конструктора `UdpBuffered`.
pub fn add_global_session(id: u32, session: UdpBuffered) {
    GLOBAL_BALANCER.lock().unwrap().add_session(id, session);
}

/// Удаляет сессию из глобального балансировщика.
/// Обычно вызывается из метода `destroy` у `UdpBuffered`.
pub fn remove_global_session(id: u32) {
    GLOBAL_BALANCER.lock().unwrap().remove_session(id);
}