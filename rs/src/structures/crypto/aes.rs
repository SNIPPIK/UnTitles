use crate::structures::timers::scheduler::cycle_manager::{ TICK_INTERVAL_MS };
use napi::bindgen_prelude::{ Status, Buffer, Error, Result };
use napi_derive::napi;
use std::{sync::atomic::{AtomicU16, AtomicU32, Ordering}, fmt};
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

/// Приращение временной метки RTP для одного пакета.
/// Для Opus с частотой дискретизации 48 кГц и кадрами по 20 мс получаем 960 семплов.
/// TICK_INTERVAL_MS — интервал цикла отправки (20 мс).
const TIMESTAMP_INC: u64 = 48000 * TICK_INTERVAL_MS / 1000;

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

    /// Размер фрейма превышает максимально допустимый (обычно MTU ~1200 байт).
    FrameTooLarge(usize),

    /// Некорректный RTP-пакет (например, слишком короткий заголовок).
    InvalidPacket,
}

/// Реализация Display для преобразования ошибки в строку.
impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CryptoError::InvalidKeyLength(len) => write!(f, "Invalid key length: {}", len),
            CryptoError::EncryptionFailed(msg) => write!(f, "Encryption failed: {}", msg),
            CryptoError::FrameTooLarge(size) => write!(f, "Frame too large: {}", size),
            CryptoError::InvalidPacket => write!(f, "Invalid RTP packet"),
        }
    }
}

/// Реализация Error для совместимости со стандартным трейтом.
impl std::error::Error for CryptoError {}

/// Преобразование нашей ошибки в формат N-API (для проброса в JavaScript).
impl From<CryptoError> for Error {
    fn from(e: CryptoError) -> Self {
        Error::new(Status::GenericFailure, e.to_string())
    }
}

// ============================================================================
// Внутренние параметры шифрования
// ============================================================================

/// Внутренние параметры шифрования (пока только SSRC, в будущем можно расширить).
#[derive(Clone)]
struct EncryptorOptions {
    ssrc: u32,
}

// ============================================================================
// VoiceRTPSocket
// ============================================================================

/// Объект RTP-сокета для голоса, доступный из JavaScript.
/// Выполняет шифрование аудиофреймов (Opus) в соответствии с требованиями Discord.
///
/// # Атомарные счётчики
/// - `sequence` – 16-битный счётчик RTP-пакетов (оборачивается).
/// - `timestamp` – 32-битная метка времени, увеличивается на `TIMESTAMP_INC` для каждого пакета.
/// - `counter` – 32-битный счётчик nonce (используется как первые 4 байта 12-байтового nonce).
///
/// # Потокобезопасность
/// Все публичные методы могут вызываться из разных потоков благодаря атомарным операциям.
/// Однако `cipher` внутри не является `Sync`, поэтому экземпляр `VoiceRTPSocket` не должен
/// использоваться из нескольких потоков одновременно (если только не обёрнут в Mutex).
#[napi(js_name = "VoiceRTPSocket")]
pub struct VoiceRTPSocket {
    /// Параметры (SSRC и др.).
    options: EncryptorOptions,

    /// Порядковый номер RTP-пакета (16 бит, автоматически оборачивается).
    sequence: AtomicU16,

    /// Временная метка RTP (32 бит, увеличивается с каждым пакетом).
    timestamp: AtomicU32,

    /// Счётчик nonce (32 бит, инкрементируется после каждого использования).
    counter: AtomicU32,

    /// Экземпляр шифра AES-256-GCM.
    cipher: Aes256Gcm,
}

/// N-API реализация VoiceRTPSocket.
#[napi]
impl VoiceRTPSocket {
    /// Создаёт новый экземпляр VoiceRTPSocket.
    ///
    /// # Аргументы
    /// * `ssrc` — 32-битный идентификатор источника синхронизации.
    /// * `key` — 32-байтный ключ AES-256-GCM (Buffer).
    ///
    /// # Ошибки
    /// Возвращает ошибку, если ключ не 32 байта или невалиден.
    ///
    /// Начальные значения sequence, timestamp и counter инициализируются
    /// случайным образом для улучшения криптостойкости.
    #[napi(constructor)]
    pub fn new(ssrc: u32, key: Buffer) -> Result<Self> {
        // Проверяем длину ключа.
        if key.len() != 32 {
            return Err(CryptoError::InvalidKeyLength(key.len()).into());
        }

        // Копируем ключ из Buffer в массив фиксированной длины.
        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(key.as_ref());

        // Получаем потоковый генератор случайных чисел.
        let mut rng = rng();

        Ok(Self {
            // Создаём шифр из ключа; при ошибке возвращаем EncryptionFailed.
            cipher: Aes256Gcm::new_from_slice(&key_array)
                .map_err(|_| CryptoError::EncryptionFailed("invalid key".into()))?,

            options: EncryptorOptions { ssrc },

            // Инициализируем счётчики случайными числами.
            sequence: AtomicU16::new(rng.random()),
            timestamp: AtomicU32::new(rng.random()),
            counter: AtomicU32::new(rng.random()),
        })
    }

    /// Геттер режима шифрования (константа для Discord Voice).
    #[napi(getter)]
    #[inline]
    pub fn mode(&self) -> &'static str {
        "aead_aes256_gcm_rtpsize"
    }

    /// Шифрует один Opus-фрейм и возвращает полный RTP-пакет.
    ///
    /// # Аргументы
    /// * `frame` — Buffer с Opus-данными.
    ///
    /// # Возвращает
    /// Готовый зашифрованный RTP-пакет в виде Buffer.
    #[napi]
    #[inline]
    pub fn packet(&self, frame: Buffer) -> Result<Buffer> {
        self.create_packet_raw(frame)
    }

    /// Пакетное шифрование нескольких фреймов.
    ///
    /// # Аргументы
    /// * `frames` — вектор буферов.
    ///
    /// # Возвращает
    /// Вектор зашифрованных RTP-пакетов.
    #[napi]
    pub fn packets(&self, frames: Vec<Buffer>) -> Result<Vec<Buffer>> {
        let mut output = Vec::with_capacity(frames.len());

        for frame in frames {
            output.push(self.create_packet_raw(frame)?);
        }

        Ok(output)
    }

    /// Генерирует 12-байтовый nonce.
    /// В Discord используются только первые 4 байта (счётчик), остальные 8 — нули.
    ///
    /// # Возвращает
    /// Массив `[u8; 12]`, где первые 4 байта — big-endian значение счётчика,
    /// увеличенного на 1, остальные байты — нули.
    #[inline]
    fn generate_nonce(&self) -> [u8; 12] {
        // Атомарно инкрементируем счётчик и получаем предыдущее значение.
        let counter = self.counter.fetch_add(1, Ordering::Relaxed);

        let mut nonce = [0u8; 12];

        // Копируем первые 4 байта счётчика в big-endian порядке.
        nonce[..4].copy_from_slice(&counter.to_be_bytes());

        nonce
    }

    /// Формирует полный зашифрованный RTP-пакет.
    ///
    /// # Структура пакета
    /// `[ RTP header (12 байт) ][ зашифрованный payload ][ GCM tag (16 байт) ][ nonce suffix (4 байта) ]`
    ///
    /// # Аргументы
    /// * `frame` — Buffer с Opus-данными.
    ///
    /// # Возвращает
    /// Buffer с зашифрованным пакетом.
    #[inline]
    fn create_packet_raw(&self, frame: Buffer) -> Result<Buffer> {
        // Формируем RTP-заголовок (последовательно обновляет sequence и timestamp).
        let header = self.build_header();

        // Генерируем nonce.
        let nonce_bytes = self.generate_nonce();
        let nonce = Nonce::from(nonce_bytes);

        /*
         * RTP-пакет:
         *
         * [ 12 bytes header ]
         * [ payload           ]
         * [ 16 bytes GCM tag ]
         * [ 4 bytes nonce ]
         */
        let payload_len = frame.len();

        // Выделяем память под весь пакет.
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
        let tag = self
            .cipher
            .encrypt_inout_detached(
                &nonce,
                &header,
                InOutBuf::from(payload),
            )
            .map_err(|e| napi::Error::from_reason(format!("Encryption failed: {e}")))?;

        // Добавляем тег GCM.
        packet.extend_from_slice(tag.as_slice());

        // Добавляем младшие 4 байта nonce в конец пакета.
        packet.extend_from_slice(&nonce_bytes[..NONCE_SUFFIX_SIZE]);

        // Возвращаем как Buffer.
        Ok(Buffer::from(packet))
    }

    /// Строит 12-байтовый RTP-заголовок.
    ///
    /// # Возвращает
    /// Массив `[u8; 12]` с установленными полями версии, payload type,
    /// sequence, timestamp и SSRC.
    #[inline]
    fn build_header(&self) -> [u8; RTP_HEADER_SIZE] {
        let mut header = [0u8; RTP_HEADER_SIZE];

        // Байт 0: Version = 2 (0x80).
        header[0] = 0x80;

        // Байт 1: Payload type = 120 (0x78) для Opus.
        header[1] = 0x78;

        // Атомарно получаем и увеличиваем sequence.
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);

        // Атомарно получаем и увеличиваем timestamp.
        let timestamp = self.timestamp.fetch_add(TIMESTAMP_INC as u32, Ordering::Relaxed);

        // Записываем sequence в big-endian.
        header[2..4].copy_from_slice(&sequence.to_be_bytes());

        // Записываем timestamp в big-endian.
        header[4..8].copy_from_slice(&timestamp.to_be_bytes());

        // Записываем SSRC.
        header[8..12].copy_from_slice(&self.options.ssrc.to_be_bytes());

        header
    }

    /// Сбрасывает все счётчики в ноль.
    /// Может использоваться для переинициализации состояния.
    #[napi]
    #[inline]
    pub fn destroy(&mut self) {
        self.sequence.store(0, Ordering::Relaxed);
        self.timestamp.store(0, Ordering::Relaxed);
        self.counter.store(0, Ordering::Relaxed);
    }
}

/// Деструктор (только для отладочного вывода).
impl Drop for VoiceRTPSocket {
    fn drop(&mut self) {
        self.destroy();
        
        #[cfg(debug_assertions)]
        println!(
            "VoiceRTPSocket::drop | sequence={} timestamp={}",
            self.sequence.load(std::sync::atomic::Ordering::Relaxed),
            self.timestamp.load(std::sync::atomic::Ordering::Relaxed),
        );
    }
}