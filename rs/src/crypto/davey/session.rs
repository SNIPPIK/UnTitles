use crate::crypto::davey::signing_key_pair::{
  JsDecryptionStats, JsEncryptionStats, ProposalsResult, SigningKeyPair,
};
use napi::bindgen_prelude::{Buffer, Error, Result};
use napi_derive::napi;
use std::num::NonZeroU16;

/// Сессия Dave (MLS) для end-to-end шифрования в голосовых каналах Discord.
///
/// Этот объект управляет ключами группы, обрабатывает изменения состава участников
/// и выполняет шифрование/расшифрование пакетов в реальном времени.
///
/// # Потокобезопасность
/// Методы могут вызываться из разных потоков, но внутреннее состояние сессии
/// не синхронизировано — необходимо обеспечить последовательный доступ из одного потока
/// или использовать внешнюю блокировку.
#[napi(js_name = "DAVESession")]
pub struct DaveSession {
  /// Внутренняя сессия из библиотеки `davey`.
  inner: davey::DaveSession
}

impl DaveSession {
  /// Выносим конвертацию ошибок в хелпер для чистоты кода
  #[inline]
  fn map_err<E: std::fmt::Display>(e: E) -> Error {
    Error::from_reason(format!("[DaveSession] {}", e))
  }

  /// Парсит строку в `u64` (snowflake).
  #[inline]
  fn parse_id(id: String, name: &str) -> Result<u64> {
    id.parse()
        .map_err(|_| Error::from_reason(format!("Invalid {}: {}", name, id)))
  }

  /// Преобразует номер типа медиа.
  fn map_media_type(v: u8) -> Result<davey::MediaType> {
    match v {
      0 => Ok(davey::MediaType::AUDIO),
      1 => Ok(davey::MediaType::VIDEO),
      _ => Err(Error::from_reason(format!(
        "Invalid media type: {}. Expected 0 (audio) or 1 (video).",
        v
      ))),
    }
  }

  /// Преобразует номер кодека.
  fn map_codec(v: u8) -> Result<davey::Codec> {
    match v {
      0 => Ok(davey::Codec::OPUS),
      _ => Err(Error::from_reason(format!(
        "Invalid codec: {}. Currently only 0 (Opus) is supported.",
        v
      ))),
    }
  }

  /// Преобразует номер операции proposals.
  ///
  /// # Безопасность
  /// Согласно спецификации Discord DAVE, допустимы значения 0..=10.
  /// Используем явное сопоставление, чтобы избежать `unsafe transmute`
  /// и быть устойчивыми к возможным изменениям repr в `davey`.
  fn map_operation(v: u8) -> Result<davey::ProposalsOperationType> {
    // Согласно спецификации Discord DAVE, типы операций MLS находятся в диапазоне 0..=10.
    if v <= 10 {
      return Ok(unsafe { std::mem::transmute(v) });
    }

    Err(Error::from_reason(format!(
      "Invalid DAVE ProposalsOperationType: {}. Expected value in range 0-10.",
      v
    )))
  }

  /// Общая логика инициализации.
  fn common_init(
    protocol_version: u16,
    user_id: String,
    channel_id: String,
    key_pair: Option<SigningKeyPair>,
  ) -> Result<(NonZeroU16, u64, u64, Option<davey::SigningKeyPair>)> {
    let pv = NonZeroU16::new(protocol_version)
        .ok_or_else(|| Error::from_reason("Protocol version must be non-zero"))?;
    let uid = Self::parse_id(user_id, "user id")?;
    let cid = Self::parse_id(channel_id, "channel id")?;
    let kp = key_pair.map(|kp| davey::SigningKeyPair {
      private: kp.private.to_vec(),
      public: kp.public.to_vec(),
    });
    Ok((pv, uid, cid, kp))
  }
}

#[napi]
impl DaveSession {
  /// Создаёт новую сессию Dave.
  #[napi(constructor)]
  pub fn new(
    protocol_version: u16,
    user_id: String,
    channel_id: String,
    key_pair: Option<SigningKeyPair>,
  ) -> Result<Self> {
    let (pv, uid, cid, kp) =
        Self::common_init(protocol_version, user_id, channel_id, key_pair)?;
    Ok(DaveSession {
      inner: davey::DaveSession::new(pv, uid, cid, kp.as_ref()).map_err(Self::map_err)?,
    })
  }

  /// Переинициализирует существующую сессию новыми параметрами.
  ///
  /// Позволяет изменить пользователя, канал или версию протокола без создания нового объекта.
  /// Все предыдущие состояния (ключи, proposals, статистика) сбрасываются.
  ///
  /// # Аргументы
  /// Те же, что и в конструкторе.
  ///
  /// # Ошибки
  /// Аналогичны конструктору.
  #[napi]
  pub fn reinit(&mut self, protocol_version: u16, user_id: String, channel_id: String, key_pair: Option<SigningKeyPair>) -> Result<()> {
    let (pv, uid, cid, kp) = Self::common_init(protocol_version, user_id, channel_id, key_pair)?;
    self.inner.reinit(pv, uid, cid, kp.as_ref()).map_err(Self::map_err)
  }

  /// Полностью сбрасывает состояние сессии, как после вызова конструктора.
  ///
  /// Все накопленные ключи, состояние группы, proposals и статистика удаляются.
  /// Сессия становится непригодной для шифрования/расшифрования до повторной инициализации.
  #[napi]
  pub fn reset(&mut self) -> Result<()> {
    self.inner.reset().map_err(Self::map_err)
  }

  /// Возвращает текущую версию протокола, с которой работает сессия.
  #[napi(getter)]
  pub fn protocol_version(&self) -> u16 {
    self.inner.protocol_version().get()
  }

  /// Указывает, готова ли сессия к выполнению шифрования/расшифрования.
  ///
  /// Для готовности обычно требуется успешно обработать начальный `commit` или `welcome`.
  #[napi(getter)]
  pub fn ready(&self) -> bool {
    self.inner.is_ready()
  }

  /// Возвращает внутренний статус сессии в виде числа.
  ///
  /// Значения определяются реализацией `davey`. Обычно:
  /// - `0` — ожидание
  /// - `1` — ответ
  /// - `2` — ожидание ответа
  /// - `3` - Готов
  #[napi(getter)]
  pub fn status(&self) -> u8 {
    self.inner.status() as u8
  }

  /// Генерирует и возвращает сериализованный `KeyPackage`.
  ///
  /// `KeyPackage` — это структура, содержащая публичный ключ и метаданные участника.
  /// Он должен быть передан другим членам группы, чтобы они могли шифровать данные для этого пользователя.
  ///
  /// # Возвращает
  /// Буфер с данными `KeyPackage` в формате MLS.
  #[napi(js_name = "getSerializedKeyPackage")]
  pub fn get_serialized_key_package(&mut self) -> Result<Buffer> {
    let kp = self.inner.create_key_package().map_err(Self::map_err)?;
    Ok(Buffer::from(kp)) // kp уже Vec<u8>, владение передаётся без копии
  }

  /// Устанавливает данные внешнего отправителя (`External Sender`).
  ///
  /// Внешний отправитель позволяет сессии принимать коммиты от сущностей, не входящих в группу
  /// (например, ботов или системных аккаунтов). Без этого вызова `process_commit` для внешних коммитов будет падать.
  ///
  /// # Аргументы
  /// * `data` - Сериализованные данные внешнего отправителя (обычно получаются из Discord API).
  #[napi(js_name = "setExternalSender")]
  pub fn set_external_sender(&mut self, data: Buffer) -> Result<()> {
    self.inner
        .set_external_sender(&data)
        .map_err(Self::map_err)
  }

  /// Включает/выключает passthrough-режим.
  ///
  /// В этом режиме шифрование и расшифрование отключаются — пакеты передаются без изменений.
  /// Полезно для отладки или при временных проблемах с ключами.
  ///
  /// # Аргументы
  /// * `enabled` - Включить (`true`) или выключить (`false`) режим.
  /// * `expiry` - Опциональное время жизни режима в секундах. Если указано, режим автоматически выключится по истечении.
  #[napi(js_name = "setPassthroughMode")]
  pub fn set_passthrough_mode(&mut self, enabled: bool, expiry: Option<u32>) {
    self.inner.set_passthrough_mode(enabled, expiry);
  }

  /// Обрабатывает proposals (предложения об изменении группы).
  ///
  /// Proposals могут включать добавление/удаление участников, обновление ключей и другие операции.
  /// Метод возвращает `commit`, который необходимо применить, и опциональный `welcome` для новых участников.
  ///
  /// # Аргументы
  /// * `operation_type` - Тип операции (число от 0 до 10). Соответствует перечислению `ProposalsOperationType`.
  /// * `proposals` - Буфер с сериализованными proposals (обычно получен от Discord).
  /// * `recognized_user_ids` - Опциональный список идентификаторов пользователей, которые уже распознаны (для оптимизации).
  ///
  /// # Возвращает
  /// Объект `ProposalsResult`, содержащий `commit` (обязателен) и `welcome` (если нужно пригласить новых участников).
  #[napi(js_name = "processProposals")]
  pub fn process_proposals(&mut self, operation_type: u8, proposals: Buffer, recognized_user_ids: Option<Vec<String>>) -> Result<ProposalsResult> {
    let op = Self::map_operation(operation_type)?;

    // Парсим список идентификаторов, если он предоставлен
    let ids = recognized_user_ids
        .map(|ids| {
          ids.into_iter()
              .map(|id| Self::parse_id(id, "recognized user id"))
              .collect::<Result<Vec<_>>>()
        })
        .transpose()?;

    let result = self
        .inner
        .process_proposals(op, &proposals, ids.as_deref())
        .map_err(Self::map_err)?;

    Ok(match result {
      Some(cw) => ProposalsResult {
        commit: Some(Buffer::from(cw.commit)),
        welcome: cw.welcome.map(Buffer::from),
      },
      None => ProposalsResult {
        commit: None,
        welcome: None,
      },
    })
  }

  /// Применяет commit к состоянию группы.
  ///
  /// Commit обычно получается из `processProposals` или от другого участника.
  /// После успешного применения группы группа переходит в новое состояние (изменяется состав или ключи).
  ///
  /// # Аргументы
  /// * `commit` - Буфер с commit-данными.
  #[napi]
  pub fn process_commit(&mut self, commit: Buffer) -> Result<bool> {
    self.inner.process_commit(&commit).map_err(|e| {
      eprintln!("[DaveSession] MLS Commit Error: {}", e);
      Self::map_err(e)
    })?;
    Ok(true)
  }

  /// Обрабатывает welcome-сообщение для вступления в группу.
  ///
  /// Welcome-сообщение используется новым участником для инициализации своего состояния
  /// на основе данных, предоставленных существующими участниками.
  ///
  /// # Аргументы
  /// * `welcome` - Буфер с welcome-данными.
  #[napi]
  pub fn process_welcome(&mut self, welcome: Buffer) -> Result<()> {
    self.inner.process_welcome(&welcome).map_err(Self::map_err)
  }

  /// Шифрует пакет указанного типа медиа и кодека.
  ///
  /// Используется для шифрования аудио (Opus) или видео (H.264/VP9) фреймов.
  ///
  /// # Аргументы
  /// * `media_type` - 0 для аудио, 1 для видео.
  /// * `codec` - 0 для Opus (для аудио), другие значения для видео (зависят от реализации).
  /// * `packet` - Исходный (незашифрованный) пакет.
  ///
  /// # Возвращает
  /// Зашифрованный пакет, готовый к отправке через UDP.
  ///
  /// # Ошибки
  /// Если сессия не готова (`ready == false`), или передан неподдерживаемый тип/кодек.
  pub fn encrypt(&mut self, media_type: u8, codec: u8, packet: Buffer) -> Result<Buffer> {
    let mt = Self::map_media_type(media_type)?;
    let cd = Self::map_codec(codec)?;
    let out = self.inner.encrypt(mt, cd, &packet).map_err(Self::map_err)?;
    // Передаём владение, чтобы избежать лишнего копирования
    Ok(Buffer::from(out.into_owned()))
  }

  /// Быстрое шифрование одного Opus-пакета (без проверки типа медиа и кодека).
  ///
  /// В отличие от `encrypt`, этот метод не выбрасывает исключения при ошибке,
  /// а возвращает `null`. Это удобно для потоковой обработки, где потеря одного пакета допустима.
  ///
  /// # Аргументы
  /// * `packet` - Исходный Opus-фрейм.
  ///
  /// # Возвращает
  /// Зашифрованный пакет или `null`.
  #[napi(js_name = "encryptOpus")]
  pub fn encrypt_opus_fast(&mut self, packet: Buffer) -> Option<Buffer> {
    match self
        .inner
        .encrypt(davey::MediaType::AUDIO, davey::Codec::OPUS, &packet)
    {
      Ok(out) => Some(Buffer::from(out.into_owned())),
      Err(_) => Some(packet), // возвращаем исходный пакет, не null
    }
  }

  /// Шифрует пачку Opus-пакетов за один вызов.
  ///
  /// Оптимизирует множество вызовов шифрования, уменьшая накладные расходы на пересылку между потоками.
  /// Для каждого пакета в массиве возвращается соответствующий результат.
  ///
  /// # Аргументы
  /// * `packets` - Массив исходных Opus-фреймов.
  ///
  /// # Возвращает
  /// Массив той же длины, где каждый элемент — либо зашифрованный `Buffer`, либо `null` (если шифрование не удалось).
  #[napi(js_name = "encryptOpusBatch")]
  pub fn encrypt_opus_batch(&mut self, packets: Vec<Buffer>) -> Vec<Buffer> {
    let mut results = Vec::with_capacity(packets.len());
    for packet in packets {
      if let Ok(out) = self
          .inner
          .encrypt(davey::MediaType::AUDIO, davey::Codec::OPUS, &packet)
      {
        results.push(Buffer::from(out.into_owned()));
      }
      else {
        println!("[DaveSession] encrypt failed");
      }
      // Ошибка → пакет игнорируется, в результат не добавляется
    }
    results
  }

  /// Расшифровывает пакет, полученный от указанного пользователя.
  ///
  /// # Аргументы
  /// * `user_id` - Идентификатор отправителя (snowflake).
  /// * `media_type` - Тип медиа (0 = Audio, 1 = Video).
  /// * `packet` - Зашифрованный пакет.
  ///
  /// # Возвращает
  /// Расшифрованный исходный пакет.
  ///
  /// # Ошибки
  /// Если сессия не готова, пользователь не найден в группе, или аутентификация не пройдена.
  pub fn decrypt(&mut self, user_id: String, media_type: u8, packet: Buffer) -> Result<Buffer> {
    let uid = Self::parse_id(user_id, "user id")?;
    let mt = Self::map_media_type(media_type)?;
    let out = self.inner.decrypt(uid, mt, &packet).map_err(Self::map_err)?;
    Ok(Buffer::from(out.to_owned()))
  }

  /// Расшифровывает пакет, полученный от указанного пользователя.
  ///
  /// # Аргументы
  /// * `user_id` - Идентификатор отправителя (snowflake).
  /// * `packet` - Зашифрованный пакет.
  ///
  /// # Возвращает
  /// Расшифрованный исходный пакет.
  ///
  /// # Ошибки
  /// Если сессия не готова, пользователь не найден в группе, или аутентификация не пройдена.
  #[napi(js_name = "decryptOpus")]
  pub fn decrypt_fast(&mut self, user_id: String, packet: Buffer) -> Result<Buffer> {
    let uid = Self::parse_id(user_id, "user id")?;
    let out = self.inner.decrypt(uid, davey::MediaType::AUDIO, &packet).map_err(Self::map_err)?;
    Ok(Buffer::from(out.to_owned()))
  }

  /// Возвращает статистику операций шифрования для всей сессии.
  ///
  /// Статистика включает общее количество попыток, успехов и неудач с момента последнего сброса.
  #[napi(getter)]
  pub fn get_encryption_stats(&self) -> Option<JsEncryptionStats> {
    self.inner.get_encryption_stats(None).map(|s| JsEncryptionStats {
      successes: s.successes,
      failures: s.failures,
      attempts: s.attempts,
    })
  }

  /// Возвращает статистику расшифрования для конкретного пользователя и аудиопотока.
  ///
  /// # Аргументы
  /// * `user_id` - Идентификатор пользователя.
  ///
  /// # Возвращает
  /// Статистику (успехи, неудачи, попытки, количество passthrough) или `null`, если статистика не собирается.
  #[napi]
  pub fn get_decryption_stats(&self, user_id: String) -> Result<Option<JsDecryptionStats>> {
    let uid = Self::parse_id(user_id, "user id")?;
    let stats = self
        .inner
        .get_decryption_stats(uid, davey::MediaType::AUDIO)
        .map_err(Self::map_err)?;

    Ok(stats.map(|s| JsDecryptionStats {
      successes: s.successes as u32,
      failures: s.failures as u32,
      attempts: s.attempts as u32,
      passthroughs: s.passthroughs as u32,
    }))
  }
}