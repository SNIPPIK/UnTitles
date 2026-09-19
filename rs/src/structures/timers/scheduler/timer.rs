use std::time::{Duration, Instant};
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex, Condvar};
use std::thread;
use crate::structures::timers::scheduler::constants::{MAX_SPIN_MARGIN, MIN_SPIN_MARGIN, TARGET_SPIN_TIME};
use crate::structures::timers::scheduler::telemetry::SchedulerTelemetry;

/// Результат ожидания дедлайна.
pub struct WaitOutcome {
    /// Достигнут ли дедлайн (false — если поток был остановлен во время ожидания).
    pub reached_deadline: bool,
    /// Суммарное время, проведённое в активном ожидании (спине).
    pub spin_time: Duration,
    /// Насколько фактическое пробуждение опоздало относительно дедлайна.
    pub sleep_overshoot: Duration,
}

/// Высокоточный таймер с гибридной стратегией ожидания.
///
/// Использует три режима в зависимости от оставшегося времени:
/// 1. **Глубокий сон** — если до дедлайна далеко, отдаём управление ОС.
/// 2. **Кооперативная уступка** — `yield_now()` для снижения нагрузки на CPU
///    на подходе к дедлайну.
/// 3. **Активный спин** — точное ожидание в последние `spin_margin` наносекунд.
///
/// Все три режима проверяют флаг `running`, чтобы корректно завершиться при
/// остановке планировщика. Параметры (`spin_margin`) адаптируются динамически
/// через [`PrecisionTimer::adapt_margin`] на основе метрик.
pub struct PrecisionTimer;

impl PrecisionTimer {
    /// Ожидает наступления `deadline`, комбинируя сон, yield и spin.
    ///
    /// # Аргументы
    /// * `deadline` — момент времени, до которого нужно дождаться.
    /// * `running` — флаг активности планировщика.
    /// * `wake_state` — пара (мьютекс, condvar) для досрочного пробуждения.
    /// * `telemetry` — метрики, из которых читается текущий `spin_margin`.
    ///
    /// # Возвращаемое значение
    /// `WaitOutcome` с признаком достижения дедлайна, суммарным временем спина
    /// и величиной промаха сна за дедлайн.
    pub fn wait_until(
        deadline: Instant,
        running: &AtomicBool,
        wake_state: &(Mutex<bool>, Condvar),
        telemetry: &SchedulerTelemetry,
    ) -> WaitOutcome {
        // Накопители метрик по итерациям.
        let mut spin_time = Duration::ZERO;
        let mut sleep_overshoot = Duration::ZERO;

        // Текущий запас под спин (адаптируется извне).
        let spin_margin = Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));

        // Порог для перехода из глубокого сна в yield.
        // Оставляем вдвое больше времени, чем запас под спин, чтобы успеть
        // сделать пару итераций yield перед финальным спином.
        let yield_threshold = spin_margin * 2;

        loop {
            // Остановка планировщика — выходим без достижения дедлайна.
            if !running.load(Ordering::Acquire) {
                return WaitOutcome { reached_deadline: false, spin_time, sleep_overshoot };
            }

            let now = Instant::now();

            // Дедлайн достигнут.
            if now >= deadline {
                return WaitOutcome { reached_deadline: true, spin_time, sleep_overshoot };
            }

            let remaining = deadline.duration_since(now);

            // 1. Глубокий сон (OS Sleep)
            // Если до дедлайна ещё далеко — спим, оставляя запас под yield и спин.
            if remaining > yield_threshold {
                let timeout = remaining - yield_threshold;
                Self::wait_with_timeout(&wake_state.0, &wake_state.1, timeout);

                // После сна проверяем, не проспали ли мы дедлайн.
                let after_wait = Instant::now();
                if after_wait > deadline {
                    sleep_overshoot = after_wait.duration_since(deadline);
                    return WaitOutcome { reached_deadline: true, spin_time, sleep_overshoot };
                }
                continue;
            }

            // 2. Кооперативная уступка (Yield)
            // Осталось меньше двух spin_margin, но больше одного.
            // Отдаём CPU другим потокам, снижая энергопотребление и нагрузку.
            if remaining > spin_margin {
                thread::yield_now();
                continue;
            }

            // 3. Активный спин (Spin-lock)
            // Последние микросекунды — крутимся для максимальной точности.
            let spin_start = Instant::now();
            while Instant::now() < deadline {
                // Проверяем остановку внутри спина.
                if !running.load(Ordering::Acquire) {
                    spin_time += spin_start.elapsed();
                    return WaitOutcome { reached_deadline: false, spin_time, sleep_overshoot };
                }
                // Подсказка процессору (PAUSE/relax) — снижает потребление.
                std::hint::spin_loop();
            }
            spin_time += spin_start.elapsed();
            return WaitOutcome { reached_deadline: true, spin_time, sleep_overshoot };
        }
    }

    /// Ожидает на condvar с таймаутом, обрабатывая флаг пробуждения.
    ///
    /// Если флаг `wake` уже установлен — возвращается немедленно,
    /// сбрасывая его. Отравление мьютекса игнорируется.
    ///
    /// # Аргументы
    /// * `lock` — мьютекс, связанный с флагом пробуждения.
    /// * `cvar` — условная переменная.
    /// * `timeout` — максимальная длительность ожидания.
    fn wait_with_timeout(lock: &Mutex<bool>, cvar: &Condvar, timeout: Duration) {
        // Захватываем мьютекс, игнорируя отравление.
        let mut wake = lock.lock().unwrap_or_else(|p| p.into_inner());

        // Если флаг уже установлен — не спим, сразу сбрасываем.
        if *wake {
            *wake = false;
            return;
        }

        // Ждём с таймаутом. Результат (сигнал/таймаут) не важен —
        // на следующей итерации цикла всё равно пересчитается состояние.
        let _ = cvar.wait_timeout(wake, timeout);
    }

    /// Адаптирует `spin_margin` на основе метрик времени спина и промахов сна.
    ///
    /// Логика:
    /// - при систематическом промахе сна — увеличиваем запас, чтобы начать
    ///   спин раньше;
    /// - если спин слишком длинный — уменьшаем запас;
    /// - если спин слишком короткий — увеличиваем;
    /// - изменение за шаг ограничено 10 % от текущего значения (антиосцилляция);
    /// - итог клампится с учётом измеренной гранулярности ОС.
    ///
    /// # Аргументы
    /// * `state` — метрики планировщика (читает/записывает `spin_margin_ns`).
    /// * `avg_spin` — среднее время активного ожидания (EMA).
    /// * `avg_overshoot` — средний промах сна за дедлайн (EMA).
    pub fn adapt_margin(state: &SchedulerTelemetry, avg_spin: Duration, avg_overshoot: Duration) {
        // Текущее значение и измеренная гранулярность сна.
        let old_margin = Duration::from_nanos(state.spin_margin_ns.load(Ordering::Relaxed));
        let granularity = Duration::from_nanos(state.sleep_granularity_ns.load(Ordering::Relaxed));

        // Минимальная граница с учётом гранулярности ОС.
        let min_margin = granularity.saturating_mul(2).max(MIN_SPIN_MARGIN).min(MAX_SPIN_MARGIN);

        // Начинаем с текущего значения.
        let mut target = old_margin;

        // Коррекция по промаху сна: увеличиваем запас на половину промаха.
        if avg_overshoot > Duration::ZERO {
            target = target.saturating_add(avg_overshoot / 2);
        }

        // Коррекция по времени спина.
        if avg_spin > TARGET_SPIN_TIME {
            // Спин слишком долгий — уменьшаем запас.
            target = target.saturating_sub((avg_spin - TARGET_SPIN_TIME) / 2);
        } else if avg_spin < TARGET_SPIN_TIME / 2 {
            // Спин слишком короткий — увеличиваем запас.
            target = target.saturating_add((TARGET_SPIN_TIME / 2 - avg_spin) / 2);
        }

        // Ограничиваем шаг изменения (не более 10 % за итерацию),
        // чтобы избежать осцилляций.
        let diff = target.saturating_sub(old_margin);
        let max_change = (old_margin / 10).max(Duration::from_nanos(100));
        let adjusted = if target > old_margin {
            old_margin + diff.min(max_change)
        } else {
            old_margin - (old_margin.saturating_sub(target)).min(max_change)
        };

        // Публикуем новое значение в допустимых границах.
        state.spin_margin_ns.store(
            adjusted.clamp(min_margin, MAX_SPIN_MARGIN).as_nanos() as u64,
            Ordering::Relaxed,
        );
    }
}