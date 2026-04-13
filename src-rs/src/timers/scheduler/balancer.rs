use std::{
    sync::{
        Arc, Mutex,
    }
};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use crate::network::udp::UdpBuffered;
use crate::timers::scheduler::cycle_manager::CycleManager;

/// Максимальное количество UDP-сессий, обслуживаемых одним рабочим потоком (worker).
/// При превышении этого лимита создаётся новый worker.
/// Выбрано 50, потому что:
/// - Каждая сессия требует вызова `tick()` ~раз в 20 мс (50 Гц). 50 сессий дают 2500 вызовов/сек — комфортная нагрузка.
/// - При большем количестве возрастает задержка обработки (jitter) из-за последовательного обхода.
const MAX_PER_WORKER: usize = 50;

/// Минимальное количество рабочих потоков, которое всегда должно существовать,
/// даже если они пусты (чтобы избежать лишних созданий/удалений).
/// При активной работе частое создание/удаление потоков вызывает накладные расходы.
const MIN_WORKERS: usize = 1;

/// Рабочий процесс (worker), содержащий свой `CycleManager` и карту сессий.
/// Использует `DashMap` для быстрого доступа при добавлении/удалении на стороне балансировщика.
/// В отличие от `CycleManager`, здесь нам не нужен snapshot для итерации, так как `CycleManager` сам управляет циклом.
struct Worker {
    manager: Arc<CycleManager>,
    sessions: DashMap<u32, Arc<UdpBuffered>>,
}

/// Балансировщик нагрузки, распределяющий сессии между несколькими `Worker`.
/// Каждый worker имеет свой независимый цикл `tick()`.
/// Балансировщик старается равномерно заполнять воркеры, но не перераспределяет сессии после добавления.
/// При добавлении сессии ищется первый воркер, у которого число сессий меньше `MAX_PER_WORKER`.
/// При удалении сессии воркер может стать пустым, и тогда он будет удалён (кроме `MIN_WORKERS`).
pub struct AutoBalancer {
    workers: Vec<Arc<Mutex<Worker>>>,
    session_map: DashMap<u32, Arc<Mutex<Worker>>>
}

impl AutoBalancer {
    pub fn new() -> Self {
        let mut balancer = Self {
            workers: Vec::new(),
            session_map: DashMap::new()
        };
        balancer.create_worker();
        balancer
    }

    /// Создаёт нового воркера с собственным `CycleManager` (интервал 20 мс = 50 тиков/сек).
    /// Возвращает `Arc<Mutex<Worker>>` для безопасного доступа из нескольких потоков балансировщика.
    fn create_worker(&mut self) -> Arc<Mutex<Worker>> {
        let manager = Arc::new(CycleManager::new());
        let worker = Arc::new(Mutex::new(Worker {
            manager: manager.clone(),
            sessions: DashMap::new(),
        }));
        self.workers.push(worker.clone());
        worker
    }

    /// Удаляет пустые воркеры, оставляя минимум `MIN_WORKERS`.
    /// **Важно:** вызывается после каждого добавления/удаления. Если бы воркеров было много (тысячи),
    /// эта операция могла бы стать затратной, но при `MAX_PER_WORKER = 50` общее число воркеров обычно невелико.
    fn cleanup_empty_workers(&mut self) {
        let mut current_len = self.workers.len();

        self.workers.retain(|w| {
            let is_empty = w.lock().unwrap().sessions.is_empty();

            if is_empty && current_len > MIN_WORKERS {
                current_len -= 1;

                // Чтобы не держать блокировку self.workers, выгружаем менеджер
                let manager = w.lock().unwrap().manager.clone();
                tokio::spawn(async move {
                    manager.shutdown().await;
                });

                false // Удаляем
            } else {
                true // Оставляем
            }
        });
    }

    /// Добавляет сессию в балансировщике.
    /// Ищет первый воркер с числом сессий < MAX_PER_WORKER. Если такого нет, создаёт новый воркер.
    /// Затем вставляет сессию в выбранный воркер и добавляет её в `CycleManager` этого воркера.
    /// В конце удаляет пустые воркеры.
    pub fn add_session(&mut self, id: u32, session: Arc<UdpBuffered>) {
        // Ищем подходящий воркер.
        // Если воркеров много, можно хранить индекс последнего неполного воркера,
        // чтобы не итерироваться с самого начала каждый раз.
        let target_worker = self.workers
            .iter()
            .find(|w| {
                let w_lock = w.lock().unwrap();
                w_lock.sessions.len() < MAX_PER_WORKER
            })
            .cloned()
            .unwrap_or_else(|| self.create_worker());

        // Вставляем данные
        {
            let w_lock = target_worker.lock().unwrap();
            w_lock.sessions.insert(id, session.clone());
            w_lock.manager.add_session(id, session);
        }

        // Сохраняем связь в индекс, чтобы remove_session работал мгновенно
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
            {
                let w_lock = worker.lock().unwrap();
                // Удаляем из DashMap внутри воркера
                w_lock.sessions.remove(&id);
                // Удаляем из CycleManager
                w_lock.manager.remove_session(id);
            }

            // Вот теперь имеет смысл проверить, не пора ли схлопнуть пустые воркеры
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
pub fn add_global_session(id: u32, session: Arc<UdpBuffered>) {
    let mut bal = GLOBAL_BALANCER.lock().unwrap();
    bal.add_session(id, session);
}

/// Удаляет сессию из глобального балансировщика.
/// Обычно вызывается из метода `destroy` у `UdpBuffered`.
pub fn remove_global_session(id: u32) {
    let mut bal = GLOBAL_BALANCER.lock().unwrap();
    bal.remove_session(id);
}