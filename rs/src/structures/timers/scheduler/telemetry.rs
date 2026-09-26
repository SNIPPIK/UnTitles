use std::sync::atomic::{AtomicU64, Ordering};

/// Атомарные метрики планировщика (все длительности — в наносекундах).
///
/// Обновляются воркером цикла и доступны для чтения извне.
/// Используются для адаптации `spin_margin` и мониторинга качества расписания.
pub struct SchedulerTelemetry {
    /// Средний джиттер пробуждения относительно дедлайна (EMA).
    pub avg_jitter_ns: AtomicU64,
    /// Максимальный зафиксированный джиттер.
    pub max_jitter_ns: AtomicU64,

    /// Среднее время обработки снимка сессий (EMA).
    pub avg_process_ns: AtomicU64,
    /// Максимальное время обработки снимка сессий.
    pub max_process_ns: AtomicU64,

    /// Средний промах системного сна за дедлайн (EMA).
    pub avg_sleep_overshoot_ns: AtomicU64,
    /// Максимальный промах системного сна.
    pub max_sleep_overshoot_ns: AtomicU64,

    /// Среднее фактическое время активного спина (EMA).
    pub avg_spin_time_ns: AtomicU64,

    /// Текущий адаптивный запас перед дедлайном для перехода в спин.
    pub spin_margin_ns: AtomicU64,

    /// Измеренная гранулярность системного сна.
    pub sleep_granularity_ns: AtomicU64,

    /// Общее количество выполненных тиков.
    pub ticks: AtomicU64,

    /// Число тиков, в которых был активирован burst-режим отправки.
    pub emergency_bursts: AtomicU64,

    /// Суммарное количество дополнительных слотов, добавленных burst-режимом.
    pub extra_frames_budgeted: AtomicU64,
}

impl Default for SchedulerTelemetry {
    fn default() -> Self {
        Self {
            avg_jitter_ns: AtomicU64::new(0),
            max_jitter_ns: AtomicU64::new(0),

            avg_process_ns: AtomicU64::new(0),
            max_process_ns: AtomicU64::new(0),

            avg_sleep_overshoot_ns: AtomicU64::new(0),
            max_sleep_overshoot_ns: AtomicU64::new(0),

            avg_spin_time_ns: AtomicU64::new(0),

            // Стартуем не с нуля, а с середины допустимого диапазона:
            // при spin_margin_ns == 0 первый вызов PrecisionTimer::wait_until
            // (до первого adapt_margin) целиком уходит в OS-сон без
            // yield/spin-уточнения — см. MIN_SPIN_MARGIN/MAX_SPIN_MARGIN
            // в constants.rs.
            spin_margin_ns: AtomicU64::new(
                crate::structures::timers::scheduler::constants::MIN_SPIN_MARGIN
                    .as_nanos() as u64
                    + (crate::structures::timers::scheduler::constants::MAX_SPIN_MARGIN
                    .as_nanos() as u64
                    - crate::structures::timers::scheduler::constants::MIN_SPIN_MARGIN
                    .as_nanos() as u64)
                    / 2,
            ),
            sleep_granularity_ns: AtomicU64::new(0),

            ticks: AtomicU64::new(0),
            emergency_bursts: AtomicU64::new(0),
            extra_frames_budgeted: AtomicU64::new(0),
        }
    }
}

/// Обновляет атомарное значение через экспоненциальное скользящее среднее
/// с коэффициентом α = 1 / 2^shift.
///
/// Реализовано без CAS: чтение и запись не атомарны между собой, но для метрик
/// это допустимо — небольшая потеря точности не критична.
///
/// Гарантирует минимум ±1 шаг движения к цели, пока `value != old`: при
/// малой разнице (`diff < 2^shift`) чистое `diff >> shift` даёт 0, и без
/// этой поправки EMA может застрять, не дойдя до истинного среднего на
/// величину до `2^shift - 1`.
///
/// # Аргументы
/// * `atomic` — целевое атомарное значение.
/// * `value` — новое измерение.
/// * `shift` — сдвиг для α (например, 4 → α = 1/16).
#[inline]
pub fn update_ema(atomic: &AtomicU64, value: u64, shift: u32) {
    let old = atomic.load(Ordering::Relaxed);

    let next = if value >= old {
        let diff = value - old;
        let step = (diff >> shift).max(u64::from(diff > 0));
        old.saturating_add(step.min(diff))
    } else {
        let diff = old - value;
        let step = (diff >> shift).max(u64::from(diff > 0));
        old.saturating_sub(step.min(diff))
    };

    atomic.store(next, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ema_converges_upward() {
        let atomic = AtomicU64::new(0);
        for _ in 0..500 {
            update_ema(&atomic, 1000, 4);
        }
        assert_eq!(atomic.load(Ordering::Relaxed), 1000);
    }

    #[test]
    fn ema_converges_downward() {
        let atomic = AtomicU64::new(1000);
        for _ in 0..500 {
            update_ema(&atomic, 0, 4);
        }
        assert_eq!(atomic.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn ema_does_not_stall_on_small_diff() {
        // Регрессия на баг "застревания": при diff < 2^shift старая
        // реализация (diff >> shift == 0) никогда не доходила до цели.
        let atomic = AtomicU64::new(100);
        let mut prev = 100;
        let mut progressed = false;

        for _ in 0..20 {
            update_ema(&atomic, 105, 4); // diff = 5 < 16
            let cur = atomic.load(Ordering::Relaxed);
            if cur != prev {
                progressed = true;
            }
            prev = cur;
        }

        assert!(progressed, "EMA must not stall when 0 < diff < 2^shift");
        assert_eq!(prev, 105, "EMA must eventually reach the target");
    }

    #[test]
    fn ema_never_overshoots_target() {
        let atomic = AtomicU64::new(0);
        for _ in 0..1000 {
            update_ema(&atomic, 50, 4);
            assert!(atomic.load(Ordering::Relaxed) <= 50);
        }
    }
}