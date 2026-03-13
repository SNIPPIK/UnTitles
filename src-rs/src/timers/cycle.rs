use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use crate::network::udp::UdpBuffered;

/// Максимальное количество UDP-сессий, обслуживаемых одним рабочим потоком (worker).
/// При превышении этого лимита создаётся новый worker.
const MAX_PER_WORKER: usize = 100;

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
    sessions: Arc<DashMap<u32, Arc<UdpBuffered>>>,

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
            sessions: Arc::new(DashMap::new()),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            interval,
        }
    }

    /// Добавляет сессию в менеджере. Если фоновый поток ещё не запущен,
    /// запускает его (через `start_if_needed`).
    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        self.sessions.insert(id, session);
        self.start_if_needed();
    }

    /// Удаляет сессию из менеджера.
    pub fn remove_session(&self, id: u32) {
        self.sessions.remove(&id);
    }

    /// Запускает фоновый поток, если он ещё не запущен и есть необходимость.
    /// Использует атомарный compare_exchange для безопасного запуска из нескольких потоков.
    fn start_if_needed(&self) {
        // Быстрая проверка без блокировки: если уже работает, выходим.
        if self.running.load(Ordering::Acquire) {
            return;
        }
        // Пытаемся переключить флаг с false на true. Если не удалось — значит,
        // другой поток уже запустил процесс, выходим.
        if self.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return;
        }

        // Клонируем Arc для передачи в поток.
        let sessions = self.sessions.clone();
        let running_flag = self.running.clone();
        let interval = self.interval;

        let handle = thread::spawn(move || {
            // Время следующего тика (момент, когда нужно начать новый цикл обработки).
            let start_time = Instant::now();
            let next_tick = start_time + interval;

            loop {
                // Проверяем флаг остановки.
                if !running_flag.load(Ordering::Acquire) {
                    break;
                }

                // Если нет активных сессий – не тратим ресурсы на точное ожидание,
                // просто спим с короткой паузой и проверяем флаг.
                if sessions.is_empty() {
                    thread::sleep(Duration::from_millis(10));
                    continue;
                }

                // Ожидание до наступления следующего тика.
                let now = Instant::now();
                if now >= next_tick {
                    let sleep = next_tick - now;
                    // Если спать нужно больше 2 мс, используем thread::sleep,
                    // оставляя 1 мс на активное ожидание для точности.
                    if sleep >= Duration::from_millis(2) {
                        thread::sleep(sleep - Duration::from_millis(1));
                    }

                    // Активное ожидание (spin-loop) для оставшегося времени.
                    // Закомментировано, но может быть включено для ultra-low latency.
                    while Instant::now() <= next_tick && running_flag.load(Ordering::Acquire) {
                        std::hint::spin_loop();
                    }
                }

                // --- Распределение вызовов tick() внутри одного интервала ---
                let count = sessions.len().max(1); // избегаем деления на ноль
                let step = interval / count as u32; // шаг времени между tick() разных сессий

                let mut next = Instant::now(); // момент вызова следующей сессии (относительный)

                // Проходим по всем сессиям (итератор DashMap даёт доступ к каждой записи).
                for session in sessions.iter() {
                    // Вызываем tick() для текущей сессии.
                    session.value().tick();

                    // Вычисляем время, когда должна быть вызвана следующая сессия.
                    next += step;
                    let now = Instant::now();

                    // Если до следующего вызова ещё есть время, немного спим,
                    // чтобы снизить нагрузку на CPU.
                    if now <= next {
                        let sleep = next - now;

                        if sleep >= Duration::from_micros(500) {
                            thread::sleep(sleep - Duration::from_micros(100));
                        }

                        // Активное ожидание остатка (опционально)
                        while Instant::now() < next {
                            std::hint::spin_loop();
                        }
                    }
                }
            }
        });

        // Сохраняем дескриптор потока, чтобы потом дождаться его завершения.
        *self.handle.lock().unwrap() = Some(handle);
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