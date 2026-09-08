use crate::structures::network::udp::UdpBuffered;
use crate::utils::duration::now_ms;
use arc_swap::ArcSwap;
use std::{
    collections::HashMap,
    io,
    sync::{
        atomic::{AtomicBool, Ordering, AtomicU64},
        Arc, Condvar, Mutex, MutexGuard
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant}
};

/// Интервал между тиками цикла обработки UDP-пакетов (мс).
pub const TICK_INTERVAL_MS: u64 = 20;

/// Интервал как `Duration` для вычислений.
const TICK_INTERVAL: Duration = Duration::from_millis(TICK_INTERVAL_MS);

// Желаемое среднее время активного ожидания (спина) в микросекундах
const TARGET_SPIN_TIME: Duration = Duration::from_micros(500);
// Минимально допустимый запас перед дедлайном для перехода к спину
const MIN_SPIN_MARGIN: Duration = Duration::from_micros(50);
// Максимально допустимый запас перед дедлайном
const MAX_SPIN_MARGIN: Duration = Duration::from_millis(1);

// Количество измерений для калибровки гранулярности сна
const SAMPLES: usize = 10;
// Запрашиваемый сон при калибровке (минимально заметная длительность)
const REQUESTED_SLEEP: Duration = Duration::from_micros(100);
// Верхняя граница измеренной гранулярности (защита от выбросов)
const MAX_GRANULARITY: Duration = Duration::from_millis(1);

/// Вспомогательная структура для возврата из функции `wait_until`.
/// Содержит информацию о результате ожидания.
struct WaitOutcome {
    /// Достигнут ли дедлайн (true) или ожидание прервано из-за остановки (false)
    reached_deadline: bool,
    /// Фактическое время, проведённое в активном ожидании (спине)
    spin_time: Duration,
}

// ============================================================================
// SchedulerState
// ============================================================================

/// Структура с метриками производительности цикла.
/// Все поля — атомарные для безопасного доступа из разных потоков.
pub struct SchedulerState {
    /// Количество выполненных тиков
    pub ticks: AtomicU64,

    /// Количество пропущенных тиков (из-за отставания)
    pub skipped_ticks: AtomicU64,

    /// Среднее время выполнения `process()` (EMA)
    pub avg_process_ns: AtomicU64,

    /// Максимальное время выполнения `process()`
    pub max_process_ns: AtomicU64,

    /// Средняя ошибка сна (насколько проспали дольше запланированного)
    pub avg_sleep_error_ns: AtomicU64,

    /// Максимальная ошибка сна
    pub max_sleep_error_ns: AtomicU64,

    /// Средний джиттер (отклонение от идеального расписания)
    pub avg_jitter_ns: AtomicU64,

    /// Максимальный джиттер
    pub max_jitter_ns: AtomicU64,

    /// Текущий запас времени перед дедлайном для перехода к спину
    pub spin_margin_ns: AtomicU64,

    /// Среднее время, проведённое в активном ожидании (спине)
    pub avg_spin_time_ns: AtomicU64,

    /// Минимальная гранулярность сна ОС (средний overshoot при запросе очень короткого сна)
    pub sleep_granularity_ns: AtomicU64,
}

/// Реализация `Default` для `SchedulerState`, задающая начальные значения метрик.
impl Default for SchedulerState {
    fn default() -> Self {
        Self {
            ticks: AtomicU64::new(0),
            skipped_ticks: AtomicU64::new(0),

            avg_process_ns: AtomicU64::new(0),
            max_process_ns: AtomicU64::new(0),

            avg_sleep_error_ns: AtomicU64::new(0),
            max_sleep_error_ns: AtomicU64::new(0),

            avg_jitter_ns: AtomicU64::new(0),
            max_jitter_ns: AtomicU64::new(0),

            // Начальное значение spin margin — 250 микросекунд
            spin_margin_ns: AtomicU64::new(250_000),
            avg_spin_time_ns: AtomicU64::new(0),
            sleep_granularity_ns: AtomicU64::new(0),
        }
    }
}


// ============================================================================
// Cycle
// ============================================================================

/// Управляет фоновым потоком, который периодически вызывает `process()` для всех активных UDP-сессий.
///
/// Использует `ArcSwap` для хранения карты сессий, чтобы поток мог получать
/// актуальный снимок без блокировок, а добавление/удаление сессий выполнялось быстро.
pub struct CycleManager {
    /// Активные UDP-сессии (ключ — идентификатор сессии, значение — обёрнутый UDP-буфер).
    ///
    /// `ArcSwap` даёт возможность получения непротиворечивого снимка карты.
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,

    /// Флаг активности рабочего потока. `true` — поток должен работать.
    running: Arc<AtomicBool>,

    /// Состояние пробуждения потока:
    ///
    /// - `true` — поток должен немедленно проснуться (например, при добавлении сессии);
    /// - `false` — поток может спать до следующего тика.
    ///
    /// Используется совместно с `Condvar` для мгновенного пробуждения без ожидания таймера.
    wake_state: Arc<(Mutex<bool>, Condvar)>,

    /// Дескриптор фонового потока (JoinHandle).
    handle: Mutex<Option<JoinHandle<()>>>,

    /// Общие метрики цикла, доступные для чтения извне.
    telemetry: Arc<SchedulerState>,
}

impl CycleManager {
    /// Создаёт новый менеджер цикла с пустой картой сессий.
    /// Поток не запускается до добавления первой сессии.
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            wake_state: Arc::new((Mutex::new(false), Condvar::new())),
            handle: Mutex::new(None),
            telemetry: Arc::new(SchedulerState::default()),
        })
    }

    /// Добавляет сессию в карту и запускает фоновый поток, если он ещё не запущен.
    /// После добавления пробуждает поток для немедленной обработки.
    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        // Обновляем карту сессий, вставляя новую сессию
        self.update_sessions(|map| {
            map.insert(id, session);
        });

        // Гарантируем, что поток запущен
        self.start_if_needed();
        // Немедленно будим поток, чтобы не ждать следующего тика
        self.wake_thread();
    }

    /// Удаляет сессию по идентификатору.
    /// Если после удаления сессий не осталось, останавливает поток.
    pub fn remove_session(&self, id: u32) {
        // Удаляем сессию из карты
        self.update_sessions(|map| {
            map.remove(&id);
        });

        // Проверяем, остались ли сессии
        if self.sessions.load().is_empty() {
            // Нет активных сессий — рабочий поток больше не нужен
            self.shutdown();
        } else {
            // Будим поток, чтобы он заметил изменения
            self.wake_thread();
        }
    }

    /// Применяет замыкание `update` к текущей карте сессий и сохраняет результат.
    ///
    /// Используется `Arc::make_mut` для копирования при необходимости,
    /// что позволяет безопасно обновлять карту, не затрагивая читателей.
    #[inline]
    fn update_sessions<F>(&self, update: F)
    where
        F: FnOnce(&mut HashMap<u32, Arc<UdpBuffered>>),
    {
        // Загружаем текущую полную копию карты (Arc)
        let mut current = self.sessions.load_full();

        // Если на current есть несколько Arc-ссылок (например, у worker-потока),
        // создаётся новая копия. Иначе модифицируем на месте.
        let map = Arc::make_mut(&mut current);

        // Применяем пользовательское замыкание для изменения карты
        update(map);

        // Публикуем обновлённую карту в ArcSwap
        self.sessions.store(current);
    }

    /// Запускает фоновый поток, если он ещё не запущен.
    ///
    /// Использует атомарный compare_exchange, чтобы избежать гонок
    /// при одновременном вызове из нескольких потоков.
    fn start_if_needed(&self) {
        // Пытаемся атомарно установить running = true.
        // Если уже true, значит поток работает — выходим.
        if self.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return;
        }

        // Захватываем мьютекс для доступа к дескриптору потока
        let mut handle_guard = self
            .handle
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        // Если handle уже установлен (поток существует), сбрасываем running и выходим
        if handle_guard.is_some() {
            //self.running.store(false, Ordering::Release);
            return;
        }

        // Клонируем Arc'и для передачи в поток
        let sessions = Arc::clone(&self.sessions);
        let running = Arc::clone(&self.running);
        let wake_state = Arc::clone(&self.wake_state);
        let state = Arc::clone(&self.telemetry);

        // Пытаемся создать поток
        let spawn = thread::Builder::new()
            .name("UDPCycleSystem".into())
            .spawn(move || {
                // Запускаем основной цикл
                cycle_thread(sessions, running, wake_state, state);
            });

        match spawn {
            Ok(handle) => {
                // Сохраняем дескриптор потока
                *handle_guard = Some(handle);
            }
            Err(error) => {
                // Если создать поток не удалось, сбрасываем флаг running
                self.running.store(false, Ordering::Release);
                eprintln!("[CycleManager] failed to spawn worker: {error}");
            }
        }
    }

    /// Устанавливает флаг `wake` в `true` и уведомляет поток через `Condvar`.
    #[inline]
    fn wake_thread(&self) {
        // Получаем ссылку на мьютекс и condvar
        let (lock, cvar) = &*self.wake_state;

        // Пытаемся захватить мьютекс и установить флаг пробуждения
        if let Ok(mut wake) = lock.lock() {
            *wake = true;
            cvar.notify_one();
        } else {
            // Если мьютекс отравлен, всё равно пробуем уведомить
            cvar.notify_one();
        }
    }

    /// Останавливает фоновый поток и ожидает его завершения.
    ///
    /// Безопасен для повторного вызова.
    pub fn shutdown(&self) {
        // Запрещаем потоку дальнейшую работу
        self.running.store(false, Ordering::Release);

        // Будим поток, чтобы он вышел из ожидания
        self.wake_thread();

        // Забираем JoinHandle из мьютекса
        let handle = {
            let mut guard = self
                .handle
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            guard.take()
        };

        // Присоединяем поток вне блокировки мьютекса, чтобы избежать deadlock
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }
}

/// При уничтожении `CycleManager` останавливаем поток.
impl Drop for CycleManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}


// ============================================================================
// Helpers
// ============================================================================

/// Получает lock, игнорируя статус отравления (mutex poisoning).
///
/// Если другой поток спаниковал, держа мьютекс, мы всё равно получаем доступ.
/// Это безопасно, так как состояние пересчитывается в каждом цикле.
///
/// # Аргументы
/// * `mutex` — ссылка на мьютекс, который нужно заблокировать.
///
/// # Возвращаемое значение
/// `MutexGuard`, гарантирующий доступ к данным за мьютексом.
#[inline]
fn acquire_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // Блокируем мьютекс; при отравлении извлекаем внутренние данные
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Обновляет атомарное значение через экспоненциальное скользящее среднее.
#[inline]
fn update_ema(atomic: &AtomicU64, value: u64, shift: u32) {
    let old = atomic.load(Ordering::Relaxed);

    let next = if value >= old {
        old.saturating_add((value - old) >> shift)
    } else {
        old.saturating_sub((old - value) >> shift)
    };

    atomic.store(next, Ordering::Relaxed);
}


// ============================================================================
// Main cycle thread
// ============================================================================

/// Основной цикл менеджера UDP-сессий с адаптивной калибровкой.
///
/// Периодически (с интервалом `TICK_INTERVAL`) вызывает метод `process`
/// для каждой активной сессии. Завершается при сбросе флага `running`.
/// Собирает метрики производительности и адаптирует параметры ожидания.
///
/// # Аргументы
/// * `sessions` — общий снапшот активных сессий (ArcSwap).
/// * `running` — флаг активности цикла.
/// * `wake_state` — пара (мьютекс, condvar) для пробуждения извне.
/// * `state` — общие метрики цикла.
fn cycle_thread(sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>, running: Arc<AtomicBool>, wake_state: Arc<(Mutex<bool>, Condvar)>, state: Arc<SchedulerState>) {
    let state_ref = state.as_ref();
    let mut next_deadline = Instant::now();
    const ALPHA_SHIFT: u32 = 4;

    let granularity = measure_sleep_granularity();
    state_ref.sleep_granularity_ns.store(granularity.as_nanos() as u64, Ordering::Relaxed);
    let initial_margin = granularity.saturating_mul(2).max(MIN_SPIN_MARGIN);
    state_ref.spin_margin_ns.store(initial_margin.as_nanos() as u64, Ordering::Relaxed);

    while running.load(Ordering::Acquire) {
        let tick_id = state_ref.ticks.fetch_add(1, Ordering::Relaxed) + 1;
        let tick_start = Instant::now();

        // Обработка сессий
        {
            let snapshot = sessions.load();
            if !snapshot.is_empty() {
                let now = now_ms();
                for session in snapshot.values() {
                    session.process(now);
                }
            }
        }

        let process_time = tick_start.elapsed();
        let process_ns = process_time.as_nanos() as u64;
        update_ema(&state_ref.avg_process_ns, process_ns, ALPHA_SHIFT);
        state_ref.max_process_ns.fetch_max(process_ns, Ordering::Relaxed);

        if !running.load(Ordering::Acquire) {
            break;
        }

        next_deadline += TICK_INTERVAL;
        let now = Instant::now();
        if handle_deadline_slip(now, &mut next_deadline, state_ref) {
            continue;
        }

        let spin_margin = Duration::from_nanos(state_ref.spin_margin_ns.load(Ordering::Relaxed));
        let outcome = wait_until(next_deadline, &running, &wake_state, spin_margin);
        if !outcome.reached_deadline {
            break;
        }

        let actual_wake = Instant::now();
        let oversleep = actual_wake.saturating_duration_since(next_deadline);
        let oversleep_ns = oversleep.as_nanos() as u64;
        update_ema(&state_ref.avg_sleep_error_ns, oversleep_ns, ALPHA_SHIFT);
        state_ref.max_sleep_error_ns.fetch_max(oversleep_ns, Ordering::Relaxed);

        let spin_ns = outcome.spin_time.as_nanos() as u64;
        update_ema(&state_ref.avg_spin_time_ns, spin_ns, ALPHA_SHIFT);

        if tick_id % 100 == 0 {
            let avg_spin = Duration::from_nanos(state_ref.avg_spin_time_ns.load(Ordering::Relaxed));
            let avg_oversleep = Duration::from_nanos(state_ref.avg_sleep_error_ns.load(Ordering::Relaxed));
            adapt_spin_margin(state_ref, avg_spin, avg_oversleep);
        }
    }

    // Поток завершён.
    running.store(false, Ordering::Release);
}

/// Корректирует `next_deadline` при отставании от графика.
///
/// Если текущее время больше или равно дедлайну, вычисляет, сколько тиков было пропущено,
/// и сдвигает дедлайн вперёд на соответствующее число интервалов.
/// Также обновляет метрики джиттера и пропущенных тиков.
///
/// # Аргументы
/// * `now` — текущее время.
/// * `next_deadline` — ссылка на дедлайн, который может быть изменён.
/// * `state` — метрики цикла.
///
/// # Возвращаемое значение
/// `true`, если дедлайн был сдвинут (т.е. мы отстали), `false`, если дедлайн ещё в будущем.
#[inline]
fn handle_deadline_slip(now: Instant, next_deadline: &mut Instant, state: &SchedulerState) -> bool {
    if now < *next_deadline {
        return false;
    }

    let late = now.duration_since(*next_deadline);
    let late_ns = late.as_nanos() as u64;

    state.max_jitter_ns
        .fetch_max(late_ns, Ordering::Relaxed);

    update_ema(
        &state.avg_jitter_ns,
        late_ns,
        4,
    );

    let skipped = late.as_nanos() / TICK_INTERVAL.as_nanos();

    if skipped != 0 {
        state.skipped_ticks.fetch_add(
            skipped as u64,
            Ordering::Relaxed,
        );
    }

    let advance = skipped.saturating_add(1);

    *next_deadline += TICK_INTERVAL * advance as u32;

    true
}

/// Адаптирует величину spin margin на основе среднего времени спина и ошибки сна.
///
/// Цель — поддерживать среднее время спина близким к `TARGET_SPIN_TIME`,
/// компенсируя систематические ошибки сна. Изменение ограничено пределами
/// `MIN_SPIN_MARGIN` и `MAX_SPIN_MARGIN`.
///
/// # Аргументы
/// * `state` — метрики цикла (для чтения и записи `spin_margin_ns`).
/// * `avg_spin_time` — среднее время активного ожидания.
/// * `avg_sleep_error` — средняя ошибка сна (oversleep).
fn adapt_spin_margin(state: &SchedulerState, avg_spin_time: Duration, avg_sleep_error: Duration) {
    let old_margin_ns =
        state.spin_margin_ns.load(Ordering::Relaxed);

    let old_margin = Duration::from_nanos(old_margin_ns);

    let granularity = Duration::from_nanos(
        state.sleep_granularity_ns.load(Ordering::Relaxed)
    );

    let min_margin = granularity
        .saturating_mul(2)
        .max(MIN_SPIN_MARGIN)
        .min(MAX_SPIN_MARGIN);

    let mut margin = old_margin;

    // Компенсация систематического oversleep.
    let sleep_correction = (avg_sleep_error / 2)
        .min(old_margin / 4);

    margin = margin.saturating_add(sleep_correction);

    // Коррекция по фактическому времени spin.
    if avg_spin_time > TARGET_SPIN_TIME * 2 {
        let excess = avg_spin_time - TARGET_SPIN_TIME;
        margin = margin.saturating_sub(excess / 2);
    } else if avg_spin_time < TARGET_SPIN_TIME / 2 {
        let deficit = TARGET_SPIN_TIME / 2 - avg_spin_time;
        margin = margin.saturating_add(deficit / 2);
    }

    // Не позволяем регулятору прыгать больше чем на 10% за адаптацию.
    let max_change = (old_margin / 10).max(Duration::from_nanos(1));

    let adjusted = if margin > old_margin {
        old_margin + (margin - old_margin).min(max_change)
    } else {
        old_margin - (old_margin - margin).min(max_change)
    };

    let new_margin = adjusted.clamp(
        min_margin,
        MAX_SPIN_MARGIN,
    );

    state.spin_margin_ns.store(
        new_margin.as_nanos() as u64,
        Ordering::Relaxed,
    );
}


// ============================================================================
// Wait logic
// ============================================================================

/// Ожидает наступления `deadline`, регулярно проверяя флаг `running` и сигналы пробуждения.
///
/// Использует гибридный подход: если до дедлайна больше `spin_margin`, спит с тайм-аутом
/// и возможностью пробуждения по condvar; в последние микросекунды переходит на активный
/// спин для точного попадания.
///
/// # Аргументы
/// * `deadline` — момент времени, до которого нужно ожидать.
/// * `running` — флаг активности.
/// * `wake_state` — пара (мьютекс, condvar) для внешнего пробуждения.
/// * `spin_margin` — запас времени перед дедлайном для начала спина.
///
/// # Возвращаемое значение
/// Структура `WaitOutcome` с флагом достижения дедлайна и временем спина.
fn wait_until(deadline: Instant, running: &AtomicBool, wake_state: &(Mutex<bool>, Condvar), spin_margin: Duration) -> WaitOutcome {
    loop {
        if !running.load(Ordering::Acquire) {
            return WaitOutcome {
                reached_deadline: false,
                spin_time: Duration::ZERO,
            };
        }

        let now = Instant::now();

        if now >= deadline {
            return WaitOutcome {
                reached_deadline: true,
                spin_time: Duration::ZERO,
            };
        }

        let remaining = deadline - now;

        if remaining > spin_margin {
            let timeout = remaining - spin_margin;

            wait_with_timeout(
                &wake_state.0,
                &wake_state.1,
                timeout,
            );

            continue;
        }

        // Precision phase.
        let spin_start = now;

        while Instant::now() < deadline {
            if !running.load(Ordering::Acquire) {
                return WaitOutcome {
                    reached_deadline: false,
                    spin_time: spin_start.elapsed(),
                };
            }

            std::hint::spin_loop();
        }

        return WaitOutcome {
            reached_deadline: true,
            spin_time: spin_start.elapsed(),
        };
    }
}

/// Вспомогательная функция ожидания на condvar с тайм-аутом.
///
/// Если флаг пробуждения уже установлен, сразу сбрасывает его и возвращает `true`.
/// Иначе ожидает не более `timeout`, после чего возвращает `false` (таймаут)
/// или `true` (был сигнал).
///
/// # Аргументы
/// * `lock` — мьютекс, связанный с флагом пробуждения.
/// * `cvar` — условная переменная.
/// * `timeout` — максимальное время ожидания.
///
/// # Возвращаемое значение
/// `true`, если был получен сигнал пробуждения, `false` при тайм-ауте.
#[inline]
fn wait_with_timeout(lock: &Mutex<bool>, cvar: &Condvar, timeout: Duration) -> bool {
    let mut wake = acquire_lock(lock);

    if *wake {
        *wake = false;
        return true;
    }

    let result = cvar.wait_timeout(wake, timeout);
    let (mut wake, _) = result.unwrap_or_else(|poisoned| poisoned.into_inner());
    let was_woken = *wake;

    if was_woken {
        *wake = false;
    }

    was_woken
}

/// Измеряет гранулярность сна ОС путём серии коротких снов и вычисления среднего превышения.
///
/// Запрашивает сон на 100 микросекунд несколько раз, измеряет фактическое время и
/// вычисляет среднюю величину превышения (`overshoot`). Эта величина используется
/// как оценка минимальной точности таймеров ОС.
///
/// # Возвращаемое значение
/// Среднее превышение запрошенного времени сна.
fn measure_sleep_granularity() -> Duration {
    let mut overshoots = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let start = Instant::now();
        thread::sleep(REQUESTED_SLEEP);
        let elapsed = start.elapsed();
        if elapsed > REQUESTED_SLEEP {
            overshoots.push(elapsed - REQUESTED_SLEEP);
        }
    }
    if overshoots.is_empty() {
        return Duration::ZERO;
    }
    overshoots.sort_unstable();
    let median = overshoots[overshoots.len() / 2];
    median.min(MAX_GRANULARITY)
}