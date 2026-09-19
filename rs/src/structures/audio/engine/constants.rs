//! Константы движка.

/// Максимальный размер незавершённых данных в парсере Ogg (8 МБ).
///
/// Защищает от бесконечного роста при повреждённом или бесконечно длинном входе.
pub(crate) const MAX_PARSER_PENDING: usize = 8 * 1024 * 1024;

/// Флаги, добавляемые к ffmpeg перед пользовательскими аргументами.
///
/// Минимизируют задержку старта и убирают лишний вывод:
/// - `-analyzeduration 0` — не тратить время на анализ входного потока;
/// - `-probesize 32` — минимальный размер пробника;
/// - `-vn` — отключить видео;
/// - `-loglevel error` — выводить только ошибки;
/// - `-nostdin` — не читать stdin;
/// - `-hide_banner` — скрыть баннер ffmpeg.
pub(crate) const FFMPEG_PREFIX: &[&str] = &[
    "-analyzeduration", "0",
    "-probesize", "32",
    "-vn",
    "-loglevel", "error",
    "-nostdin",
    "-hide_banner",
];

/// Флаги авто-переподключения, вставляемые перед `-i http...`.
///
/// Используются только для сетевых источников:
/// - `-reconnect 1` — включить переподключение;
/// - `-reconnect_streamed 1` — переподключение для потоковых входов;
/// - `-reconnect_delay_max 5` — максимальная пауза между попытками (сек);
/// - `-reconnect_on_network_error 1` — переподключаться при сетевых ошибках.
pub(crate) const RECONNECT_FLAGS: &[&str] = &[
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-reconnect_on_network_error", "1",
];

/// Начало выходных флагов ffmpeg: кодек Opus и параметр длительности кадра.
///
/// Числовое значение `-frame_duration` подставляется отдельно в `start`
/// через `opus_frame_size_str()`, поэтому здесь только текстовая часть
/// команды — значение не входит в статику.
pub(crate) const OUTPUT_SUFFIX_HEAD: &[&str] = &["-c:a", "libopus", "-frame_duration"];

/// Конец выходных флагов ffmpeg: формат Ogg и вывод в stdout.
///
/// `pipe:1` используется, чтобы ffmpeg писал Ogg/Opus прямо в stdout,
/// откуда его читает reader-поток.
pub(crate) const OUTPUT_SUFFIX_TAIL: &[&str] = &["-f", "ogg", "pipe:1"];