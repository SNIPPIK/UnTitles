use crate::structures::timers::scheduler::cycle_manager::TICK_INTERVAL_MS;
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
const RTP_HEADER_SIZE: usize = 12;

/// Размер тега аутентификации AES-GCM (байт).
const GCM_TAG_SIZE: usize = 16;

/// Размер добавляемого суффикса nonce в конце пакета (байт).
/// В Discord используются младшие 4 байта nonce, старшие 8 — нули.
const NONCE_SUFFIX_SIZE: usize = 4;

/// Допустимая длина ключа AES-256 (байт).
const KEY_SIZE: usize = 32;

/// Приращение временной метки RTP для одного пакета.
/// Для Opus с частотой дискретизации 48 кГц и кадрами по 20 мс получаем 960 семплов.
/// TICK_INTERVAL_MS — интервал цикла отправки (20 мс).
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
    /// Создаёт неинициализированный сокет.
    ///
    /// `ssrc` и ключ задаются отдельно через [`initialize`].
    /// Счётчики sequence/timestamp/counter рандомизируются сразу —
    /// по требованиям Discord они не должны начинаться с нуля.
    ///
    /// # Возвращаемое значение
    /// Новый экземпляр `VoiceRTPSocket` в состоянии «не инициализирован».
    pub fn new() -> Self {
        // Инициализируем генератор случайных чисел для рандомизации счётчиков.
        let mut rng = rng();

        Self {
            // Изначально состояние шифра отсутствует.
            state: RwLock::new(None),
            // Случайный начальный sequence, чтобы избежать предсказуемости.
            sequence: AtomicU16::new(rng.random()),
            // Случайный начальный timestamp.
            timestamp: AtomicU32::new(rng.random()),
            // Случайный начальный счётчик nonce.
            counter: AtomicU32::new(rng.random()),
        }
    }

    /// Инициализирует сокет.
    ///
    /// # Аргументы
    /// * `ssrc` — 32-битный идентификатор источника синхронизации.
    /// * `key` — 32-байтный ключ AES-256-GCM.
    ///
    /// # Возвращаемое значение
    /// `Ok(())` при успешной инициализации.
    ///
    /// # Ошибки
    /// - `InvalidKeyLength` — ключ не 32 байта.
    /// - `EncryptionFailed` — ключ невалиден (не прошёл проверку AES-GCM).
    pub fn initialize(&self, ssrc: u32, key: Vec<u8>) -> Result<(), CryptoError> {
        // Проверка длины ключа: для AES-256 требуется ровно 32 байта.
        if key.len() != KEY_SIZE {
            return Err(CryptoError::InvalidKeyLength(key.len()));
        }

        // Копируем ключ в массив фиксированной длины.
        let mut key_array = [0u8; KEY_SIZE];
        key_array.copy_from_slice(key.as_ref());

        // Создаём шифр из ключа. Ошибка возможна при некорректном ключе.
        let cipher = Aes256Gcm::new_from_slice(&key_array)
            .map_err(|_| CryptoError::EncryptionFailed("invalid key".into()))?;

        // Задаем все счётчики перед созданием нового состояния.
        let mut rng = rng();
        self.sequence.store(rng.random(), Ordering::Relaxed);
        self.timestamp.store(rng.random(), Ordering::Relaxed);
        self.counter.store(rng.random(), Ordering::Relaxed);

        // Заменяем состояние шифра под write-lock.
        *self.state.write().expect("RTP state lock poisoned") =
            Some(EncryptorState { ssrc, cipher });

        Ok(())
    }

    /// Проверяет, готов ли сокет принимать фреймы.
    #[inline]
    pub fn is_initialized(&self) -> bool {
        self.state.read().expect("RTP state lock poisoned").is_some()
    }

    /// Шифрует один Opus-фрейм и возвращает полный RTP-пакет.
    ///
    /// # Аргументы
    /// * `frame` — буфер с Opus-данными.
    ///
    /// # Возвращаемое значение
    /// Готовый зашифрованный RTP-пакет.
    ///
    /// # Ошибки
    /// Возвращает ошибку, если сокет не инициализирован или шифрование провалилось.
    #[inline]
    pub fn packet(&self, frame: Vec<u8>) -> Result<Vec<u8>, CryptoError> {
        self.create_packet_raw(frame)
    }

    /// Генерирует 12-байтовый nonce.
    ///
    /// В Discord используются только первые 4 байта (счётчик в big-endian),
    /// остальные 8 — нули. Счётчик инкрементируется атомарно.
    ///
    /// # Возвращаемое значение
    /// Массив из 12 байт.
    #[inline]
    fn generate_nonce(&self) -> [u8; RTP_HEADER_SIZE] {
        // Атомарно инкрементируем счётчик и получаем предыдущее значение.
        let counter = self.counter.fetch_add(1, Ordering::Acquire);

        // Готовим массив из 12 байт, заполненный нулями.
        let mut nonce = [0u8; RTP_HEADER_SIZE];

        // Копируем первые 4 байта счётчика в big-endian порядке.
        nonce[..NONCE_SUFFIX_SIZE].copy_from_slice(&counter.to_be_bytes());

        nonce
    }

    /// Формирует полный зашифрованный RTP-пакет.
    ///
    /// # Структура пакета
    /// `[ RTP header (12 байт) ][ зашифрованный payload ][ GCM tag (16 байт) ][ nonce suffix (4 байта) ]`
    ///
    /// # Аргументы
    /// * `frame` — незашифрованный Opus-фрейм.
    ///
    /// # Возвращаемое значение
    /// Готовый к отправке RTP-пакет.
    ///
    /// # Ошибки
    /// - `NotInitialized` — сокет не инициализирован.
    /// - `EncryptionFailed` — ошибка AES-GCM.
    #[inline]
    fn create_packet_raw(&self, frame: Vec<u8>) -> Result<Vec<u8>, CryptoError> {
        // Держим read-lock на всё время шифрования.
        let guard = self.state.read().expect("RTP state lock poisoned");
        // Если состояние отсутствует — сокет не инициализирован.
        let state = guard.as_ref().ok_or(CryptoError::NotInitialized)?;

        // Формируем RTP-заголовок (последовательно обновляет sequence и timestamp).
        let header = self.build_header(state.ssrc);

        // Генерируем nonce (инкрементирует counter).
        let nonce_bytes = self.generate_nonce();
        let nonce = Nonce::from(nonce_bytes);
        let payload_len = frame.len();

        // Выделяем память под весь пакет заранее.
        let mut packet = Vec::with_capacity(
            RTP_HEADER_SIZE + payload_len + GCM_TAG_SIZE + NONCE_SUFFIX_SIZE,
        );

        // Добавляем заголовок.
        packet.extend_from_slice(&header);

        // Добавляем незашифрованный payload (позже будет зашифрован in-place).
        packet.extend_from_slice(&frame);

        // Получаем мутабельный срез payload для шифрования.
        let payload = &mut packet[RTP_HEADER_SIZE..];

        // Шифруем payload in-place, используя nonce и AAD = RTP-заголовок.
        // Возвращает GCM-тег.
        let tag = state
            .cipher
            .encrypt_inout_detached(
                &nonce,
                &header,
                InOutBuf::from(payload),
            )
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

        // Добавляем тег GCM в конец пакета.
        packet.extend_from_slice(tag.as_slice());

        // Добавляем младшие 4 байта nonce в конец пакета.
        packet.extend_from_slice(&nonce_bytes[..NONCE_SUFFIX_SIZE]);

        Ok(packet)
    }

    /// Строит 12-байтовый RTP-заголовок.
    ///
    /// Формат:
    /// - байт 0 — `0x80` (Version=2);
    /// - байт 1 — `0x78` (Payload type=120, Opus);
    /// - байты 2..4 — sequence (big-endian);
    /// - байты 4..8 — timestamp (big-endian);
    /// - байты 8..12 — SSRC (big-endian).
    ///
    /// Атомарно увеличивает `sequence` на 1 и `timestamp` на `TIMESTAMP_INC`.
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

        // Байт 0: Version = 2 (0x80).
        header[0] = 0x80;

        // Байт 1: Payload type = 120 (0x78) для Opus.
        header[1] = 0x78;

        // Атомарно получаем текущий sequence и увеличиваем его на 1.
        let sequence = self.sequence.fetch_add(1, Ordering::Acquire);

        // Атомарно получаем текущий timestamp и увеличиваем его на TIMESTAMP_INC.
        let timestamp = self.timestamp.fetch_add(TIMESTAMP_INC, Ordering::Acquire);

        // Записываем sequence в big-endian (2 байта).
        header[2..4].copy_from_slice(&sequence.to_be_bytes());

        // Записываем timestamp в big-endian (4 байта).
        header[4..8].copy_from_slice(&timestamp.to_be_bytes());

        // Записываем SSRC (4 байта).
        header[8..RTP_HEADER_SIZE].copy_from_slice(&ssrc.to_be_bytes());

        header
    }

    /// Сбрасывает состояние шифра и все счётчики в ноль.
    ///
    /// После вызова требуется повторный `initialize`.
    /// Безопасен для повторного вызова.
    #[inline]
    pub fn destroy(&self) {
        // Обнуляем состояние шифра под write-lock.
        *self.state.write().expect("RTP state lock poisoned") = None;

        // Сбрасываем все счётчики.
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