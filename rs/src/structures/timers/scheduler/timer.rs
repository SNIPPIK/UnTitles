use crate::structures::timers::scheduler::constants::{
    MAX_SPIN_MARGIN, MIN_SPIN_MARGIN, TARGET_SPIN_TIME,
};
use crate::structures::timers::scheduler::telemetry::SchedulerTelemetry;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Condvar, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

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
///
/// Примечание: значение `spin_margin`, используемое внутри одного вызова
/// `wait_until`, фиксируется один раз в начале вызова. Если `adapt_margin`
/// изменит его конкурентно во время ожидания — изменение будет учтено
/// только на следующем вызове `wait_until`. Это осознанный выбор: пересчёт
/// внутри одного тика усложнил бы код без заметной практической пользы.
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
        let mut spin_time = Duration::ZERO;
        let mut sleep_overshoot = Duration::ZERO;

        // Текущий запас под спин (адаптируется извне между вызовами).
        // spin_margin_ns инициализируется ненулевым значением в
        // SchedulerTelemetry::default(), поэтому даже первый вызов
        // wait_until (до первого adapt_margin) проходит через
        // yield/spin-уточнение, а не уходит в чистый OS-сон до дедлайна.
        let spin_margin = Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));

        // Порог для перехода из глубокого сна в yield.
        let yield_threshold = spin_margin * 2;

        loop {
            if !running.load(Ordering::Acquire) {
                return WaitOutcome {
                    reached_deadline: false,
                    spin_time,
                    sleep_overshoot,
                };
            }

            let now = Instant::now();

            if now >= deadline {
                return WaitOutcome {
                    reached_deadline: true,
                    spin_time,
                    sleep_overshoot,
                };
            }

            let remaining = deadline.duration_since(now);

            // Глубокий сон (OS Sleep).
            if remaining > yield_threshold {
                let timeout = remaining - yield_threshold;
                Self::wait_with_timeout(&wake_state.0, &wake_state.1, timeout);

                let after_wait = Instant::now();
                if after_wait > deadline {
                    sleep_overshoot = after_wait.duration_since(deadline);
                    return WaitOutcome {
                        reached_deadline: true,
                        spin_time,
                        sleep_overshoot,
                    };
                }
                continue;
            }

            // Кооперативная уступка (Yield).
            if remaining > spin_margin {
                thread::yield_now();
                continue;
            }

            // Активный спин (Spin-lock).
            let spin_start = Instant::now();
            while Instant::now() < deadline {
                if !running.load(Ordering::Acquire) {
                    spin_time += spin_start.elapsed();
                    return WaitOutcome {
                        reached_deadline: false,
                        spin_time,
                        sleep_overshoot,
                    };
                }
                std::hint::spin_loop();
            }
            spin_time += spin_start.elapsed();
            return WaitOutcome {
                reached_deadline: true,
                spin_time,
                sleep_overshoot,
            };
        }
    }

    /// Ожидает на condvar с тайм-аутом, обрабатывая флаг пробуждения.
    ///
    /// Если флаг `wake` уже установлен — возвращается немедленно,
    /// сбрасывая его. Отравление мьютекса игнорируется.
    fn wait_with_timeout(lock: &Mutex<bool>, cvar: &Condvar, timeout: Duration) {
        let mut wake = lock.lock().unwrap_or_else(|p| p.into_inner());

        if *wake {
            *wake = false;
            return;
        }

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
    /// - итог с учётом измеренной гранулярности ОС.
    ///
    /// # Аргументы
    /// * `state` — метрики планировщика (читает/записывает `spin_margin_ns`).
    /// * `avg_spin` — среднее время активного ожидания (EMA).
    /// * `avg_overshoot` — средний промах сна за дедлайн (EMA).
    pub fn adapt_margin(state: &SchedulerTelemetry, avg_spin: Duration, avg_overshoot: Duration) {
        let old_margin = Duration::from_nanos(state.spin_margin_ns.load(Ordering::Relaxed));
        let granularity = Duration::from_nanos(state.sleep_granularity_ns.load(Ordering::Relaxed));

        let min_margin = granularity
            .saturating_mul(2)
            .max(MIN_SPIN_MARGIN)
            .min(MAX_SPIN_MARGIN);

        let mut target = old_margin;

        if avg_overshoot > Duration::ZERO {
            target = target.saturating_add(avg_overshoot / 2);
        }

        if avg_spin > TARGET_SPIN_TIME {
            target = target.saturating_sub((avg_spin - TARGET_SPIN_TIME) / 2);
        } else if avg_spin < TARGET_SPIN_TIME / 2 {
            target = target.saturating_add((TARGET_SPIN_TIME / 2 - avg_spin) / 2);
        }

        // Ограничиваем шаг изменения (не более 10 % за итерацию, но не
        // меньше 100 нс), чтобы избежать осцилляций. Считаем модуль сдвига
        // один раз через `abs_diff`, вместо повторного вычисления разницы
        // в обеих ветках направления.
        let max_change = (old_margin / 10).max(Duration::from_nanos(100));
        let step = old_margin.abs_diff(target).min(max_change);
        let adjusted = if target >= old_margin {
            old_margin + step
        } else {
            old_margin - step
        };

        state.spin_margin_ns.store(
            adjusted.clamp(min_margin, MAX_SPIN_MARGIN).as_nanos() as u64,
            Ordering::Relaxed,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    fn telemetry_with_margin(margin: Duration, granularity: Duration) -> SchedulerTelemetry {
        let telemetry = SchedulerTelemetry::default();
        telemetry
            .spin_margin_ns
            .store(margin.as_nanos() as u64, Ordering::Relaxed);
        telemetry
            .sleep_granularity_ns
            .store(granularity.as_nanos() as u64, Ordering::Relaxed);
        telemetry
    }

    #[test]
    fn adapt_margin_increases_on_sleep_overshoot() {
        let telemetry = telemetry_with_margin(Duration::from_micros(300), Duration::ZERO);
        PrecisionTimer::adapt_margin(
            &telemetry,
            TARGET_SPIN_TIME, // спин "в норме", не давит на изменение
            Duration::from_micros(100),
        );
        let new_margin =
            Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        assert!(new_margin > Duration::from_micros(300));
    }

    #[test]
    fn adapt_margin_decreases_when_spin_too_long() {
        let telemetry = telemetry_with_margin(Duration::from_micros(300), Duration::ZERO);
        PrecisionTimer::adapt_margin(
            &telemetry,
            TARGET_SPIN_TIME * 4,
            Duration::ZERO,
        );
        let new_margin =
            Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        assert!(new_margin < Duration::from_micros(300));
    }

    #[test]
    fn adapt_margin_never_exceeds_max() {
        let telemetry = telemetry_with_margin(MAX_SPIN_MARGIN, Duration::ZERO);
        for _ in 0..50 {
            PrecisionTimer::adapt_margin(&telemetry, Duration::ZERO, Duration::from_secs(1));
        }
        let margin = Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        assert!(margin <= MAX_SPIN_MARGIN);
    }

    #[test]
    fn adapt_margin_respects_granularity_based_min() {
        // granularity * 2 > MIN_SPIN_MARGIN -> нижняя граница поднимается.
        let granularity = MIN_SPIN_MARGIN; // *2 гарантированно выше MIN_SPIN_MARGIN
        let telemetry = telemetry_with_margin(MIN_SPIN_MARGIN, granularity);
        for _ in 0..50 {
            PrecisionTimer::adapt_margin(&telemetry, TARGET_SPIN_TIME * 10, Duration::ZERO);
        }
        let margin = Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        assert!(margin >= granularity.saturating_mul(2).min(MAX_SPIN_MARGIN));
    }

    #[test]
    fn adapt_margin_step_is_bounded() {
        let telemetry = telemetry_with_margin(Duration::from_micros(500), Duration::ZERO);
        PrecisionTimer::adapt_margin(&telemetry, Duration::ZERO, Duration::from_secs(1));
        let new_margin =
            Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        // Шаг не должен быть больше max(10% от старого, 100нс) + клампинг.
        let max_expected_step = Duration::from_micros(50).max(Duration::from_nanos(100));
        assert!(new_margin <= Duration::from_micros(500) + max_expected_step);
    }

    #[test]
    fn wait_until_returns_immediately_for_past_deadline() {
        let running = AtomicBool::new(true);
        let wake_state = (Mutex::new(false), Condvar::new());
        let telemetry = SchedulerTelemetry::default();

        let outcome = PrecisionTimer::wait_until(
            Instant::now() - Duration::from_millis(1),
            &running,
            &wake_state,
            &telemetry,
        );

        assert!(outcome.reached_deadline);
    }

    #[test]
    fn wait_until_stops_when_running_flag_cleared() {
        let running = AtomicBool::new(false);
        let wake_state = (Mutex::new(false), Condvar::new());
        let telemetry = SchedulerTelemetry::default();

        let outcome = PrecisionTimer::wait_until(
            Instant::now() + Duration::from_millis(50),
            &running,
            &wake_state,
            &telemetry,
        );

        assert!(!outcome.reached_deadline);
    }
}