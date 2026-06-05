use crate::timers::scheduler::cycle_manager::TICK_INTERVAL_MS;
use std::sync::atomic::{AtomicU16, AtomicU32, Ordering};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rand::RngExt;
use rand::{rng};
use std::fmt;
use aes_gcm::{
    aead::{AeadInPlace, KeyInit},
    Aes256Gcm, Nonce
};

// ============================================================================
// CONSTANTS
// ============================================================================

/// Приращение временной метки RTP для одного пакета.
/// Рассчитывается как `48000 samples/sec * 0.02 sec = 960 samples` для кадров Opus длительностью 20 мс.
const TIMESTAMP_INC: u32 = (48000 * TICK_INTERVAL_MS / 1000) as u32;

/// Размер стандартного заголовка RTP в байтах (без CSRC и расширений).
const RTP_HEADER_SIZE: usize = 12;

// ============================================================================
// ERRORS
// ============================================================================

#[derive(Debug)]
pub enum CryptoError {
    /// Ключ шифрования имеет неверную длину (должен быть 32 байта).
    InvalidKeyLength(usize),

    /// Ошибка при шифровании (проблема с nonce, AAD или внутренняя ошибка AES-GCM).
    EncryptionFailed(String),

    /// Размер фрейма превышает максимально допустимый (обычно MTU ~1200 байт).
    FrameTooLarge(usize),

    /// Некорректный RTP-пакет (например, слишком короткий заголовок).
    InvalidPacket
}

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

impl std::error::Error for CryptoError {}

/// Преобразование нашей ошибки в формат N-API.
impl From<CryptoError> for Error {
    fn from(e: CryptoError) -> Self {
        Error::new(Status::GenericFailure, e.to_string())
    }
}

// ============================================================================
// STATE
// ============================================================================

#[derive(Clone)]
struct EncryptorOptions {
    ssrc: u32
}

/// Объект RTP-сокета для голоса, доступный из JavaScript.
/// Выполняет шифрование аудиофреймов (Opus) в соответствии с требованиями Discord.
///
/// # Потокобезопасность
/// Структура полностью Send + Sync. `Aes256Gcm` не имеет внутреннего мутируемого
/// состояния, а все счетчики атомарны. Можно безопасно дергать `packet()` из пула потоков.
#[napi(js_name = "VoiceRTPSocket")]
pub struct VoiceRTPSocket {
    options: EncryptorOptions,
    sequence: AtomicU16,
    timestamp: AtomicU32,
    counter: AtomicU32,
    cipher: Aes256Gcm
}

#[napi]
impl VoiceRTPSocket {
    /// Создаёт новый экземпляр `VoiceRTPSocket`.
    ///
    /// # Параметры
    /// - `ssrc` – 32-битный идентификатор источника синхронизации (Synchronization Source).
    /// - `key` – 32-байтовый ключ AES-256-GCM (получается из Discord Voice WebSocket).
    ///
    /// # Инициализация счётчиков
    /// `sequence`, `timestamp` и `counter` инициализируются случайными значениями,
    /// что улучшает криптостойкость (затрудняет предсказание nonce).
    #[napi(constructor)]
    pub fn new(ssrc: u32, key: Buffer) -> Result<Self> {
        // Проверяем длину ключа – только AES-256
        if key.len() != 32 {
            return Err(CryptoError::InvalidKeyLength(key.len()).into());
        }

        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(key.as_ref());

        // Инициализируем шифр. `new_from_slice` возвращает ошибку, если ключ не подходит.
        let cipher = Aes256Gcm::new_from_slice(&key_array)
            .map_err(|_| CryptoError::EncryptionFailed("invalid key".into()))?;

        let mut rng = rng();

        Ok(VoiceRTPSocket {
            cipher,
            options: EncryptorOptions { ssrc },
            sequence: AtomicU16::new(rng.random()),
            timestamp: AtomicU32::new(rng.random()),
            counter: AtomicU32::new(rng.random())
        })
    }

    /// Тип шифрования пакетов, требуется для логирования
    #[napi(getter)]
    pub fn mode(&self) -> String {
        "aead_aes256_gcm_rtpsize".to_string()
    }

    /// Шифрует один аудио фрейм (Opus) и возвращает полный RTP-пакет.
    ///
    /// # Процесс
    /// 1. Формируется RTP-заголовок (12 байт) с текущими значениями sequence, timestamp, SSRC.
    /// 2. Генерируется 12-байтовый nonce: первые 4 байта – счётчик (big-endian), остальные – нули.
    /// 3. Шифруется фрейм с использованием AAD = RTP-заголовок.
    /// 4. К результату добавляются первые 4 байта nonce (tail) для возможности дешифровки.
    ///
    /// # Формат выходного пакета
    /// `[RTP header 12 байт][зашифрованные данные + 16 байт тега][4 байта tail]`
    ///
    /// # Ошибки
    /// - Если шифрование провалилось (например, из-за неправильного nonce).
    /// - Если размер фрейма превышает допустимый (проверка отсутствует, но можно добавить).
    #[napi]
    pub fn packet(&self, frame: Buffer) -> Result<Buffer> {
        let frame_len = frame.len();
        let total_len = RTP_HEADER_SIZE + frame_len + 16 + 4;
        let mut out = Vec::with_capacity(total_len);
        unsafe {
            out.set_len(total_len);
        }

        // ===== HEADER =====
        let header = self.build_header();
        out[..RTP_HEADER_SIZE].copy_from_slice(&header);

        // ===== PAYLOAD =====
        let payload_end = RTP_HEADER_SIZE + frame_len;
        out[RTP_HEADER_SIZE..payload_end].copy_from_slice(frame.as_ref());

        // ===== NONCE =====
        let nonce_bytes = self.generate_nonce();
        let nonce = Nonce::from(nonce_bytes);

        // ===== ENCRYPT =====
        let tag = self.cipher
            .encrypt_in_place_detached(
                &nonce,
                &header,
                &mut out[RTP_HEADER_SIZE..payload_end],
            )
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

        // ===== TAG =====
        let tag_end = payload_end + 16;
        out[payload_end..tag_end].copy_from_slice(tag.as_slice());

        // ===== NONCE TAIL =====
        out[tag_end..total_len].copy_from_slice(&nonce_bytes[..4]);

        // Передача владения Vec в Node.js без копирования (zero-copy)
        Ok(Buffer::from(out.as_slice()))
    }

    /// Пакетное шифрование нескольких фреймов.
    /// Удобно для отправки нескольких аудиопакетов за раз (снижает количество вызовов через FFI).
    ///
    /// # Реализация
    /// Просто последовательно вызывает `packet` для каждого фрейма.
    /// Аллокация результата происходит один раз с предварительным резервированием ёмкости.
    #[napi]
    pub fn packets(&self, frames: Vec<Buffer>) -> Result<Vec<Buffer>> {
        let mut out = Vec::with_capacity(frames.len());
        for frame in frames {
            out.push(self.packet(frame)?);
        }
        Ok(out)
    }

    /// Генерирует 12-байтовый nonce для AES-GCM.
    /// Первые 4 байта – текущее значение счётчика (big-endian), остальные 8 байт – нули.
    ///
    /// Счётчик увеличивается атомарно на единицу каждый раз (Acquire/Release гарантирует видимость).
    fn generate_nonce(&self) -> [u8; 12] {
        let counter = self.counter.fetch_add(1, Ordering::Relaxed);
        let mut nonce = [0u8; 12];
        nonce[0..4].copy_from_slice(&counter.to_be_bytes());
        nonce
    }

    /// Строит стандартный RTP-заголовк (12 байт) в соответствии с RFC 3550.
    ///
    /// Поля:
    /// - V=2, P=0, X=0, CC=0 → байт 0 = 0x80
    /// - PT=120 (Opus), M=0 → байт 1 = 0x78
    /// - Sequence number (16 бит, big-endian) – увеличивается атомарно.
    /// - Timestamp (32 бита, big-endian) – увеличивается на TIMESTAMP_INC.
    /// - SSRC (32 бита, big-endian) – фиксированный.
    fn build_header(&self) -> [u8; RTP_HEADER_SIZE] {
        let mut header = [0u8; RTP_HEADER_SIZE];

        header[0] = 0x80; // V=2
        header[1] = 0x78; // PT=120 (Opus)

        let seq = self.sequence.fetch_add(1, Ordering::Relaxed);
        header[2..4].copy_from_slice(&seq.to_be_bytes());

        let ts = self.timestamp.fetch_add(TIMESTAMP_INC, Ordering::Relaxed);
        header[4..8].copy_from_slice(&ts.to_be_bytes());

        header[8..12].copy_from_slice(&self.options.ssrc.to_be_bytes());

        header
    }

    /// Сбрасывает все внутренние счётчики в ноль.
    /// Используется при уничтожении экземпляра или для очистки состояния.
    #[napi]
    pub fn destroy(&self) {
        self.sequence.store(0, Ordering::Relaxed);
        self.timestamp.store(0, Ordering::Relaxed);
        self.counter.store(0, Ordering::Relaxed);
    }
}