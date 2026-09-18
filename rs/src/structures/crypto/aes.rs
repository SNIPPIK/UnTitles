use crate::structures::timers::scheduler::TICK_INTERVAL_MS;
use std::{
    sync::{
        atomic::{AtomicU16, AtomicU32, Ordering},
        RwLock,
    },
    fmt,
};
use aes_gcm::{
    aead::{KeyInit, AeadInOut, inout::InOutBuf},
    Aes256Gcm, Nonce
};
use rand::{
    RngExt,
    rng
};

/// Размер RTP-заголовка без расширений (байт).
///
/// Базовая часть: version/P/X/CC (1 байт) + M/PT (1 байт) +
/// sequence (2 байта) + timestamp (4 байта) + SSRC (4 байта) = 12.
const RTP_HEADER_SIZE: usize = 12;

/// Размер тега аутентификации AES-GCM (байт).
///
/// Добавляется к каждому зашифрованному пакету и проверяется при расшифровке.
const GCM_TAG_SIZE: usize = 16;

/// Допустимая длина ключа AES-256 (байт).
///
/// Для режима AES-256-GCM требуется ровно 32 байта.
const KEY_SIZE: usize = 32;

/// Смещение поля sequence в RTP-заголовке.
const RTP_SEQUENCE_OFFSET: usize = 2;

/// Смещение поля timestamp в RTP-заголовке.
const RTP_TIMESTAMP_OFFSET: usize = 4;

/// Смещение поля SSRC в RTP-заголовке.
const RTP_SSRC_OFFSET: usize = 8;

/// Полный размер nonce для AES-GCM (байт).
///
/// AES-GCM всегда использует 12-байтовый nonce.
const NONCE_SIZE: usize = 12;

/// Размер значащей части nonce (байт).
///
/// В Discord используется счётчик в первых 4 байтах nonce,
/// остальные 8 байт остаются нулями.
const NONCE_COUNTER_SIZE: usize = 4;

/// Значение первого байта RTP-заголовка: Version = 2.
///
/// `0x80` = `10` в старших двух битах (версия 2) + нулевые P/X/CC.
const RTP_VERSION: u8 = 0x80;

/// Payload Type для Opus в RTP.
///
/// Значение 120 — динамический тип нагрузки, используемый Discord Voice.
const RTP_PAYLOAD_TYPE_OPUS: u8 = 120;

/// Приращение временной метки RTP для одного пакета.
///
/// Для Opus с частотой дискретизации 48 кГц и кадрами по 20 мс получаем 960 семплов.
/// `TICK_INTERVAL_MS` — интервал цикла отправки (20 мс).
const TIMESTAMP_INC: u32 = 48000 * TICK_INTERVAL_MS / 1000;

// ============================================================================
// Ошибки криптографических операций
// ============================================================================

/// Типы ошибок, специфичные для криптографических операций.
#[derive(Debug)]
pub enum CryptoError {
    /// Ключ шифрования имеет неверную длину (должен быть 32 байта для AES-256).
    InvalidKeyLength(usize),

    /// Ошибка при шифровании (проблема с nonce, AAD или внутренняя ошибка AES-GCM).
    EncryptionFailed(String),

    /// Сокет ещё не создан - (ssrc/key не заданы).
    NotInitialized,
}

/// Реализация `Display` для преобразования ошибки в строку.
impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CryptoError::InvalidKeyLength(len) => write!(f, "Invalid key length: {}", len),
            CryptoError::EncryptionFailed(msg) => write!(f, "Encryption failed: {}", msg),
            CryptoError::NotInitialized => write!(f, "VoiceRTPSocket is not initialized"),
        }
    }
}

/// Реализация `Error` для совместимости со стандартным трейтом.
impl std::error::Error for CryptoError {}
// ============================================================================
// Внутренние параметры шифрования
// ============================================================================

/// Внутреннее состояние шифра: появляется после `initialize`.
struct EncryptorState {
    /// 32-битный идентификатор источника синхронизации.
    ssrc: u32,

    /// Экземпляр шифра AES-256-GCM.
    cipher: Aes256Gcm,
}

// ============================================================================
// VoiceRTPSocket
// ============================================================================

/// Объект RTP-сокета для голоса.
/// Выполняет шифрование аудио фреймов (Opus) в соответствии с требованиями Discord.
///
/// Создаётся пустым через [`new`], `ssrc` и ключ задается позже через [`initialize`].
/// Это позволяет поднять сокет до получения голосового ключа от Discord
///
/// # Атомарные счётчики
/// - `sequence` – 16-битный счётчик RTP-пакетов (оборачивается).
/// - `timestamp` – 32-битная метка времени, увеличивается на `TIMESTAMP_INC` для каждого пакета.
/// - `counter` – 32-битный счётчик nonce (используется как первые 4 байта 12-байтового nonce).
///
/// # Потокобезопасность
/// Все публичные методы принимают `&self`. Состояние шифра защищено `RwLock`.
/// `initialize` и `destroy` берут write-lock, `packet`/`packets` — read-lock.
pub struct VoiceRTPSocket {
    /// Состояние шифра; `None`, пока не вызван `initialize`.
    state: RwLock<Option<EncryptorState>>,

    /// Порядковый номер RTP-пакета (16 бит, автоматически оборачивается).
    sequence: AtomicU16,

    /// Временная метка RTP (32 бит, увеличивается с каждым пакетом).
    timestamp: AtomicU32,

    /// Счётчик nonce (32 бит, инкрементируется после каждого использования).
    counter: AtomicU32,
}

impl VoiceRTPSocket {
    /// Создаёт неинициализированный RTP-сокет.
    ///
    /// SSRC и ключ шифрования задаются отдельно через [`initialize`].
    /// Начальные значения sequence, timestamp и nonce counter
    /// рандомизируются для избежания предсказуемого старта сессии.
    ///
    /// # Возвращаемое значение
    /// Новый `VoiceRTPSocket` в состоянии «не инициализирован».
    pub fn new() -> Self {
        // Генератор случайных чисел для начальных значений счётчиков.
        let mut rng = rng();

        Self {
            // Состояние шифрования отсутствует до вызова initialize().
            state: RwLock::new(None),

            // Случайное начальное значение RTP sequence (16 бит).
            sequence: AtomicU16::new(rng.random()),

            // Случайное начальное значение RTP timestamp (32 бита).
            timestamp: AtomicU32::new(rng.random()),

            // Случайное начальное значение nonce counter (32 бита).
            counter: AtomicU32::new(rng.random())
        }
    }

    /// Инициализирует RTP-сокет.
    ///
    /// # Аргументы
    /// * `ssrc` — 32-битный идентификатор источника синхронизации.
    /// * `key` — 32-байтный ключ AES-256-GCM.
    ///
    /// При каждой инициализации RTP-счётчики получают новые
    /// случайные начальные значения — это защищает от повторного
    /// использования nonce при реконнекте.
    ///
    /// # Возвращаемое значение
    /// `Ok(())` при успешной инициализации.
    ///
    /// # Ошибки
    /// * `InvalidKeyLength` — ключ имеет неверную длину.
    /// * `EncryptionFailed` — не удалось создать AES-GCM cipher.
    pub fn initialize(&self, ssrc: u32, key: Vec<u8>) -> Result<(), CryptoError> {
        // Проверяем длину ключа — AES-256 требует ровно 32 байта.
        if key.len() != KEY_SIZE {
            return Err(CryptoError::InvalidKeyLength(key.len()));
        }

        // Копируем ключ в массив фиксированной длины.
        let mut key_array = [0u8; KEY_SIZE];
        key_array.copy_from_slice(&key);

        // Создаём шифр AES-256-GCM из ключа.
        let cipher = Aes256Gcm::new_from_slice(&key_array)
            .map_err(|_| {
                CryptoError::EncryptionFailed("invalid AES-256 key".into())
            })?;

        // Готовим генератор случайных чисел для сброса счётчиков.
        let mut rng = rng();

        // Счётчики не участвуют в синхронизации памяти между потоками,
        // достаточно Relaxed.
        self.sequence.store(rng.random(), Ordering::Relaxed);
        self.timestamp.store(rng.random(), Ordering::Relaxed);
        self.counter.store(rng.random(), Ordering::Relaxed);

        // Публикуем новое состояние только после успешного
        // создания cipher и сброса всех счётчиков.
        *self.state.write().expect("RTP state lock poisoned") =
            Some(EncryptorState { ssrc, cipher });

        Ok(())
    }

    /// Проверяет, инициализирован ли RTP-сокет.
    ///
    /// # Возвращаемое значение
    /// `true`, если `initialize` уже был вызван и состояние шифра присутствует.
    #[inline]
    pub fn is_initialized(&self) -> bool {
        // Читаем состояние под read-lock, обрабатывая отравление мьютекса.
        self.state
            .read()
            .expect("RTP state lock poisoned")
            .is_some()
    }

    /// Шифрует один Opus-фрейм и возвращает полный RTP-пакет.
    ///
    /// Формат результата:
    ///
    /// ```text
    /// [RTP header][encrypted payload][GCM tag][nonce suffix]
    /// ```
    ///
    /// # Аргументы
    /// * `frame` — байтовый срез с Opus-данными.
    ///
    /// # Возвращаемое значение
    /// `Vec<u8>` с готовым RTP-пакетом.
    ///
    /// # Ошибки
    /// * `NotInitialized` — сокет ещё не инициализирован.
    /// * `EncryptionFailed` — ошибка AES-GCM.
    #[inline]
    pub fn packet(&self, frame: &[u8]) -> Result<Vec<u8>, CryptoError> {
        // Вся логика — в create_packet_raw.
        self.create_packet_raw(frame)
    }

    /// Генерирует 12-байтовый nonce для AES-GCM.
    ///
    /// Используется 32-битный счётчик в big-endian формате,
    /// остальные байты nonce заполняются нулями.
    ///
    /// # Возвращаемое значение
    /// Массив из `NONCE_SIZE` байт.
    #[inline]
    fn generate_nonce(&self) -> [u8; NONCE_SIZE] {
        // Relaxed достаточно: счётчик нужен только для получения
        // уникального значения nonce, а не для публикации памяти.
        let counter = self.counter.fetch_add(1, Ordering::Relaxed);

        // Готовим массив из 12 байт, заполненный нулями.
        let mut nonce = [0u8; NONCE_SIZE];

        // Копируем первые 4 байта счётчика в big-endian.
        nonce[..NONCE_COUNTER_SIZE]
            .copy_from_slice(&counter.to_be_bytes());

        nonce
    }

    /// Формирует и шифрует полный RTP-пакет.
    ///
    /// # Аргументы
    /// * `frame` — незашифрованный Opus-фрейм.
    ///
    /// # Возвращаемое значение
    /// Готовый к отправке RTP-пакет.
    ///
    /// # Ошибки
    /// * `NotInitialized` — сокет не инициализирован.
    /// * `EncryptionFailed` — ошибка AES-GCM.
    #[inline]
    fn create_packet_raw(&self, frame: &[u8]) -> Result<Vec<u8>, CryptoError> {
        // Держим read-lock на всё время шифрования.
        let guard = self.state.read().expect("RTP state lock poisoned");

        // Если состояние отсутствует — сокет не инициализирован.
        let state = guard
            .as_ref()
            .ok_or(CryptoError::NotInitialized)?;

        // Формируем RTP-заголовок (обновляет sequence и timestamp).
        let header = self.build_header(state.ssrc);

        // Генерируем nonce (инкрементирует counter).
        let nonce_bytes = self.generate_nonce();
        let nonce = Nonce::from(nonce_bytes);

        // Выделяем память под весь пакет заранее.
        let mut packet = Vec::with_capacity(
            RTP_HEADER_SIZE
                + frame.len()
                + GCM_TAG_SIZE
                + NONCE_COUNTER_SIZE,
        );

        // RTP header остаётся открытым и используется как AAD.
        packet.extend_from_slice(&header);

        // Добавляем исходный Opus payload.
        packet.extend_from_slice(frame);

        // Шифруем payload непосредственно внутри итогового буфера.
        let payload = &mut packet[RTP_HEADER_SIZE..];

        let tag = state
            .cipher
            .encrypt_inout_detached(
                &nonce,
                &header,
                InOutBuf::from(payload),
            )
            .map_err(|error| {
                CryptoError::EncryptionFailed(error.to_string())
            })?;

        // GCM authentication tag.
        packet.extend_from_slice(tag.as_slice());

        // Discord voice packet mode использует 4-байтовый
        // nonce suffix в конце пакета.
        packet.extend_from_slice(
            &nonce_bytes[..NONCE_COUNTER_SIZE],
        );

        Ok(packet)
    }

    /// Формирует 12-байтовый RTP-заголовок.
    ///
    /// Формат:
    ///
    /// ```text
    /// [0]      Version = 2
    /// [1]      Payload Type = 120
    /// [2..4]  Sequence
    /// [4..8]  Timestamp
    /// [8..12] SSRC
    /// ```
    ///
    /// # Аргументы
    /// * `ssrc` — идентификатор источника синхронизации.
    ///
    /// # Возвращаемое значение
    /// Массив из 12 байт — готовый RTP-заголовок.
    #[inline]
    fn build_header(&self, ssrc: u32) -> [u8; RTP_HEADER_SIZE] {
        // Инициализируем заголовок нулями.
        let mut header = [0u8; RTP_HEADER_SIZE];

        // Байт 0: Version = 2.
        header[0] = RTP_VERSION;
        // Байт 1: Payload Type = 120 (Opus).
        header[1] = RTP_PAYLOAD_TYPE_OPUS;

        // Атомарно получаем sequence и увеличиваем на 1.
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);

        // Атомарно получаем timestamp и увеличиваем на TIMESTAMP_INC.
        let timestamp = self
            .timestamp
            .fetch_add(TIMESTAMP_INC, Ordering::Relaxed);

        // Записываем sequence в big-endian (2 байта).
        header[RTP_SEQUENCE_OFFSET..RTP_SEQUENCE_OFFSET + 2]
            .copy_from_slice(&sequence.to_be_bytes());

        // Записываем timestamp в big-endian (4 байта).
        header[RTP_TIMESTAMP_OFFSET..RTP_TIMESTAMP_OFFSET + 4]
            .copy_from_slice(&timestamp.to_be_bytes());

        // Записываем SSRC (4 байта).
        header[RTP_SSRC_OFFSET..RTP_SSRC_OFFSET + 4]
            .copy_from_slice(&ssrc.to_be_bytes());

        header
    }

    /// Сбрасывает состояние шифрования и счётчики.
    ///
    /// После вызова требуется повторный [`initialize`].
    /// Повторный вызов безопасен.
    #[inline]
    pub fn destroy(&self) {
        // Обнуляем состояние шифра под write-lock.
        *self.state.write().expect("RTP state lock poisoned") = None;

        // Сбрасываем все счётчики в ноль.
        self.sequence.store(0, Ordering::Relaxed);
        self.timestamp.store(0, Ordering::Relaxed);
        self.counter.store(0, Ordering::Relaxed);
    }
}

/// `VoiceRTPSocket` можно создавать без аргументов.
impl Default for VoiceRTPSocket {
    fn default() -> Self {
        Self::new()
    }
}

/// Деструктор: сбрасывает состояние шифра и счётчики.
///
/// В отладочной сборке выводит сообщение о вызове.
impl Drop for VoiceRTPSocket {
    fn drop(&mut self) {
        // На drop `RwLock` можно писать напрямую без `expect`.
        if let Ok(mut guard) = self.state.write() {
            *guard = None;
        }

        // Сбрасываем счётчики.
        self.sequence.store(0, Ordering::Relaxed);
        self.timestamp.store(0, Ordering::Relaxed);
        self.counter.store(0, Ordering::Relaxed);

        // Отладочный вывод.
        #[cfg(debug_assertions)]
        println!("VoiceRTPSocket::drop");
    }
}