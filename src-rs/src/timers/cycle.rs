use std::{
    collections::{
        HashMap
    },
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
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
    handle: Mutex<Option<thread::JoinHandle<()>>>,

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
        // Быстрая проверка: если уже запущен (флаг running установлен), выходим.
        // Ordering::Acquire гарантирует, что мы увидим все записи, сделанные до установки флага в другом потоке.
        if self.running.load(Ordering::Acquire) {
            return;
        }

        // Захватываем мьютекс на handle, чтобы безопасно заменить его новым потоком.
        let mut handle_guard = self.handle.lock().unwrap();

        // Повторная проверка под мьютексом: возможно, другой поток уже запустил поток
        // и изменил running между первой проверкой и захватом мьютекса.
        // Используем compare_exchange для атомарной установки running в true, только если она была false.
        // Ordering::AcqRel означает: успех — AcqRel (загружаем с Acquire, сохраняем с Release),
        // неудача — Acquire (просто загружаем).
        if self.running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            // Если обмен не удался (running уже true), значит поток уже запущен — выходим.
            return;
        }

        // Клонируем Arc для передачи в новый поток.
        let sessions_ptr = self.sessions.clone();
        let running_flag = self.running.clone();
        let interval = self.interval;

        // Запускаем фоновый поток.
        let handle = thread::spawn(move || {
            // Момент, когда должен быть выполнен следующий тик.
            // Изначально устанавливаем в текущее время + интервал.
            let mut next_tick = Instant::now() + interval;

            // Порог, выше которого используем сон, ниже — активное ожидание.
            // 250 мкс — достаточно для точности, но экономит CPU при больших задержках.
            let spin_limit = Duration::from_micros(250);

            loop {
                // Проверяем флаг остановки. Если running сброшен (например, при вызове stop()), выходим из цикла.
                if !running_flag.load(Ordering::Acquire) {
                    break;
                }

                // Вычисляем время следующего тика (базовое планирование).
                next_tick += interval;

                // Получаем "снимок" всех активных сессий.
                // Предполагается, что sessions.load() возвращает lock-free коллекцию,
                // которую можно безопасно читать без блокировок, даже если другие потоки её модифицируют.
                let snapshot = sessions_ptr.load();

                // Параллельно вызываем tick() для каждой сессии, используя Rayon.
                // Par_bridge позволяет превратить обычный итератор по значениям снимка в параллельный.
                // Это ускоряет обработку, если сессий много и tick() не слишком лёгкий.
                snapshot.values().for_each(|session| {
                    session.tick();
                });

                let mut now = Instant::now();

                // Контроль дрифта (накопления ошибки времени) и ситуации "пулемётной очереди".
                // Если текущее время уже позже запланированного next_tick, значит мы не успеваем.
                if now > next_tick {
                    // Если опоздание больше, чем один интервал, вероятно, была большая пауза (например, система уснула).
                    // В таком случае сбрасываем базу: следующий тик планируем от текущего момента.
                    if now > next_tick + interval {
                        next_tick = now + interval;
                    }
                    // Если опоздание меньше интервала, просто пропускаем ожидание и переходим к следующей итерации.
                    // Это позволяет наверстать упущенное, но не создаёт лишней нагрузки.
                    continue;
                }

                // Вычисляем оставшееся время до следующего тика.
                let remaining = next_tick - now;

                // Гибридное ожидание:
                if remaining > spin_limit {
                    // Если осталось больше spin_limit, засыпаем на основную часть времени.
                    // Сон экономит CPU, но может быть неточным из-за планировщика ОС.
                    thread::sleep(remaining - spin_limit);
                    now = Instant::now(); // обновляем время после сна
                }

                // Короткий активный спин-луп для точной "дотяжки" до нужного момента.
                // Используем Relaxed порядок для флага, так как нам не нужна синхронизация здесь,
                // и мы часто читаем атомарно (это достаточно дёшево).
                while now < next_tick && running_flag.load(Ordering::Relaxed) {
                    std::hint::spin_loop(); // подсказка процессору, что мы в спин-лупе
                    now = Instant::now();
                }
            }
        });

        *handle_guard = Some(handle);
    }

    /// Останавливает фоновый поток и дожидается его завершения.
    /// Может быть вызван явно или автоматически в Drop.
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