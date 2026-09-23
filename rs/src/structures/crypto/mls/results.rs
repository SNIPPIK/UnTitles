use std::time::Instant;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

/// Результат обработки proposals: commit и опциональный welcome.
///
/// Возвращается из `process_proposals`. Поле `commit` присутствует, если
/// нативная сессия сформировала новый commit для группы; `welcome` — только
/// если в группу добавляются новые участники и им нужно приглашение.
#[napi(object)]
pub struct ProposalsResult {
  /// Данные commit. `None`, если commit не требуется.
  pub commit: Option<Buffer>,

  /// Данные welcome. `None`, если новых участников нет.
  pub welcome: Option<Buffer>,
}

/// Результат обработки commit или welcome.
///
/// Возвращается из `process_commit` и `process_welcome`.
#[napi(object)]
pub struct TransitionResult {
  /// Идентификатор перехода (первые 2 байта payload).
  #[napi(js_name = "transition_id")]
  pub transition_id: u16,

  /// `true`, если обработка завершилась успешно.
  pub success: bool,

  /// `true`, если переход признан невалидным и требует повторной инициализации.
  /// Устанавливается только при первой ошибке; повторные ошибки во время
  /// уже начатой повторной инициализации сигнал не выставляют.
  #[napi(js_name = "invalidated")]
  pub invalidated: bool,
}

/// Запись об ожидаемом переходе.
///
/// Хранится в `pending_transitions` до момента вызова `execute_transition`
/// или до истечения `expires_at`, после чего удаляется через
/// `expire_transitions`.
pub struct PendingTransition {
  /// Целевая версия протокола, которая будет применена при выполнении перехода.
  pub(crate) version: u16,

  /// Момент времени, после которого запись считается устаревшей.
  /// Вычисляется как `Instant::now() + TRANSITION_TIMEOUT`.
  pub(crate) expires_at: Instant,
}