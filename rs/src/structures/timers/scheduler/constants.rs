use std::time::Duration;

/// Интервал между тиками планировщика в миллисекундах.
pub const TICK_INTERVAL_MS: u64 = 20;

/// Тот же интервал в виде `Duration` — используется в арифметике времени.
pub const TICK_INTERVAL: Duration = Duration::from_millis(TICK_INTERVAL_MS);

/// Сдвиг для экспоненциального скользящего среднего: α = 1 / 2^4 = 1/16.
/// Меньший α сглаживает сильнее, но медленнее реагирует на изменения.
pub const ALPHA_SHIFT: u32 = 4;

/// Как часто (в тиках) пересчитывать `spin_margin`.
/// 100 тиков при интервале 20 мс — примерно раз в 2 секунды.
pub const ADAPT_INTERVAL: u64 = 100;

/// Количество замеров при калибровке гранулярности системного сна.
pub const SAMPLES: usize = 10;

/// Целевое среднее время активного спина.
/// Ограничение сверху нужно для экономии CPU: длинный спин вреден,
/// но короткий запас не даёт достаточной точности.
pub const TARGET_SPIN_TIME: Duration = Duration::from_micros(500);

/// Минимальный запас перед дедлайном для перехода в спин.
/// Ниже этого значения активное ожидание не имеет смысла.
pub const MIN_SPIN_MARGIN: Duration = Duration::from_micros(100);

/// Максимальный запас перед дедлайном для перехода в спин.
/// Выше этого значения спин начинает заметно нагружать CPU.
pub const MAX_SPIN_MARGIN: Duration = Duration::from_micros(700);

/// Запрашиваемая длительность сна при калибровке гранулярности ОС.
pub const REQUESTED_SLEEP: Duration = Duration::from_millis(1);

/// Верхняя граница измеренной гранулярности сна — защита от выбросов
/// при калибровке (например, на загруженной системе).
pub const MAX_GRANULARITY: Duration = Duration::from_millis(1);