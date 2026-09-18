use crate::{
    structures::{
        network::udp::socket::SocketBuffered,
        timers::scheduler::Scheduler
    },
};

use once_cell::sync::Lazy;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

/// Максимальное количество UDP-сессий, обслуживаемых одним рабочим потоком.
/// При превышении создаётся новый воркер с собственным планировщиком.
const MAX_PER_WORKER: usize = 50;

/// Воркер с собственным `Scheduler` и набором UDP-сессий.
///
/// Каждый воркер обслуживает не более `MAX_PER_WORKER` сессий,
/// вызывая их `tick()` через собственный цикл планировщика.
struct Worker {
    /// Планировщик, обслуживающий сессии воркера.
    manager: Scheduler,

    /// Сессии, принадлежащие этому воркеру (по идентификатору).
    sessions: HashMap<u32, Arc<SocketBuffered>>
}

impl Worker {
    /// Создаёт нового воркера с пустым набором сессий и новым планировщиком.
    ///
    /// # Паника
    /// Паникует, если не удалось создать `Scheduler` (проблемы с ОС/потоком).
    fn new() -> Self {
        Self {
            manager: Scheduler::new().expect("Failed to create timer"),
            sessions: HashMap::new()
        }
    }

    /// Проверяет, что воркер не содержит ни одной сессии.
    fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    /// Возвращает количество сессий, привязанных к воркеру.
    fn session_count(&self) -> usize {
        self.sessions.len()
    }
}

/// Балансировщик нагрузки между несколькими `Worker`.
///
/// Распределяет сессии по воркерам, создавая новые при переполнении
/// (`MAX_PER_WORKER`). Периодически удаляет пустые воркеры, чтобы не
/// держать лишние потоки/циклы.
///
/// **Потокобезопасность**: все методы вызываются под внешним `Mutex`
/// глобального балансировщика, поэтому сам `AutoBalancer` не содержит
/// внутренних примитивов синхронизации.
pub struct AutoBalancer {
    /// Список воркеров. Индексы могут меняться из-за `swap_remove`
    /// при очистке пустых воркеров.
    workers: Vec<Worker>,

    /// Быстрый поиск индекса воркера по `session_id`.
    /// Обновляется при перемещении воркеров в `cleanup_empty_workers`.
    session_map: HashMap<u32, usize>
}

impl AutoBalancer {
    /// Создаёт балансировщик с одним воркером по умолчанию.
    pub fn new() -> Self {
        let mut balancer = Self {
            workers: Vec::new(),
            session_map: HashMap::new(),
        };

        // Гарантируем, что в балансировщике всегда есть хотя бы один воркер.
        balancer.create_worker();
        balancer
    }

    /// Создаёт нового воркера и возвращает его индекс в `workers`.
    ///
    /// # Возвращаемое значение
    /// Индекс только что созданного воркера.
    fn create_worker(&mut self) -> usize {
        // Индекс нового воркера совпадает с текущей длиной массива.
        let index = self.workers.len();
        self.workers.push(Worker::new());
        index
    }

    /// Удаляет пустые воркеры из списка.
    ///
    /// Использует `swap_remove`, поэтому при удалении воркера
    /// последний элемент массива перемещается на его место. Это
    /// требует обновления индексов в `session_map`.
    fn cleanup_empty_workers(&mut self) {
        let mut index = 0;

        while index < self.workers.len() {
            // Если воркер не пуст — просто переходим к следующему.
            if !self.workers[index].is_empty() {
                index += 1;
                continue;
            }

            // Останавливаем цикл и потоки воркера.
            self.workers[index].manager.shutdown();

            // swap_remove: последний элемент перемещается на `index`.
            self.workers.swap_remove(index);

            // После swap_remove последний воркер мог переехать на `index`.
            // Обновляем все записи session_map, которые указывали на
            // старый индекс перемещённого воркера.
            if index < self.workers.len() {
                for worker_id in self.session_map.values_mut() {
                    if *worker_id == self.workers.len() {
                        *worker_id = index;
                    }
                }
            }
            // Не увеличиваем `index`: на его место пришёл другой воркер,
            // который тоже нужно проверить.
        }
    }

    /// Добавляет сессию в наименее загруженный воркер.
    ///
    /// Если все воркеры заполнены (`MAX_PER_WORKER`), создаётся новый.
    ///
    /// # Аргументы
    /// * `id` — идентификатор сессии.
    /// * `session` — обёртка UDP-сессии, разделяемая между воркером и планировщиком.
    pub fn add_session(&mut self, id: u32, session: Arc<SocketBuffered>) {
        // Ищем воркер со свободным местом. Если такого нет — создаём нового.
        let worker_index = self
            .workers
            .iter()
            .position(|worker| worker.session_count() < MAX_PER_WORKER)
            .unwrap_or_else(|| self.create_worker());

        let worker = &mut self.workers[worker_index];

        // Клонируем Arc: одна ссылка в карте воркера, другая — в планировщике.
        worker.sessions.insert(id, session.clone());
        worker.manager.add_session(id, session);

        // Регистрируем сессию в глобальной карте для быстрого поиска.
        self.session_map.insert(id, worker_index);
    }

    /// Удаляет сессию из балансировщика.
    ///
    /// Если после удаления воркер становится пустым — он уничтожается.
    ///
    /// # Аргументы
    /// * `id` — идентификатор удаляемой сессии.
    pub fn remove_session(&mut self, id: u32) {
        // Забираем индекс воркера; если сессии нет — ничего не делаем.
        let Some(worker_index) = self.session_map.remove(&id) else {
            return;
        };

        // Убираем сессию из карты воркера и останавливаем её в планировщике.
        if let Some(worker) = self.workers.get_mut(worker_index) {
            worker.sessions.remove(&id);
            worker.manager.remove_session(id);
        }

        // Прибираем воркеры, которые стали пустыми.
        self.cleanup_empty_workers();
    }
}

/// Глобальный балансировщик.
///
/// Инициализируется лениво при первом обращении (`Lazy`), так как создание
/// `AutoBalancer` требует запуска минимум одного воркера. Все обращения —
/// через `Mutex`, поскольку балансировщик мутабельный и общий для потоков.
pub static GLOBAL_BALANCER: Lazy<Mutex<AutoBalancer>> =
    Lazy::new(|| Mutex::new(AutoBalancer::new()));

/// Добавляет сессию в глобальный балансировщик.
///
/// Оборачивает сессию в `Arc` и делегирует добавление в `AutoBalancer`.
/// Игнорирует отравление мьютекса (balancer должен продолжать работать).
///
/// # Аргументы
/// * `id` — идентификатор сессии.
/// * `session` — объект UDP-сессии (обёртка сокета с буфером).
pub fn add_global_session(id: u32, session: SocketBuffered) {
    GLOBAL_BALANCER
        .lock()
        .unwrap()
        .add_session(id, Arc::new(session));
}

/// Удаляет сессию из глобального балансировщика.
///
/// Игнорирует отравление мьютекса.
///
/// # Аргументы
/// * `id` — идентификатор удаляемой сессии.
pub fn remove_global_session(id: u32) {
    GLOBAL_BALANCER
        .lock()
        .unwrap()
        .remove_session(id);
}