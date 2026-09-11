use crate::structures::network::udp::socket::SocketBuffered;
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
pub const TICK_INTERVAL_MS: u32 = 20;

const ALPHA_SHIFT: u32 = 4;
const ADAPT_INTERVAL: u64 = 100;

/// Количество измерений для калибровки гранулярности сна
const SAMPLES: usize = 10;



/// Интервал как `Duration` для вычислений.
const TICK_INTERVAL: Duration = Duration::from_millis(TICK_INTERVAL_MS as u64);

/// Желаемое среднее время активного ожидания (спина) в микросекундах
const TARGET_SPIN_TIME: Duration = Duration::from_micros(500);

/// Минимально допустимый запас перед дедлайном для перехода к спину
const MIN_SPIN_MARGIN: Duration = Duration::from_micros(50);

/// Максимально допустимый запас перед дедлайном
const MAX_SPIN_MARGIN: Duration = Duration::from_millis(1);

/// Запрашиваемый сон при калибровке (минимально заметная длительность)
const REQUESTED_SLEEP: Duration = Duration::from_micros(ADAPT_INTERVAL);

/// Верхняя граница измеренной гранулярности (защита от выбросов)
const MAX_GRANULARITY: Duration = Duration::from_millis(1);



/// Результат ожидания scheduler'а.
#[derive(Debug, Copy, Clone)]
struct WaitOutcome {
    /// Достигнут ли запланированный deadline.
    reached_deadline: bool,

    /// Время, проведённое в активном spin.
    spin_time: Duration,

    /// Насколько scheduler оказался за deadline
    /// в момент перехода в precision phase.
    sleep_overshoot: Duration
}

// ============================================================================
// SchedulerState
// ============================================================================

/// Атомарное состояние и метрики scheduler'а.
///
/// Все временные значения хранятся в наносекундах.
/// EMA-значения обновляются без блокировок.
pub struct SchedulerState {
    // ========================================================================
    // Cycle
    // ========================================================================

    /// Общее количество реально выполненных тиков.
    pub ticks: AtomicU64,

    // ========================================================================
    // Processing
    // ========================================================================

    /// EMA времени обработки всех активных UDP-сессий.
    pub avg_process_ns: AtomicU64,

    /// Максимальное время обработки всех активных UDP-сессий.
    pub max_process_ns: AtomicU64,

    // ========================================================================
    // Scheduling
    // ========================================================================

    /// EMA абсолютного отклонения от запланированного deadline.
    pub avg_jitter_ns: AtomicU64,

    /// Максимальное отклонение от deadline.
    pub max_jitter_ns: AtomicU64,

    // ========================================================================
    // Sleep
    // ========================================================================

    /// EMA превышения времени системного ожидания
    /// относительно момента перехода к precision phase.
    pub avg_sleep_overshoot_ns: AtomicU64,

    /// Максимальное превышение системного ожидания.
    pub max_sleep_overshoot_ns: AtomicU64,

    /// Измеренная базовая точность системного sleep.
    pub sleep_granularity_ns: AtomicU64,

    // ========================================================================
    // Spin
    // ========================================================================

    /// Текущий запас времени перед deadline,
    /// используемый для перехода в precision phase.
    pub spin_margin_ns: AtomicU64,

    /// EMA времени активного ожидания.
    pub avg_spin_time_ns: AtomicU64,
}

impl Default for SchedulerState {
    #[inline]
    fn default() -> Self {
        Self {
            // Cycle
            ticks: AtomicU64::new(0),

            // Processing
            avg_process_ns: AtomicU64::new(0),
            max_process_ns: AtomicU64::new(0),

            // Scheduling
            avg_jitter_ns: AtomicU64::new(0),
            max_jitter_ns: AtomicU64::new(0),

            // Sleep
            avg_sleep_overshoot_ns: AtomicU64::new(0),
            max_sleep_overshoot_ns: AtomicU64::new(0),
            sleep_granularity_ns: AtomicU64::new(0),

            // Spin
            spin_margin_ns: AtomicU64::new(
                MIN_SPIN_MARGIN.as_nanos() as u64
            ),
            avg_spin_time_ns: AtomicU64::new(0),
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
    sessions: Arc<ArcSwap<HashMap<u32, Arc<SocketBuffered>>>>,

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
    pub fn add_session(&self, id: u32, session: Arc<SocketBuffered>) {
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
        F: FnOnce(&mut HashMap<u32, Arc<SocketBuffered>>),
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


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Получает lock, игнорируя статус отравления (mutex poisoning).
#[inline]
fn acquire_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Обновляет атомарное значение через экспоненциальное скользящее среднее.
/// Вариант с двойным EMA (быстрый + медленный) для более реактивного отклика.
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

// ---------------------------------------------------------------------------
// Main cycle thread
// ---------------------------------------------------------------------------

fn cycle_thread(
    sessions: Arc<ArcSwap<HashMap<u32, Arc<SocketBuffered>>>>,
    running: Arc<AtomicBool>,
    wake_state: Arc<(Mutex<bool>, Condvar)>,
    state: Arc<SchedulerState>,
) {
    let state_ref = state.as_ref();
    let mut next_deadline = Instant::now();

    // --------------------------  Initial calibration  -----------------------
    let granularity = measure_sleep_granularity();
    state_ref.sleep_granularity_ns.store(granularity.as_nanos() as u64, Ordering::Relaxed);

    let initial_margin = granularity
        .saturating_mul(2)
        .max(MIN_SPIN_MARGIN)
        .min(MAX_SPIN_MARGIN);
    state_ref.spin_margin_ns.store(initial_margin.as_nanos() as u64, Ordering::Relaxed);

    // ---------------------------  Main loop  -------------------------------
    while running.load(Ordering::Acquire) {
        let tick_id = state_ref.ticks.fetch_add(1, Ordering::Relaxed) + 1;
        let tick_start = Instant::now();

        // -----------------------  Process sessions  -----------------------
        let ticks = handle_deadline_slip(tick_start, &mut next_deadline, state_ref);

        if ticks > 0 {
            let snapshot = sessions.load();

            if !snapshot.is_empty() {
                for _ in 0..ticks {
                    let now = now_ms();

                    for session in snapshot.values() {
                        session.tick(now);
                    }
                }
            }

            continue;
        }

        // -----------------------  Collect metrics  -----------------------
        let process_ns = tick_start.elapsed().as_nanos() as u64;
        update_ema(&state_ref.avg_process_ns, process_ns, ALPHA_SHIFT);
        state_ref.max_process_ns.fetch_max(process_ns, Ordering::Relaxed);

        // -----------------------  Stop check  ----------------------------
        if !running.load(Ordering::Acquire) {
            break;
        }

        // -----------------------  Wait until deadline  --------------------
        let spin_margin = Duration::from_nanos(state_ref.spin_margin_ns.load(Ordering::Relaxed));
        let outcome = wait_until(next_deadline, &running, &wake_state, spin_margin);

        if !outcome.reached_deadline {
            break;
        }

        // -----------------------  Sleep diagnostics  --------------------
        let sleep_overshoot_ns = outcome.sleep_overshoot.as_nanos() as u64;
        update_ema(&state_ref.avg_sleep_overshoot_ns, sleep_overshoot_ns, ALPHA_SHIFT);
        state_ref.max_sleep_overshoot_ns.fetch_max(sleep_overshoot_ns, Ordering::Relaxed);

        // -----------------------  Spin diagnostics  ---------------------
        let spin_ns = outcome.spin_time.as_nanos() as u64;
        update_ema(&state_ref.avg_spin_time_ns, spin_ns, ALPHA_SHIFT);

        // -----------------------  Adaptive calibration  -----------------
        if tick_id % ADAPT_INTERVAL == 0 {
            let avg_spin = Duration::from_nanos(state_ref.avg_spin_time_ns.load(Ordering::Relaxed));
            let avg_sleep_overshoot = Duration::from_nanos(state_ref.avg_sleep_overshoot_ns.load(Ordering::Relaxed));
            adapt_spin_margin(state_ref, avg_spin, avg_sleep_overshoot);
        }
    }

    running.store(false, Ordering::Release);
}

// ---------------------------------------------------------------------------
// Deadline slip handling (now also performs a quick “catch‑up” processing)
// ---------------------------------------------------------------------------

#[inline]
fn handle_deadline_slip(
    now: Instant,
    next_deadline: &mut Instant,
    state: &SchedulerState,
) -> u32 {
    if now < *next_deadline {
        return 0;
    }

    let late = now.duration_since(*next_deadline);

    let jitter = late.as_nanos() as u64;

    update_ema(&state.avg_jitter_ns, jitter, ALPHA_SHIFT);
    state.max_jitter_ns.fetch_max(jitter, Ordering::Relaxed);

    // сколько тиков накопилось
    let ticks = (late.as_nanos() / TICK_INTERVAL.as_nanos()) as u32 + 1;

    *next_deadline += TICK_INTERVAL * ticks;

    ticks
}

// ---------------------------------------------------------------------------
// Adaptive spin‑margin
// ---------------------------------------------------------------------------

fn adapt_spin_margin(state: &SchedulerState, avg_spin_time: Duration, avg_sleep_overshoot: Duration) {
    let old_margin = Duration::from_nanos(state.spin_margin_ns.load(Ordering::Relaxed));
    let granularity = Duration::from_nanos(state.sleep_granularity_ns.load(Ordering::Relaxed));

    // Minimum margin respects OS granularity
    let min_margin = granularity
        .saturating_mul(2)
        .max(MIN_SPIN_MARGIN)
        .min(MAX_SPIN_MARGIN);

    let mut target = old_margin;

    // ---------  Sleep‑error correction  ----------
    if avg_sleep_overshoot > Duration::ZERO {
        let correction = (avg_sleep_overshoot / 2).min(old_margin / 4);
        target = target.saturating_add(correction);
    }

    // ---------  Spin‑time correction  ----------
    if avg_spin_time > TARGET_SPIN_TIME {
        let excess = avg_spin_time - TARGET_SPIN_TIME;
        target = target.saturating_sub(excess / 2);
    } else if avg_spin_time < TARGET_SPIN_TIME / 2 {
        let deficit = TARGET_SPIN_TIME / 2 - avg_spin_time;
        target = target.saturating_add(deficit / 2);
    }

    // ---------  Rate limiting  ----------
    let max_change = (old_margin / 10).max(Duration::from_nanos(1));
    let adjusted = if target > old_margin {
        old_margin + (target - old_margin).min(max_change)
    } else {
        old_margin - (old_margin - target).min(max_change)
    };

    // Clamp to allowed range
    let new_margin = adjusted.clamp(min_margin, MAX_SPIN_MARGIN);
    state.spin_margin_ns.store(new_margin.as_nanos() as u64, Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// Wait logic (now keeps a single `Instant::now()` per loop iteration)
// ---------------------------------------------------------------------------

#[inline]
fn wait_until(
    deadline: Instant,
    running: &AtomicBool,
    wake_state: &(Mutex<bool>, Condvar),
    spin_margin: Duration,
) -> WaitOutcome {
    loop {
        // Early exit if the manager is stopped
        if !running.load(Ordering::Acquire) {
            return WaitOutcome {
                reached_deadline: false,
                spin_time: Duration::ZERO,
                sleep_overshoot: Duration::ZERO,
            };
        }

        let now = Instant::now();

        // Deadline reached → success
        if now >= deadline {
            return WaitOutcome {
                reached_deadline: true,
                spin_time: Duration::ZERO,
                sleep_overshoot: Duration::ZERO,
            };
        }

        let remaining = deadline.duration_since(now);

        // -------------------  Sleep phase  -------------------
        if remaining > spin_margin {
            // Sleep a little less than the remaining time, leaving `spin_margin`
            // for the precision phase.
            let timeout = remaining - spin_margin;
            wait_with_timeout(&wake_state.0, &wake_state.1, timeout);
            continue;
        }

        // -------------------  Precision (spin) phase  -------------------
        let spin_start = Instant::now();

        // If the OS already overslept past the deadline, record it.
        let sleep_overshoot = spin_start.saturating_duration_since(deadline);

        while Instant::now() < deadline {
            if !running.load(Ordering::Acquire) {
                return WaitOutcome {
                    reached_deadline: false,
                    spin_time: spin_start.elapsed(),
                    sleep_overshoot,
                };
            }
            std::hint::spin_loop();
        }

        return WaitOutcome {
            reached_deadline: true,
            spin_time: spin_start.elapsed(),
            sleep_overshoot,
        };
    }
}

// ---------------------------------------------------------------------------
// Condvar with timeout (unchanged, but kept for completeness)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sleep‑granularity measurement (unchanged, but clarified)
// ---------------------------------------------------------------------------

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
    // Median overshoot, capped by a hard max.
    overshoots[overshoots.len() / 2].min(MAX_GRANULARITY)
}