use crate::structures::timers::scheduler::MIN_SPIN_MARGIN;
use std::sync::atomic::AtomicU64;

/// Набор атомарных метрик планировщика цикла.
///
/// Все длительности хранятся в наносекундах. Значения обновляются воркер-потоком
/// и доступны извне для мониторинга и адаптации параметров расписания.
pub struct SchedulerState {
    /// Общее число выполненных тиков цикла.
    pub ticks: AtomicU64,

    /// Среднее время обработки снимка сессий (EMA).
    pub avg_process_ns: AtomicU64,
    /// Максимальное зафиксированное время обработки.
    pub max_process_ns: AtomicU64,

    /// Средний промах системного sleep за дедлайн (EMA).
    pub avg_sleep_overshoot_ns: AtomicU64,
    /// Максимальный промах системного sleep.
    pub max_sleep_overshoot_ns: AtomicU64,

    /// Среднее фактическое время активного ожидания (спина), EMA.
    pub avg_spin_time_ns: AtomicU64,

    /// Средний джиттер пробуждения относительно дедлайна (EMA).
    pub avg_jitter_ns: AtomicU64,
    /// Максимальный джиттер пробуждения.
    pub max_jitter_ns: AtomicU64,

    /// Измеренная гранулярность системного сна (медианный overshoot).
    pub sleep_granularity_ns: AtomicU64,
    /// Текущий адаптивный запас времени перед дедлайном для перехода в спин.
    pub spin_margin_ns: AtomicU64,

    /// Число циклов, в которых был запрошен burst-режим (срочная догрузка).
    pub emergency_bursts: AtomicU64,

    /// Суммарное количество дополнительных слотов, добавленных burst-режимом.
    pub extra_frames_budgeted: AtomicU64,
}

/// Начальные значения метрик.
impl Default for SchedulerState {
    #[inline]
    fn default() -> Self {
        Self {
            // Тики цикла.
            ticks: AtomicU64::new(0),

            // Обработка снимка сессий.
            avg_process_ns: AtomicU64::new(0),
            max_process_ns: AtomicU64::new(0),

            // Планирование (джиттер пробуждения).
            avg_jitter_ns: AtomicU64::new(0),
            max_jitter_ns: AtomicU64::new(0),

            // Системный sleep.
            avg_sleep_overshoot_ns: AtomicU64::new(0),
            max_sleep_overshoot_ns: AtomicU64::new(0),
            sleep_granularity_ns: AtomicU64::new(0),

            // Спин: начинаем с минимально допустимого запаса.
            spin_margin_ns: AtomicU64::new(
                MIN_SPIN_MARGIN.as_nanos() as u64
            ),

            // Burst-режим изначально не активирован.
            emergency_bursts: Default::default(),
            avg_spin_time_ns: AtomicU64::new(0),
            extra_frames_budgeted: Default::default(),
        }
    }
}