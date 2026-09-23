use crate::structures::crypto::mls::results::{
    PendingTransition, ProposalsResult, TransitionResult
};
use napi::bindgen_prelude::{Buffer, Error, Result};
use napi_derive::napi;
use std::{
    collections::HashMap,
    num::NonZeroU16,
    time::{
        Duration, Instant
    }
};

/// Время (сек) до автоматического истечения passthrough после перехода.
const TRANSITION_EXPIRY: u32 = 10;

/// Увеличенный срок passthrough при ожидании понижения версии.
const TRANSITION_EXPIRY_PENDING_DOWNGRADE: u32 = 24;

/// Тайм-аут ожидания перехода: если `execute_transition` не вызван
/// за это время, запись о нём удаляется.
const TRANSITION_TIMEOUT: Duration = Duration::from_secs(5);

/// Обёртка над `davey::DaveSession` для работы из JavaScript.
///
/// Управляет E2EE-состоянием голосового канала: обмен ключами, переходы
/// между версиями протокола, обработка proposals/commit/welcome, шифрование
/// Opus-пакетов. Нативная сессия создаётся лениво при первой инициализации.
#[napi(js_name = "MLSSession")]
pub struct MlsSession {
    /// Текущая версия протокола.
    version: u16,

    /// Идентификатор пользователя (строка до парсинга).
    user_id: String,

    /// Идентификатор канала (строка до парсинга).
    channel_id: String,

    /// Нативная сессия. `None` до первой инициализации.
    inner: Option<davey::DaveSession>,

    /// Флаг уничтожения.
    destroyed: bool,

    /// Флаг повторной инициализации (после ошибки перехода или при epoch).
    reinitializing: bool,

    /// Флаг выполнения перехода в текущий момент.
    is_transitioning: bool,

    /// Флаг понижения версии (переход с ненулевой на 0).
    downgraded: bool,

    /// Идентификатор последнего успешного перехода.
    last_transition_id: Option<u16>,

    /// Ожидаемые переходы: id → запись о переходе.
    pending_transitions: HashMap<u16, PendingTransition>,

    /// External sender, отложенный до создания нативной сессии.
    pending_external_sender: Option<Vec<u8>>,
}

#[napi]
impl MlsSession {
    /// Создаёт обёртку без нативной сессии.
    ///
    /// # Аргументы
    /// * `version` — начальная версия протокола.
    /// * `user_id` — идентификатор пользователя.
    /// * `channel_id` — идентификатор канала.
    #[napi(constructor)]
    pub fn new(version: u16, user_id: String, channel_id: String) -> Self {
        Self {
            version,
            user_id,
            channel_id,

            // Нативная сессия ещё не создана.
            inner: None,

            destroyed: false,
            reinitializing: false,
            is_transitioning: false,
            downgraded: false,

            last_transition_id: None,
            pending_transitions: HashMap::new(),
            pending_external_sender: None,
        }
    }

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// `true`, если сессия уничтожена.
    ///
    /// Устанавливается в `destroy()` и остаётся `true` до конца жизни объекта.
    #[napi(getter)]
    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    /// `true`, если сессия повторно инициализируется.
    ///
    /// Устанавливается при `recoverFromInvalidTransition` или первой ошибке
    /// обработки commit/welcome. Сбрасывается после успешного завершения
    /// перехода с `transition_id == 0`.
    #[napi(getter)]
    pub fn reinitializing(&self) -> bool {
        self.reinitializing
    }

    /// `true`, если в данный момент выполняется переход.
    ///
    /// Используется как защита от повторного входа в `execute_transition`
    /// и от параллельного шифрования во время смены версии протокола.
    #[napi(getter, js_name = "isTransitioning")]
    pub fn is_transitioning(&self) -> bool {
        self.is_transitioning
    }

    /// Идентификатор последнего успешно выполненного перехода.
    ///
    /// `None`, если переходов ещё не было или сессия была уничтожена.
    #[napi(getter, js_name = "lastTransitionId")]
    pub fn last_transition_id(&self) -> Option<u16> {
        self.last_transition_id
    }

    /// `true`, если нативная сессия готова к шифрованию.
    ///
    /// `false`, если нативная сессия ещё не создана или не завершила обмен ключами.
    #[napi(getter)]
    pub fn ready(&self) -> bool {
        self.inner
            .as_ref()
            .map(|session| session.is_ready())
            .unwrap_or(false)
    }

    /// Внутренний статус нативной сессии.
    ///
    /// `None`, если нативная сессия ещё не создана. Значения соответствуют
    /// внутреннему перечислению `davey::Status`.
    #[napi(getter)]
    pub fn status(&self) -> Option<u8> {
        self.inner
            .as_ref()
            .map(|session| session.status() as u8)
    }

    /// Версия протокола активной нативной сессии.
    ///
    /// Возвращает 0, если нативная сессия ещё не создана. Не путать
    /// с полем `self.version`, которое хранит запрошенную версию и может
    /// отличаться от фактической версии нативной сессии.
    #[napi(getter, js_name = "protocolVersion")]
    pub fn protocol_version(&self) -> u16 {
        self.inner
            .as_ref()
            .map(|session| session.protocol_version().get())
            .unwrap_or(0)
    }

    // ---------------------------------------------------------------------
    // External sender
    // ---------------------------------------------------------------------

    /// Устанавливает внешнего отправителя.
    ///
    /// Если нативная сессия уже создана — передаёт значение напрямую,
    /// иначе откладывает до момента инициализации.
    #[napi(setter, js_name = "externalSender")]
    pub fn set_external_sender(&mut self, data: Buffer) -> Result<()> {
        match self.inner.as_mut() {
            // Сессия есть — применяем сразу.
            Some(inner) => inner
                .set_external_sender(data.as_ref())
                .map_err(Self::map_err),

            // Сессия ещё не создана — сохраняем до reinit.
            None => {
                self.pending_external_sender =
                    Some(data.to_vec());

                Ok(())
            }
        }
    }

    // ---------------------------------------------------------------------
    // Epoch
    // ---------------------------------------------------------------------

    /// Обрабатывает данные подготовки эпохи.
    ///
    /// Реагирует только на эпоху 1; остальные случаи игнорируются.
    /// Обновляет версию протокола и запускает `reinit`.
    ///
    /// # Аргументы
    /// * `epoch` — номер эпохи.
    /// * `protocol_version` — версия протокола для этой эпохи.
    ///
    /// # Возвращаемое значение
    /// Новый key-package, если он был создан.
    #[napi(js_name = "prepareEpoch")]
    pub fn prepare_epoch(&mut self, epoch: u32, protocol_version: u16) -> Result<Option<Buffer>> {
        // Уничтоженная сессия не обрабатывает данные.
        if self.destroyed { return Ok(None); }

        // Идёт повторная инициализация — избегаем повторного входа.
        else if self.reinitializing { return Ok(None); }

        // Только первая эпоха вызывает инициализацию.
        else if epoch != 1 { return Ok(None); }

        self.version = protocol_version;
        self.reinit_internal()
    }

    // ---------------------------------------------------------------------
    // Invalid transition recovery
    // ---------------------------------------------------------------------

    /// Запускает восстановление после невалидного перехода.
    ///
    /// Устанавливает флаг `reinitializing`, очищает ожидающие переходы
    /// и выполняет `reinit_internal`.
    ///
    /// # Аргументы
    /// * `transition_id` — идентификатор невалидного перехода.
    ///
    /// # Возвращаемое значение
    /// Новый key-package, если он был создан.
    #[napi(js_name = "recoverFromInvalidTransition")]
    pub fn recover_from_invalid_transition(&mut self, transition_id: u16) -> Result<Option<Buffer>> {
        // Уничтоженная сессия не восстанавливается.
        if self.destroyed { return Ok(None); }

        // Уже в процессе — не входим повторно.
        else if self.reinitializing { return Ok(None); }

        self.reinitializing = true;

        // Все ожидающие переходы больше не актуальны.
        self.clear_transitions();
        let key = self.reinit_internal()?;

        // transition_id не используется в восстановлении — принимается для совместимости API.
        let _ = transition_id;

        Ok(key)
    }

    // ---------------------------------------------------------------------
    // Reinit
    // ---------------------------------------------------------------------

    /// Повторна инициализирует нативную сессию с текущей версией протокола.
    ///
    /// # Возвращаемое значение
    /// Новый key-package, если он был создан.
    #[napi]
    pub fn reinit(&mut self) -> Result<Option<Buffer>> {
        self.reinit_internal()
    }

    /// Внутренняя реализация повторной инициализации.
    ///
    /// Для версии > 0 создаёт или повторно инициализирует нативную сессию,
    /// применяет отложенный external sender и возвращает key-package.
    /// Для версии 0 сбрасывает сессию и включает passthrough.
    fn reinit_internal(&mut self) -> Result<Option<Buffer>> {
        // Уничтоженная сессия повторно не инициализируется.
        if self.destroyed { return Ok(None); }

        if self.version > 0 {
            // Версия должна быть ненулевой для NonZeroU16.
            let version = NonZeroU16::new(self.version)
                .ok_or_else(|| {
                    Error::from_reason(
                        "Protocol version must be non-zero",
                    )
                })?;

            // Парсим идентификаторы из строк.
            let user_id = Self::parse_id(&self.user_id, "user id")?;
            let channel_id = Self::parse_id(&self.channel_id, "channel id")?;

            match self.inner.as_mut() {
                // Сессия уже существует — повторно инициализируем.
                Some(inner) => {
                    inner
                        .reinit(
                            version,
                            user_id,
                            channel_id,
                            None,
                        )
                        .map_err(Self::map_err)?;
                }

                // Сессия ещё не создана — создаём новую.
                None => {
                    self.inner = Some(
                        davey::DaveSession::new(
                            version,
                            user_id,
                            channel_id,
                            None,
                        )
                            .map_err(Self::map_err)?,
                    );
                }
            }

            // Применяем отложенный external sender.
            if let Some(external_sender) =
                self.pending_external_sender.take()
            {
                self.inner
                    .as_mut()
                    .unwrap()
                    .set_external_sender(&external_sender)
                    .map_err(Self::map_err)?;
            }

            // Формируем key-package для отправки другим участникам.
            let key_package = self
                .inner
                .as_mut()
                .unwrap()
                .create_key_package()
                .map_err(Self::map_err)?;

            return Ok(Some(Buffer::from(key_package)));
        }

        // Версия 0: сбрасываем сессию и включаем passthrough.
        if let Some(inner) = self.inner.as_mut() {
            inner.reset().map_err(Self::map_err)?;
            inner.set_passthrough_mode(true, Some(TRANSITION_EXPIRY));
        }

        Ok(None)
    }

    // ---------------------------------------------------------------------
    // Reset
    // ---------------------------------------------------------------------

    /// Сбрасывает состояние нативной сессии без её уничтожения.
    #[napi]
    pub fn reset(&mut self) -> Result<()> {
        match self.inner.as_mut() {
            Some(inner) => {
                inner.reset().map_err(Self::map_err)
            }

            // Сессии ещё нет — сбрасывать нечего.
            None => Ok(()),
        }
    }

    // ---------------------------------------------------------------------
    // Destroy
    // ---------------------------------------------------------------------

    /// Полностью уничтожает сессию и освобождает ресурсы.
    /// Идемпотентен: повторный вызов не выполняет действий.
    #[napi]
    pub fn destroy(&mut self) {
        // Защита от повторного вызова.
        if self.destroyed { return; }

        self.destroyed = true;
        self.is_transitioning = true;

        // Сбрасываем нативную сессию, если она была создана.
        if let Some(inner) = self.inner.as_mut() {
            let _ = inner.reset();
        }

        // Очищаем ожидающие переходы.
        self.clear_transitions();

        // Обнуляем ссылки для помощи GC.
        self.inner = None;
        self.pending_external_sender = None;

        self.reinitializing = false;
        self.downgraded = false;

        self.last_transition_id = None;
    }

    // ---------------------------------------------------------------------
    // Passthrough
    // ---------------------------------------------------------------------

    /// Включает или выключает passthrough-режим.
    ///
    /// В passthrough медиа-пакеты передаются без шифрования/расшифровки.
    ///
    /// # Аргументы
    /// * `enabled` — `true` для включения.
    /// * `expiry` — время жизни режима в секундах (опционально).
    #[napi(js_name = "setPassthroughMode")]
    pub fn set_passthrough_mode(&mut self, enabled: bool, expiry: Option<u32>) {
        // Если сессии нет — операция игнорируется.
        if let Some(inner) = self.inner.as_mut() {
            inner.set_passthrough_mode(
                enabled,
                expiry,
            );
        }
    }

    // ---------------------------------------------------------------------
    // Key package
    // ---------------------------------------------------------------------

    /// Возвращает сериализованный key-package.
    ///
    /// # Ошибки
    /// Возвращает ошибку, если нативная сессия ещё не создана.
    #[napi(js_name = "getSerializedKeyPackage")]
    pub fn get_serialized_key_package(&mut self) -> Result<Buffer> {
        // Без активной сессии key-package создать нельзя.
        let inner = self
            .inner
            .as_mut()
            .ok_or_else(|| {
                Error::from_reason(
                    "Session not initialized",
                )
            })?;

        let key_package = inner.create_key_package().map_err(Self::map_err)?;
        Ok(Buffer::from(key_package))
    }

    // ---------------------------------------------------------------------
    // Proposals
    // ---------------------------------------------------------------------

    /// Обрабатывает proposals от другого участника.
    ///
    /// # Аргументы
    /// * `operation_type` — тип операции (0 или 1).
    /// * `proposals` — сериализованные предложения.
    /// * `recognized_user_ids` — известные идентификаторы пользователей.
    ///
    /// # Возвращаемое значение
    /// `ProposalsResult` с commit и welcome (если есть).
    #[napi(js_name = "processProposals")]
    pub fn process_proposals(&mut self, operation_type: u8, proposals: Buffer, recognized_user_ids: Option<Vec<String>>) -> Result<ProposalsResult> {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Если сессии нет — возвращаем пустой результат.
        let inner = match self.inner.as_mut() {
            Some(inner) => inner,

            None => {
                return Ok(ProposalsResult {
                    commit: None,
                    welcome: None,
                });
            }
        };

        // Преобразуем числовой код операции в enum.
        let operation = Self::map_operation(operation_type)?;

        // Парсим recognized user ids, если переданы.
        let recognized_ids =
            match recognized_user_ids {
                Some(ids) => Some(
                    ids.into_iter()
                        .map(|id| {
                            Self::parse_id(
                                &id,
                                "recognized user id",
                            )
                        })
                        .collect::<Result<Vec<_>>>()?,
                ),

                None => None,
            };

        let result = inner.process_proposals(
                operation,
                proposals.as_ref(),
                recognized_ids.as_deref(),
        )
        .map_err(Self::map_err)?;

        Ok(match result {
            // Результат содержит commit (и, возможно, welcome).
            Some(commit_welcome) => {
                ProposalsResult {
                    commit: Some(
                        Buffer::from(
                            commit_welcome.commit,
                        ),
                    ),
                    welcome: commit_welcome
                        .welcome
                        .map(Buffer::from),
                }
            }

            // Коммит не требуется.
            None => ProposalsResult {
                commit: None,
                welcome: None,
            },
        })
    }

    // ---------------------------------------------------------------------
    // Commit
    // ---------------------------------------------------------------------

    /// Обрабатывает commit от другого участника.
    ///
    /// Первые два байта payload — `transition_id`.
    ///
    /// # Аргументы
    /// * `payload` — сериализованные данные commit.
    ///
    /// # Возвращаемое значение
    /// `TransitionResult` с `transition_id`, флагом успеха и признаком
    /// невалидности (для инициирования повторной инициализации).
    #[napi(js_name = "processCommit")]
    pub fn process_commit(&mut self, payload: Buffer) -> Result<TransitionResult> {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Минимум 2 байта под transition_id.
        if payload.len() < 2 {
            return Err(Error::from_reason(
                "Commit payload too short",
            ));
        }

        // transition_id в первых двух байтах (BE).
        let transition_id = u16::from_be_bytes([
            payload[0],
            payload[1],
        ]);

        // Если сессии нет — вернуть неуспех без повторной инициализации.
        let inner = match self.inner.as_mut() {
            Some(inner) => inner,

            None => {
                return Ok(TransitionResult {
                    transition_id,
                    success: false,
                    invalidated: false,
                });
            }
        };

        match inner.process_commit(&payload[2..]) {
            Ok(()) => {
                if transition_id != 0 {
                    // Ненулевой id — переход откладывается до execute_transition.
                    self.pending_transitions.insert(
                        transition_id,
                        PendingTransition {
                            version: self.version,
                            expires_at: Instant::now()
                                + TRANSITION_TIMEOUT,
                        },
                    );
                } else {
                    // Нулевой id — переход завершён сразу.
                    self.reinitializing = false;
                    self.last_transition_id =
                        Some(transition_id);
                }

                Ok(TransitionResult {
                    transition_id,
                    success: true,
                    invalidated: false,
                })
            }

            Err(error) => {
                if !self.reinitializing {
                    // Первая ошибка — сигнал о необходимости повторной инициализации.
                    self.reinitializing = true;
                    self.clear_transitions();

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: true,
                    })
                } else {
                    // Уже повторно инициализируемся — повторную ошибку не сигналим.
                    let _ = error;

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: false,
                    })
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Welcome
    // ---------------------------------------------------------------------

    /// Обрабатывает welcome от другого участника.
    ///
    /// Логика аналогична `process_commit`, но применяется к данным
    /// приветственного сообщения.
    ///
    /// # Аргументы
    /// * `payload` — сериализованные данные welcome.
    #[napi(js_name = "processWelcome")]
    pub fn process_welcome(&mut self, payload: Buffer) -> Result<TransitionResult> {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Минимум 2 байта под transition_id.
        if payload.len() < 2 {
            return Err(Error::from_reason(
                "Welcome payload too short",
            ));
        }

        // transition_id в первых двух байтах (BE).
        let transition_id =
            u16::from_be_bytes([
                payload[0],
                payload[1],
            ]);

        // Если сессии нет — вернуть неуспех без повторной инициализации.
        let inner = match self.inner.as_mut() {
            Some(inner) => inner,

            None => {
                return Ok(TransitionResult {
                    transition_id,
                    success: false,
                    invalidated: false,
                });
            }
        };

        match inner.process_welcome(&payload[2..]) {
            Ok(()) => {
                if transition_id != 0 {
                    // Ненулевой id — переход откладывается до execute_transition.
                    self.pending_transitions.insert(
                        transition_id,
                        PendingTransition {
                            version: self.version,
                            expires_at: Instant::now()
                                + TRANSITION_TIMEOUT,
                        },
                    );
                } else {
                    // Нулевой id — переход завершён сразу.
                    self.reinitializing = false;
                    self.last_transition_id =
                        Some(transition_id);
                }

                Ok(TransitionResult {
                    transition_id,
                    success: true,
                    invalidated: false,
                })
            }

            Err(error) => {
                if !self.reinitializing {
                    // Первая ошибка — сигнал о необходимости повторно инициализации.
                    self.reinitializing = true;
                    self.clear_transitions();

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: true,
                    })
                } else {
                    // Уже повторно инициализируемся — повторную ошибку не сигналим.
                    let _ = error;

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: false,
                    })
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Prepare transition
    // ---------------------------------------------------------------------

    /// Регистрирует ожидаемый переход.
    ///
    /// Для `transition_id == 0` переход выполняется немедленно. Для
    /// `protocol_version == 0` включается passthrough с увеличенным сроком
    /// (ожидание подтверждения понижения).
    ///
    /// # Аргументы
    /// * `transition_id` — идентификатор перехода.
    /// * `protocol_version` — целевая версия протокола.
    ///
    /// # Возвращаемое значение
    /// `true`, если переход требует вызова `execute_transition`.
    #[napi(js_name = "prepareTransition")]
    pub fn prepare_transition(&mut self, transition_id: u16, protocol_version: u16) -> bool {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Регистрируем переход с тайм-аутом.
        self.pending_transitions.insert(
            transition_id,
            PendingTransition {
                version: protocol_version,
                expires_at: Instant::now()
                    + TRANSITION_TIMEOUT,
            },
        );

        // transition_id == 0 — немедленный переход.
        if transition_id == 0 {
            let _ = self.execute_transition(0);
        }

        // Переход на версию 0 — включаем passthrough с увеличенным сроком.
        if protocol_version == 0 {
            if let Some(inner) = self.inner.as_mut() {
                inner.set_passthrough_mode(
                    true,
                    Some(
                        TRANSITION_EXPIRY_PENDING_DOWNGRADE,
                    ),
                );
            }
        }

        transition_id != 0
    }

    // ---------------------------------------------------------------------
    // Execute transition
    // ---------------------------------------------------------------------

    /// Выполняет ранее зарегистрированный переход.
    ///
    /// # Аргументы
    /// * `transition_id` — идентификатор перехода.
    ///
    /// # Возвращаемое значение
    /// `true`, если переход выполнен; `false`, если запись отсутствует
    /// или уже выполняется другой переход.
    #[napi(js_name = "executeTransition")]
    pub fn execute_transition(&mut self, transition_id: u16) -> bool {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Защита от reentry.
        if self.is_transitioning { return false; }

        // Переход должен быть зарегистрирован.
        let version = match self.pending_transitions.get(
            &transition_id,
        ) {
            Some(pending) => pending.version,
            None => return false,
        };

        self.is_transitioning = true;
        let old_version = self.version;

        // Применяем новую версию.
        self.version = version;

        // Фиксируем понижение до версии 0.
        if old_version != 0 && self.version == 0 {
            self.downgraded = true;
        }

        // При восстановлении после понижения включаем passthrough.
        if self.downgraded && self.version > 0 {
            if let Some(inner) = self.inner.as_mut() {
                inner.set_passthrough_mode(
                    true,
                    Some(TRANSITION_EXPIRY),
                );
            }

            self.downgraded = false;
        }

        self.last_transition_id = Some(transition_id);

        // Запись о переходе больше не нужна.
        self.pending_transitions.remove(&transition_id);
        self.is_transitioning = false;

        true
    }

    // ---------------------------------------------------------------------
    // Encrypt
    // ---------------------------------------------------------------------

    /// Шифрует массив Opus-пакетов.
    ///
    /// Возвращает `None`, если шифрование невозможно: версия 0, идёт
    /// переход, идёт повторная инициализация, сессия не готова, либо один из
    /// пакетов не удалось зашифровать (batch считается неуспешным целиком).
    ///
    /// # Аргументы
    /// * `packets` — исходные Opus-пакеты.
    ///
    /// # Возвращаемое значение
    /// Вектор зашифрованных пакетов или `None`.
    #[napi]
    pub fn encrypt(&mut self, packets: Vec<Buffer>) -> Option<Vec<Buffer>> {
        // Passthrough-режим или нестабильное состояние — не шифруем.
        if self.version == 0 || self.is_transitioning || self.reinitializing { return None; }

        let inner = self.inner.as_mut()?;

        // Сессия ещё не готова к шифрованию.
        if !inner.is_ready() { return None; }

        let mut output = Vec::with_capacity(packets.len());
        for packet in packets {
            // Нативный encrypt может паниковать — перехватываем.
            let encrypted = std::panic::catch_unwind(
                std::panic::AssertUnwindSafe(
                    || {
                        inner.encrypt(
                            davey::MediaType::AUDIO,
                            davey::Codec::OPUS,
                            packet.as_ref(),
                        )
                    },
                ),
            );

            match encrypted {
                Ok(Ok(buffer)) => {
                    output.push(
                        Buffer::from(
                            buffer.as_ref(),
                        ),
                    );
                }

                // Batch считается неуспешным целиком.
                _ => return None,
            }
        }

        Some(output)
    }
}

impl MlsSession {
    /// Удаляет записи о переходах, срок которых истёк.
    ///
    /// Каждая запись в `pending_transitions` имеет `expires_at`, и если
    /// `execute_transition` не был вызван за `TRANSITION_TIMEOUT`,
    /// запись считается устаревшей и удаляется.
    fn expire_transitions(&mut self) {
        // Одно чтение времени на всю операцию — дешевле, чем в замыкании.
        let now = Instant::now();

        // retain оставляет только те записи, чей срок ещё не истёк.
        self.pending_transitions
            .retain(|_, transition| {
                transition.expires_at > now
            });
    }

    /// Очищает все записи об ожидающих переходах.
    ///
    /// Используется при повторной инициализации (когда прежние переходы
    /// больше не актуальны) и при уничтожении сессии.
    fn clear_transitions(&mut self) {
        self.pending_transitions.clear();
    }

    /// Преобразует ошибку `davey` в napi-ошибку с префиксом `[MlsSession]`.
    ///
    /// Единая точка для прохождения ошибок нативного слоя в JavaScript —
    /// упрощает поиск источника по префиксу в логах.
    #[inline]
    fn map_err<E: std::fmt::Display>(error: E) -> Error {
        Error::from_reason(format!(
            "[MlsSession] {}",
            error
        ))
    }

    /// Парсит строковый идентификатор в `u64`.
    ///
    /// # Аргументы
    /// * `id` — строка с числовым идентификатором.
    /// * `name` — имя поля для понятного сообщения об ошибке
    ///   (например, `"user id"`).
    ///
    /// # Возвращаемое значение
    /// `Ok(u64)` при успешном парсинге.
    ///
    /// # Ошибки
    /// Возвращает ошибку с указанием имени поля, если строка не парсится.
    #[inline]
    fn parse_id(id: &str, name: &str) -> Result<u64> {
        // Пытаемся распарсить строку; при ошибке подставляем имя поля.
        id.parse().map_err(|_| {
            Error::from_reason(format!(
                "Invalid {}: {}",
                name,
                id
            ))
        })
    }

    /// Преобразует числовой код операции в enum `davey`.
    ///
    /// # Аргументы
    /// * `operation` — код операции из payload.
    ///
    /// # Возвращаемое значение
    /// `ProposalsOperationType` для известного кода.
    ///
    /// # Ошибки
    /// Возвращает ошибку для неизвестных значений.
    fn map_operation(operation: u8) -> Result<davey::ProposalsOperationType> {
        match operation {
            // Код 0 → APPEND.
            0 => Ok(
                davey::ProposalsOperationType::APPEND,
            ),

            // Код 1 → APPEND. Соответствует текущему протоколу —
            // другие типы операций пока не используются.
            1 => Ok(
                davey::ProposalsOperationType::APPEND,
            ),

            // Любой другой код — ошибка.
            _ => Err(Error::from_reason(format!(
                "Invalid operation: {operation}"
            ))),
        }
    }
}

/// Сброс нативной сессии при уничтожении обёртки.
impl Drop for MlsSession {
    fn drop(&mut self) {
        // Пытаемся корректно завершить сессию, ошибки игнорируем.
        if let Some(inner) = self.inner.as_mut() {
            let _ = inner.reset();
        }
    }
}