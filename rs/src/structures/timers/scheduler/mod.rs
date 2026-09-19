pub mod constants;
pub mod telemetry;
pub mod timer;
pub mod registry;
mod budget;
pub mod balancer;

use std::io;
use std::sync::{Arc, Mutex, Condvar, atomic::{AtomicBool, Ordering}};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

// Импортируем ваши внешние структуры (пути должны соответствовать вашему проекту)
use crate::structures::timers::scheduler::{budget::SendBudget};
use crate::utils::duration::now_ms;

use self::registry::SessionRegistry;
use self::telemetry::{SchedulerTelemetry, update_ema};
use self::timer::{PrecisionTimer};
use self::constants::*;

/// Планировщик циклической обработки UDP-сессий.
///
/// Запускает фоновый поток, который с интервалом `TICK_INTERVAL` вызывает
/// `tick()` у всех активных сессий. Использует `SessionRegistry` для
/// lock-free чтения снимка сессий, `PrecisionTimer` — для точного ожидания
/// дедлайна, `SchedulerTelemetry` — для сбора метрик и адаптации параметров.
///
/// Поток запускается лениво при первом вызове `add_session` и автоматически
/// останавливается, когда реестр становится пустым.
pub struct Scheduler {
    /// Реестр активных сессий (lock-free чтение через `ArcSwap`).
    registry: Arc<SessionRegistry>,

    /// Флаг активности воркер-потока.
    running: Arc<AtomicBool>,

    /// Пара (флаг пробуждения, condvar) для досрочного выхода из ожидания.
    wake_state: Arc<(Mutex<bool>, Condvar)>,

    /// Дескриптор фонового потока.
    handle: Mutex<Option<JoinHandle<()>>>,

    /// Метрики планировщика, разделяемые с воркером.
    telemetry: Arc<SchedulerTelemetry>,
}

impl Scheduler {
    /// Создаёт планировщик в остановленном состоянии.
    /// Воркер не запускается до первого `add_session`.
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            registry: Arc::new(SessionRegistry::new()),
            running: Arc::new(AtomicBool::new(false)),
            wake_state: Arc::new((Mutex::new(false), Condvar::new())),
            handle: Mutex::new(None),
            telemetry: Arc::new(SchedulerTelemetry::default()),
        })
    }

    /// Добавляет сессию в реестр, запускает воркер (если не запущен)
    /// и будит его для немедленной обработки.
    ///
    /// # Аргументы
    /// * `id` — идентификатор сессии.
    /// * `session` — обёртка UDP-сессии.
    pub fn add_session(&self, id: u32, session: Arc<crate::structures::network::udp::socket::SocketBuffered>) {
        // Добавляем в реестр.
        self.registry.add(id, session);
        // Гарантируем, что воркер запущен.
        self.start_if_needed();
        // Будим его, чтобы не ждать следующего тика.
        self.wake_thread();
    }

    /// Удаляет сессию из реестра.
    /// Если реестр опустел — останавливает воркер.
    ///
    /// # Аргументы
    /// * `id` — идентификатор удаляемой сессии.
    pub fn remove_session(&self, id: u32) {
        self.registry.remove(id);

        if self.registry.is_empty() {
            // Нет сессий — воркер не нужен.
            self.shutdown();
        } else {
            // Иначе будим, чтобы он увидел изменения.
            self.wake_thread();
        }
    }

    /// Запускает воркер-поток, если он ещё не запущен.
    ///
    /// Захват флага активности выполняется через `compare_exchange` —
    /// безопасно при конкурентных вызовах из разных потоков.
    fn start_if_needed(&self) {
        // Атомарно проверяем и ставим флаг запуска.
        if self.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return;
        }

        // Захватываем handle (игнорируем возможное отравление).
        let mut handle_guard = self.handle.lock().unwrap_or_else(|e| e.into_inner());
        // Если handle уже есть — поток работает.
        if handle_guard.is_some() { return; }

        // Клонируем Arc'и для передачи в поток.
        let registry = Arc::clone(&self.registry);
        let running = Arc::clone(&self.running);
        let wake_state = Arc::clone(&self.wake_state);
        let telemetry = Arc::clone(&self.telemetry);

        // Создаём поток с понятным именем.
        let spawn = thread::Builder::new()
            .name("UDPCycleSystem".into())
            .spawn(move || {
                cycle_thread(registry, running, wake_state, telemetry);
            });

        match spawn {
            Ok(h) => *handle_guard = Some(h),
            Err(e) => {
                // При ошибке снимаем флаг активности.
                self.running.store(false, Ordering::Release);
                eprintln!("[Scheduler] failed to spawn worker thread: {e}");
            }
        }
    }

    /// Устанавливает флаг пробуждения и уведомляет condvar.
    /// Игнорирует отравление мьютекса, чтобы пробуждение работало всегда.
    #[inline]
    fn wake_thread(&self) {
        let (lock, cvar) = &*self.wake_state;
        // Пытаемся выставить флаг пробуждения.
        if let Ok(mut wake) = lock.lock() {
            *wake = true;
            cvar.notify_one();
        } else {
            // При отравлении всё равно уведомляем.
            cvar.notify_one();
        }
    }

    /// Останавливает воркер и дожидается его завершения.
    /// Идемпотентен: повторный вызов безопасен.
    pub fn shutdown(&self) {
        // Снимаем флаг активности.
        self.running.store(false, Ordering::Release);
        // Будим поток, чтобы он вышел из ожидания.
        self.wake_thread();

        // Забираем handle и дожидаемся завершения вне блокировки.
        let handle = self.handle.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(h) = handle {
            let _ = h.join();
        }
    }
}

/// Останавливаем воркер при уничтожении планировщика.
impl Drop for Scheduler {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Основной цикл воркера планировщика.
///
/// Фазы одной итерации:
/// 1. Ожидание дедлайна через `PrecisionTimer` (сон → yield → спин).
/// 2. Расчёт джиттера и обновление метрик.
/// 3. Обработка снимка сессий с рассчитанным `SendBudget`.
/// 4. Сбор метрик обработки, сна и спина.
/// 5. Периодическая адаптация `spin_margin` каждые `ADAPT_INTERVAL` тиков.
/// 6. Планирование следующего дедлайна с защитой от дрейфа.
///
/// # Аргументы
/// * `registry` — реестр активных сессий.
/// * `running` — флаг активности воркера.
/// * `wake_state` — состояние для досрочного пробуждения.
/// * `telemetry` — метрики планировщика.
fn cycle_thread(
    registry: Arc<SessionRegistry>,
    running: Arc<AtomicBool>,
    wake_state: Arc<(Mutex<bool>, Condvar)>,
    telemetry: Arc<SchedulerTelemetry>
) {
    // Медианный overshoot коротких снов даёт оценку минимального шага.
    let granularity = measure_sleep_granularity();
    telemetry.sleep_granularity_ns.store(granularity.as_nanos() as u64, Ordering::Relaxed);

    // Установка начального запаса для спина: 2 × гранулярность в пределах MIN/MAX.
    let initial_margin = granularity.saturating_mul(2).max(MIN_SPIN_MARGIN).min(MAX_SPIN_MARGIN);
    telemetry.spin_margin_ns.store(initial_margin.as_nanos() as u64, Ordering::Relaxed);

    // Первый тик выполняется сразу (дедлайн = now).
    let mut next_deadline = Instant::now();

    while running.load(Ordering::Acquire) {
        // Фиксируем время начала итерации (для метрики process).
        let tick_start = Instant::now();

        // Ожидание следующего тика (сон → yield → спин).
        let outcome = PrecisionTimer::wait_until(next_deadline, &running, &wake_state, &telemetry);
        // Если воркер остановили во время ожидания — выходим.
        if !outcome.reached_deadline { break; }

        let now = Instant::now();

        // Расчёт опоздания (джиттер).
        let late = if now > next_deadline {
            let diff = now.duration_since(next_deadline);
            let jitter_ns = diff.as_nanos() as u64;
            // EMA + максимум.
            update_ema(&telemetry.avg_jitter_ns, jitter_ns, ALPHA_SHIFT);
            telemetry.max_jitter_ns.fetch_max(jitter_ns, Ordering::Relaxed);
            diff
        } else {
            Duration::ZERO
        };

        // Обработка сессий.
        let snapshot = registry.snapshot();
        if !snapshot.is_empty() {
            // Определяем бюджет отправки по величине опоздания.
            let budget = SendBudget::calculate_send_budget(late);

            // Учитываем burst-режим в метриках.
            if budget.is_burst() {
                telemetry.emergency_bursts.fetch_add(1, Ordering::Relaxed);
                let extra = budget.packets().saturating_sub(1);
                telemetry.extra_frames_budgeted.fetch_add(extra as u64, Ordering::Relaxed);
            }

            // Один timestamp на все сессии — обход снимка быстрый.
            let timestamp = now_ms();
            for session in snapshot.values() {
                session.tick(timestamp, budget.packets());
            }
        }

        // Сбор метрик выполнения.
        let process_ns = tick_start.elapsed().as_nanos() as u64;
        update_ema(&telemetry.avg_process_ns, process_ns, ALPHA_SHIFT);
        telemetry.max_process_ns.fetch_max(process_ns, Ordering::Relaxed);

        let sleep_overshoot_ns = outcome.sleep_overshoot.as_nanos() as u64;
        update_ema(&telemetry.avg_sleep_overshoot_ns, sleep_overshoot_ns, ALPHA_SHIFT);
        telemetry.max_sleep_overshoot_ns.fetch_max(sleep_overshoot_ns, Ordering::Relaxed);

        let spin_ns = outcome.spin_time.as_nanos() as u64;
        update_ema(&telemetry.avg_spin_time_ns, spin_ns, ALPHA_SHIFT);

        // Адаптация spin_margin каждые N циклов.
        let cycle_id = telemetry.ticks.fetch_add(1, Ordering::Relaxed) + 1;
        if cycle_id % ADAPT_INTERVAL == 0 {
            let avg_spin = Duration::from_nanos(telemetry.avg_spin_time_ns.load(Ordering::Relaxed));
            let avg_overshoot = Duration::from_nanos(telemetry.avg_sleep_overshoot_ns.load(Ordering::Relaxed));
            PrecisionTimer::adapt_margin(&telemetry, avg_spin, avg_overshoot);
        }

        // Расчёт следующего дедлайна (строго +20 мс для исключения дрейфа).
        next_deadline += TICK_INTERVAL;

        // Если катастрофически отстали — сбрасываем дедлайн на now + интервал.
        // Иначе можно было бы накопить серию «догоняющих» тиков.
        if next_deadline <= now {
            next_deadline = now + TICK_INTERVAL;
        }
    }

    // По завершении цикла сбрасываем флаг активности.
    running.store(false, Ordering::Release);
}

/// Измеряет гранулярность системного сна.
///
/// Делает `SAMPLES` коротких снов длительностью `REQUESTED_SLEEP`,
/// собирает превышения фактического времени над запрошенным и возвращает
/// медианный overshoot, ограниченный `MAX_GRANULARITY`.
///
/// # Возвращаемое значение
/// Медианный overshoot сна; `ZERO`, если замеры не удались.
fn measure_sleep_granularity() -> Duration {
    // Сюда собираем все превышения.
    let mut overshoots = Vec::with_capacity(SAMPLES);

    for _ in 0..SAMPLES {
        // Засекаем время до сна.
        let start = Instant::now();
        thread::sleep(REQUESTED_SLEEP);
        // Фактическая длительность.
        let elapsed = start.elapsed();

        // Записываем только промахи.
        if elapsed > REQUESTED_SLEEP {
            overshoots.push(elapsed - REQUESTED_SLEEP);
        }
    }

    // Если ни одного промаха не зафиксировано — гранулярность нулевая.
    if overshoots.is_empty() { return Duration::ZERO; }

    // Сортируем и берём медиану (устойчива к одиночным выбросам).
    overshoots.sort_unstable();
    overshoots[overshoots.len() / 2].min(MAX_GRANULARITY)
}