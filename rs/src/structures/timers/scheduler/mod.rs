pub mod balancer;
mod budget;
mod state;

use crate::structures::timers::scheduler::state::SchedulerState;
use crate::structures::timers::scheduler::budget::SendBudget;
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

/// Сдвиг для экспоненциального скользящего среднего (α = 1/16).
const ALPHA_SHIFT: u32 = 4;

/// Как часто пересчитывать `spin_margin` (в тиках).
const ADAPT_INTERVAL: u64 = 100;

/// Количество измерений для калибровки гранулярности сна.
const SAMPLES: usize = 10;

/// Интервал как `Duration` для вычислений.
const TICK_INTERVAL: Duration = Duration::from_millis(TICK_INTERVAL_MS as u64);

/// Целевое среднее время активного ожидания (спина).
const TARGET_SPIN_TIME: Duration = Duration::from_micros(1000);

/// Минимально допустимый запас перед дедлайном для перехода к спину.
const MIN_SPIN_MARGIN: Duration = Duration::from_micros(50);

/// Максимально допустимый запас перед дедлайном.
const MAX_SPIN_MARGIN: Duration = Duration::from_millis(1);

/// Запрашиваемый сон при калибровке гранулярности.
const REQUESTED_SLEEP: Duration = Duration::from_micros(ADAPT_INTERVAL);

/// Верхняя граница измеренной гранулярности (защита от выбросов).
const MAX_GRANULARITY: Duration = Duration::from_millis(1);

/// Результат ожидания планировщика.
#[derive(Debug, Copy, Clone)]
struct WaitOutcome {
    /// Достигнут ли запланированный deadline.
    reached_deadline: bool,

    /// Время, проведённое в активном spin.
    spin_time: Duration,

    /// Насколько планировщик оказался за deadline
    /// в момент перехода в precision phase.
    sleep_overshoot: Duration
}

// ============================================================================
// Cycle
// ============================================================================

/// Планировщик, управляющий фоновым потоком циклической обработки UDP-сессий.
///
/// Поток периодически вызывает `tick()` для каждой активной сессии с интервалом
/// `TICK_INTERVAL_MS`. Использует `ArcSwap` для хранения карты сессий: воркер
/// получает непротиворечивый снимок без блокировок, а добавление/удаление
/// сессий выполняется быстро.
///
/// Помимо самого цикла, планировщик собирает метрики таймингов (джиттер, overshoot сна,
/// время спина, гранулярность ОС) и адаптирует параметры ожидания через `adapt_spin_margin`.
pub struct Scheduler {
    /// Активные UDP-сессии (ключ — идентификатор, значение — обёрнутый UDP-буфер).
    sessions: Arc<ArcSwap<HashMap<u32, Arc<SocketBuffered>>>>,

    /// Флаг активности рабочего потока. `true` — поток должен работать.
    running: Arc<AtomicBool>,

    /// Состояние пробуждения: `true` — поток нужно разбудить немедленно.
    /// Совместно с `Condvar` позволяет мгновенно реагировать на изменения.
    wake_state: Arc<(Mutex<bool>, Condvar)>,

    /// Дескриптор фонового потока.
    handle: Mutex<Option<JoinHandle<()>>>,

    /// Общие метрики цикла, доступные для чтения извне.
    telemetry: Arc<SchedulerState>,
}
impl Scheduler {
    /// Создаёт новый планировщик с пустой картой сессий.
    /// Поток не запускается до первой добавленной сессии.
    ///
    /// # Возвращаемое значение
    /// `Ok(Scheduler)` с инициализированными внутренними структурами.
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            wake_state: Arc::new((Mutex::new(false), Condvar::new())),
            handle: Mutex::new(None),
            telemetry: Arc::new(SchedulerState::default()),
        })
    }

    /// Добавляет сессию в карту и запускает воркер, если он ещё не запущен.
    /// После добавления немедленно будит поток, чтобы не ждать тика.
    ///
    /// # Аргументы
    /// * `id` — идентификатор сессии.
    /// * `session` — обёртка UDP-сессии.
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
    ///
    /// Если карта становится пустой — останавливает воркер.
    /// Иначе будит поток, чтобы он увидел изменения.
    ///
    /// # Аргументы
    /// * `id` — идентификатор удаляемой сессии.
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

    /// Применяет замыкание к текущей карте сессий с безопасной заменой.
    ///
    /// `Arc::make_mut` создаст копию, если снимок используется воркером,
    /// иначе модифицирует карту на месте.
    ///
    /// # Аргументы
    /// * `update` — замыкание, изменяющее карту.
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

    /// Запускает воркер-поток, если он ещё не запущен.
    ///
    /// Использует `compare_exchange` для атомарного захвата флага активности.
    /// Если создание потока не удалось — сбрасывает флаг.
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

    /// Устанавливает флаг `wake` в `true` и уведомляет condvar.
    /// Игнорирует отравление мьютекса, чтобы пробуждение работало всегда.
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

    /// Останавливает воркер и дожидается его завершения.
    /// Идемпотентен: повторный вызов безопасен.
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
impl Drop for Scheduler {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ---------------------------------------------------------------------------
// Adaptive spin‑margin
// ---------------------------------------------------------------------------

/// Корректирует значение `spin_margin` на основе среднего времени спина
/// и систематического промаха системного сна.
///
/// Логика:
/// - если sleep систематически промахивается за дедлайн — увеличиваем запас,
///   чтобы начать активное ожидание раньше;
/// - если спин слишком длинный — уменьшаем запас;
/// - если спин слишком короткий — слегка увеличиваем;
/// - изменение за шаг ограничено 10 % от текущего значения (антиосцилляция);
/// - итог клампится в `[min_margin, MAX_SPIN_MARGIN]`, где `min_margin`
///   учитывает измеренную гранулярность ОС.
///
/// # Аргументы
/// * `state` — метрики планировщика.
/// * `avg_spin_time` — среднее время активного ожидания (EMA).
/// * `avg_sleep_overshoot` — средний промах сна за дедлайн (EMA).

fn adapt_spin_margin(state: &SchedulerState, avg_spin_time: Duration, avg_sleep_overshoot: Duration) {
    // Текущее значение и измеренная гранулярность.
    let old_margin = Duration::from_nanos(state.spin_margin_ns.load(Ordering::Relaxed));
    let granularity = Duration::from_nanos(state.sleep_granularity_ns.load(Ordering::Relaxed));

    // Минимальная граница с учётом гранулярности ОС.
    let min_margin = granularity
        .saturating_mul(2)
        .max(MIN_SPIN_MARGIN)
        .min(MAX_SPIN_MARGIN);

    // Начинаем с текущего значения.
    let mut target = old_margin;

    // ---------  Коррекция по промаху сна  ----------
    if avg_sleep_overshoot > Duration::ZERO {
        // Добавляем половину overshoot, но не более четверти текущего margin.
        let correction = (avg_sleep_overshoot / 2).min(old_margin / 4);
        target = target.saturating_add(correction);
    }

    // ---------  Коррекция по времени спина  ----------
    if avg_spin_time > TARGET_SPIN_TIME {
        // Спин слишком длинный — уменьшаем margin.
        let excess = avg_spin_time - TARGET_SPIN_TIME;
        target = target.saturating_sub(excess / 2);
    } else if avg_spin_time < TARGET_SPIN_TIME / 2 {
        // Спин слишком короткий — увеличиваем margin.
        let deficit = TARGET_SPIN_TIME / 2 - avg_spin_time;
        target = target.saturating_add(deficit / 2);
    }

    // ---------  Ограничение шага  ----------
    // За один вызов margin не может измениться больше чем на 10%.
    let max_change = (old_margin / 10).max(Duration::from_nanos(1));
    let adjusted = if target > old_margin {
        old_margin + (target - old_margin).min(max_change)
    } else {
        old_margin - (old_margin - target).min(max_change)
    };

    // Финальные границы.
    let new_margin = adjusted.clamp(min_margin, MAX_SPIN_MARGIN);
    state.spin_margin_ns.store(new_margin.as_nanos() as u64, Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// Wait logic
// ---------------------------------------------------------------------------

/// Ожидает наступления `deadline`, комбинируя сон (с таймаутом и возможностью
/// раннего пробуждения через condvar) и активный spin-loop в последние
/// `spin_margin` перед дедлайном.
///
/// # Аргументы
/// * `deadline` — момент, до которого нужно дождаться.
/// * `running` — флаг активности планировщика.
/// * `wake_state` — пара (мьютекс, condvar) для досрочного пробуждения.
/// * `spin_margin` — запас времени перед дедлайном, отданный под спин.
///
/// # Возвращаемое значение
/// `WaitOutcome` с признаком достижения дедлайна, длительностью спина
/// и величиной промаха сна за дедлайн.

#[inline]
fn wait_until(deadline: Instant, running: &AtomicBool, wake_state: &(Mutex<bool>, Condvar), spin_margin: Duration) -> WaitOutcome {
    loop {
        // Ранний выход, если воркер остановлен.
        if !running.load(Ordering::Acquire) {
            return WaitOutcome {
                reached_deadline: false,
                spin_time: Duration::ZERO,
                sleep_overshoot: Duration::ZERO,
            };
        }

        // Одно чтение времени на итерацию.
        let now = Instant::now();

        // Дедлайн уже наступил.
        if now >= deadline {
            return WaitOutcome {
                reached_deadline: true,
                spin_time: Duration::ZERO,
                sleep_overshoot: Duration::ZERO,
            };
        }

        // Сколько осталось до дедлайна.
        let remaining = deadline.duration_since(now);

        // -------------------  Фаза сна  -------------------
        if remaining > spin_margin {
            // Спим чуть меньше оставшегося, оставляя запас под спин.
            let timeout = remaining - spin_margin;
            wait_with_timeout(&wake_state.0, &wake_state.1, timeout);
            // Пересчитываем остаток на следующей итерации.
            continue;
        }

        // -------------------  Фаза спина  -------------------
        let spin_start = Instant::now();

        // Фиксируем, насколько мы уже опоздали к моменту начала спина.
        let sleep_overshoot = spin_start.saturating_duration_since(deadline);

        // Активно ждём до дедлайна.
        while Instant::now() < deadline {
            // Проверяем остановку.
            if !running.load(Ordering::Acquire) {
                return WaitOutcome {
                    reached_deadline: false,
                    spin_time: spin_start.elapsed(),
                    sleep_overshoot,
                };
            }
            // Подсказка процессору (PAUSE/relax).
            std::hint::spin_loop();
        }

        // Успешно дождались дедлайна.
        return WaitOutcome {
            reached_deadline: true,
            spin_time: spin_start.elapsed(),
            sleep_overshoot,
        };
    }
}

// ---------------------------------------------------------------------------
// Condvar with timeout
// ---------------------------------------------------------------------------

/// Ожидает на condvar с таймаутом, обрабатывая флаг пробуждения.
///
/// Если флаг `wake` уже установлен — возвращает `true` немедленно, сбрасывая его.
/// При истечении таймаута возвращает `false`, при сигнале — `true`.
/// Отравление мьютекса игнорируется.
///
/// # Аргументы
/// * `lock` — мьютекс, связанный с флагом пробуждения.
/// * `cvar` — условная переменная.
/// * `timeout` — максимальная длительность ожидания.
///
/// # Возвращаемое значение
/// `true`, если был сигнал пробуждения; `false` при таймауте.

#[inline]
fn wait_with_timeout(lock: &Mutex<bool>, cvar: &Condvar, timeout: Duration) -> bool {
    // Захватываем мьютекс, игнорируя отравление.
    let mut wake = acquire_lock(lock);

    // Если флаг уже установлен — не спим.
    if *wake {
        *wake = false;
        return true;
    }

    // Ждём с таймаутом, обрабатывая возможное отравление.
    let result = cvar.wait_timeout(wake, timeout);
    let (mut wake, _) = result.unwrap_or_else(|poisoned| poisoned.into_inner());

    // Проверяем, был ли сигнал, и сбрасываем флаг.
    let was_woken = *wake;
    if was_woken {
        *wake = false;
    }
    was_woken
}

// ---------------------------------------------------------------------------
// Sleep‑granularity measurement
// ---------------------------------------------------------------------------

/// Измеряет гранулярность системного сна.
///
/// Делает `SAMPLES` коротких снов длительностью `REQUESTED_SLEEP` и собирает
/// превышения фактического времени над запрошенным. Возвращает медианный
/// overshoot, ограниченный `MAX_GRANULARITY` (защита от выбросов).
///
/// # Возвращаемое значение
/// Медианный overshoot сна; `ZERO`, если замеры не удались.

fn measure_sleep_granularity() -> Duration {
    let mut overshoots = Vec::with_capacity(SAMPLES);

    for _ in 0..SAMPLES {
        // Засекаем время до сна.
        let start = Instant::now();
        // Спим короткий интервал.
        thread::sleep(REQUESTED_SLEEP);
        // Считаем фактическую длительность.
        let elapsed = start.elapsed();

        // Записываем только промахи.
        if elapsed > REQUESTED_SLEEP {
            overshoots.push(elapsed - REQUESTED_SLEEP);
        }
    }

    // Если ни одного промаха не зафиксировано — гранулярность нулевая.
    if overshoots.is_empty() {
        return Duration::ZERO;
    }

    // Сортируем и берём медиану.
    overshoots.sort_unstable();
    // Медиана устойчива к одиночным выбросам.
    overshoots[overshoots.len() / 2].min(MAX_GRANULARITY)
}

// ---------------------------------------------------------------------------
// Mutex helper
// ---------------------------------------------------------------------------

/// Захватывает мьютекс, игнорируя возможное отравление (poisoning).
///
/// Планировщик не должен падать из-за того, что предыдущий владелец мьютекса
/// завершился с panic — состояние пересчитывается на каждом тике.
///
/// # Аргументы
/// * `mutex` — ссылка на мьютекс.
///
/// # Возвращаемое значение
/// `MutexGuard` с доступом к данным внутри мьютекса.
#[inline]
fn acquire_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ---------------------------------------------------------------------------
// EMA
// ---------------------------------------------------------------------------

/// Обновляет атомарное значение через экспоненциальное скользящее среднее
/// с коэффициентом α = 1 / 2^shift.
///
/// Реализовано без CAS: чтение и запись не атомарны между собой, но для метрик
/// это допустимо — небольшая потеря точности не критична.
///
/// # Аргументы
/// * `atomic` — целевое атомарное значение.
/// * `value` — новое измерение.
/// * `shift` — сдвиг для α (например, 4 → α = 1/16).

#[inline]
fn update_ema(atomic: &AtomicU64, value: u64, shift: u32) {
    // Читаем текущее значение.
    let old = atomic.load(Ordering::Relaxed);

    // Приращение или убыль со сдвигом α = 1/2^shift.
    let next = if value >= old {
        old.saturating_add((value - old) >> shift)
    } else {
        old.saturating_sub((old - value) >> shift)
    };

    // Публикуем новое значение.
    atomic.store(next, Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// Deadline slip handling
// ---------------------------------------------------------------------------

/// Обрабатывает ситуацию отставания от дедлайна.
///
/// Если текущее время меньше `next_deadline` — возвращает `(0, Normal)`.
/// Иначе:
/// - вычисляет фактическое опоздание `late`;
/// - обновляет метрики джиттера (`avg_jitter_ns`, `max_jitter_ns`);
/// - вычисляет, сколько логических тиков накопилось, и сдвигает `next_deadline`
///   на соответствующее количество интервалов;
/// - вычисляет `SendBudget` по величине `late` — этот бюджет НЕ определяет
///   количество логических тиков, а лишь разрешает нижнему уровню (Player/Session)
///   агрессивнее скомпенсировать timing debt;
/// - обновляет метрики burst-режима.
///
/// # Аргументы
/// * `now` — текущее время.
/// * `next_deadline` — указатель на дедлайн (модифицируется при отставании).
/// * `state` — метрики планировщика.
///
/// # Возвращаемое значение
/// Кортеж `(ticks, budget)`:
/// - `ticks` — сколько логических тиков нужно обработать;
/// - `budget` — разрешённый budget отправки для каждой сессии.

#[inline]
fn handle_deadline_slip(now: Instant, next_deadline: &mut Instant, state: &SchedulerState) -> (u32, SendBudget) {
    // Если ещё не догнали дедлайн — ничего не делаем.
    if now < *next_deadline {
        return (0, SendBudget::Normal);
    }

    // Фактическое отставание.
    let late = now.duration_since(*next_deadline);

    // Записываем джиттер (в наносекундах).
    let jitter = late.as_nanos() as u64;

    // Обновляем метрики джиттера.
    update_ema(&state.avg_jitter_ns, jitter, ALPHA_SHIFT);
    state.max_jitter_ns.fetch_max(jitter, Ordering::Relaxed);

    // -----------------------------------------------------------------------
    // Логические тики, которые накопились.
    // -----------------------------------------------------------------------
    // Считаем, сколько интервалов уложилось в late, плюс один текущий.
    let ticks = (late.as_nanos() / TICK_INTERVAL.as_nanos()) as u32 + 1;

    // Сдвигаем дедлайн на соответствующее число интервалов.
    *next_deadline += TICK_INTERVAL * ticks;

    // -----------------------------------------------------------------------
    // Бюджет отправки аудио.
    // -----------------------------------------------------------------------
    // Отдельно оцениваем, насколько опасно текущее опоздание для доставки.
    let budget = SendBudget::calculate_send_budget(late);

    // Если бюджет burst — учитываем в метриках.
    if budget.is_burst() {
        state.emergency_bursts.fetch_add(1, Ordering::Relaxed);
        // Дополнительные пакеты сверх обычного бюджета.
        let extra = budget.packets().saturating_sub(1);
        state.extra_frames_budgeted.fetch_add(extra as u64, Ordering::Relaxed);
    }

    (ticks, budget)
}

// ---------------------------------------------------------------------------
// Main cycle thread
// ---------------------------------------------------------------------------

/// Основной цикл воркера планировщика.
///
/// Фазы одной итерации:
/// 1. Проверка отставания и, при необходимости, обработка нескольких логических
///    тиков подряд с повышенным `SendBudget`.
/// 2. Сбор метрик обработки (`avg_process_ns`, `max_process_ns`).
/// 3. Ожидание дедлайна (`wait_until`).
/// 4. Сбор метрик сна и спина.
/// 5. Периодическая адаптация `spin_margin`.
///
/// # Аргументы
/// * `sessions` — ArcSwap-снимок карты сессий.
/// * `running` — флаг активности воркера.
/// * `wake_state` — condvar-состояние для досрочного пробуждения.
/// * `state` — метрики планировщика.
fn cycle_thread(sessions: Arc<ArcSwap<HashMap<u32, Arc<SocketBuffered>>>>, running: Arc<AtomicBool>, wake_state: Arc<(Mutex<bool>, Condvar)>, state: Arc<SchedulerState>) {
    // Ссылка на метрики для быстрого доступа.
    let state_ref = state.as_ref();

    // Первый дедлайн — сейчас; первый тик выполняется сразу.
    let mut next_deadline = Instant::now();

    // -----------------------------------------------------------------------
    // Первичная калибровка
    // -----------------------------------------------------------------------

    // Измеряем гранулярность системного сна.
    let granularity = measure_sleep_granularity();

    // Сохраняем в метрики.
    state_ref.sleep_granularity_ns.store(
        granularity.as_nanos() as u64,
        Ordering::Relaxed,
    );

    // Начальный margin = 2 × гранулярность, ограниченный рамками.
    let initial_margin = granularity
        .saturating_mul(2)
        .max(MIN_SPIN_MARGIN)
        .min(MAX_SPIN_MARGIN);

    state_ref.spin_margin_ns.store(
        initial_margin.as_nanos() as u64,
        Ordering::Relaxed,
    );

    // -----------------------------------------------------------------------
    // Основной цикл
    // -----------------------------------------------------------------------

    while running.load(Ordering::Acquire) {
        // Счётчик тиков (нужен для периодической адаптации).
        let tick_id = state_ref.ticks.fetch_add(1, Ordering::Relaxed) + 1;

        // Фиксируем время начала итерации.
        let tick_start = Instant::now();

        // -------------------------------------------------------------------
        // Обработка отставания
        // -------------------------------------------------------------------
        // Возвращает логические тики и бюджет отправки.
        let (ticks, budget) = handle_deadline_slip(
            tick_start,
            &mut next_deadline,
            state_ref,
        );

        if ticks > 0 {
            // Загружаем снимок сессий.
            let snapshot = sessions.load();

            if !snapshot.is_empty() {
                // Обрабатываем все накопленные тики.
                for _ in 0..ticks {
                    let now = now_ms();
                    for session in snapshot.values() {
                        // Передаём бюджет в tick().
                        session.tick(now, budget.packets());
                    }
                }
            }

            // Пропускаем обычную обработку и ожидание — идём на следующий круг.
            continue;
        }

        // -------------------------------------------------------------------
        // Метрики обработки
        // -------------------------------------------------------------------

        let process_ns = tick_start.elapsed().as_nanos() as u64;

        update_ema(&state_ref.avg_process_ns, process_ns, ALPHA_SHIFT);
        state_ref.max_process_ns.fetch_max(process_ns, Ordering::Relaxed);

        // -------------------------------------------------------------------
        // Проверка остановки
        // -------------------------------------------------------------------

        if !running.load(Ordering::Acquire) {
            break;
        }

        // -------------------------------------------------------------------
        // Ожидание дедлайна
        // -------------------------------------------------------------------

        // Текущий запас под спин.
        let spin_margin = Duration::from_nanos(
            state_ref.spin_margin_ns.load(Ordering::Relaxed),
        );

        let outcome = wait_until(next_deadline, &running, &wake_state, spin_margin);

        if !outcome.reached_deadline {
            // Воркер был остановлен во время ожидания.
            break;
        }

        // -------------------------------------------------------------------
        // Метрики сна
        // -------------------------------------------------------------------

        let sleep_overshoot_ns = outcome.sleep_overshoot.as_nanos() as u64;

        update_ema(&state_ref.avg_sleep_overshoot_ns, sleep_overshoot_ns, ALPHA_SHIFT);
        state_ref.max_sleep_overshoot_ns.fetch_max(sleep_overshoot_ns, Ordering::Relaxed);

        // -------------------------------------------------------------------
        // Метрики спина
        // -------------------------------------------------------------------

        let spin_ns = outcome.spin_time.as_nanos() as u64;

        update_ema(&state_ref.avg_spin_time_ns, spin_ns, ALPHA_SHIFT);

        // -------------------------------------------------------------------
        // Адаптивная калибровка (каждые ADAPT_INTERVAL тиков)
        // -------------------------------------------------------------------

        if tick_id % ADAPT_INTERVAL == 0 {
            let avg_spin = Duration::from_nanos(
                state_ref.avg_spin_time_ns.load(Ordering::Relaxed),
            );

            let avg_sleep_overshoot = Duration::from_nanos(
                state_ref.avg_sleep_overshoot_ns.load(Ordering::Relaxed),
            );

            adapt_spin_margin(state_ref, avg_spin, avg_sleep_overshoot);
        }
    }

    // По завершении цикла сбрасываем флаг активности.
    running.store(false, Ordering::Release);
}