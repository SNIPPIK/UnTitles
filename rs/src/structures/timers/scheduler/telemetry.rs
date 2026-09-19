use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

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

/// Начальные значения метрик — все нули.
impl Default for SchedulerTelemetry {
    fn default() -> Self {
        Self {
            // Метрики джиттера.
            avg_jitter_ns: AtomicU64::new(0),
            max_jitter_ns: AtomicU64::new(0),

            // Метрики обработки.
            avg_process_ns: AtomicU64::new(0),
            max_process_ns: AtomicU64::new(0),

            // Метрики сна.
            avg_sleep_overshoot_ns: AtomicU64::new(0),
            max_sleep_overshoot_ns: AtomicU64::new(0),

            // Метрики спина.
            avg_spin_time_ns: AtomicU64::new(0),
            spin_margin_ns: AtomicU64::new(0),
            sleep_granularity_ns: AtomicU64::new(0),

            // Счётчики.
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
/// # Аргументы
/// * `atomic` — целевое атомарное значение.
/// * `value` — новое измерение.
/// * `shift` — сдвиг для α (например, 4 → α = 1/16).
#[inline]
pub fn update_ema(atomic: &AtomicU64, value: u64, shift: u32) {
    // Читаем текущее значение.
    let old = atomic.load(Ordering::Relaxed);

    // Приращение или убыль со сдвигом вправо (деление на 2^shift).
    let next = if value >= old {
        old.saturating_add((value - old) >> shift)
    } else {
        old.saturating_sub((old - value) >> shift)
    };

    // Публикуем новое значение.
    atomic.store(next, Ordering::Relaxed);
}