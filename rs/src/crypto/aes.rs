use rand::RngExt;
use crate::timers::scheduler::cycle_manager::TICK_INTERVAL_MS;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rand::{rng};
use std::fmt;
use parking_lot::Mutex;
use aes_gcm::{
    aead::{AeadInPlace, KeyInit},
    Aes256Gcm,
    Nonce,
};

// ============================================================================
// КОНСТАНТЫ
// ============================================================================

/// Приращение временной метки RTP за один тик (20 мс) при частоте дискретизации 48 кГц.
///
/// Рассчитывается как `(48000 * TICK_INTERVAL_MS) / 1000`.
/// Для `TICK_INTERVAL_MS = 20` это даёт 960 семплов на пакет, что стандартно для Opus.
const TIMESTAMP_INC: u32 = (48000 * TICK_INTERVAL_MS / 1000) as u32;

/// Размер RTP-заголовка в байтах (фиксированный — 12).
const RTP_HEADER_SIZE: usize = 12;

// ============================================================================
// ОШИБКИ
// ============================================================================

/// Ошибки, возникающие при шифровании/дешифровании голосовых пакетов.
#[derive(Debug)]
pub enum CryptoError {
    /// Ключ имеет неверную длину (ожидается 32 байта для AES-256-GCM).
    InvalidKeyLength(usize),
    /// Ошибка в процессе шифрования (детали в строке).
    EncryptionFailed(String),
    /// Размер фрейма превышает допустимый предел.
    FrameTooLarge(usize),
    /// Некорректный RTP-пакет (например, пустой фрейм).
    InvalidPacket,
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

/// Преобразование `CryptoError` в napi-совместимую ошибку.
impl From<CryptoError> for Error {
    fn from(e: CryptoError) -> Self {
        Error::new(Status::GenericFailure, e.to_string())
    }
}

// ============================================================================
// ВНУТРЕННИЕ СТРУКТУРЫ
// ============================================================================

/// Неизменяемые параметры шифратора.
#[derive(Clone)]
struct EncryptorOptions {
    /// Идентификатор источника синхронизации (SSRC).
    ssrc: u32,
}

// ============================================================================
// VoiceRTPSocket
// ============================================================================

/// Нативный сокет для отправки голосовых RTP-пакетов с шифрованием AES-256-GCM.
///
/// Реализует формирование заголовка RTP, шифрование полезной нагрузки и
/// добавление аутентификационного тега и части nonce в соответствии с
/// протоколом Discord Voice (режим `aead_aes256_gcm_rtpsize`).
///
/// **Важно:** Поля sequence, timestamp и nonce-счётчик обновляются строго
/// последовательно под защитой мьютекса, чтобы избежать гонок даже при
/// вызовах из JavaScript (все вызовы N-API сериализованы, но мьютекс
/// гарантирует корректность при возможных будущих изменениях).
#[napi(js_name = "VoiceRTPSocket")]
pub struct VoiceRTPSocket {
    /// Конфигурационные параметры (SSRC).
    options: EncryptorOptions,

    /// Порядковый номер RTP-пакета (16 бит, переполняется по `wrapping_add`).
    sequence: Mutex<u16>,

    /// Временная метка RTP (32 бит, увеличивается на `TIMESTAMP_INC` каждый пакет).
    timestamp: Mutex<u32>,

    /// Счётчик для генерации nonce (32 бит, инкрементируется после каждого использования).
    counter: Mutex<u32>,

    /// Экземпляр шифра AES-256-GCM.
    cipher: Aes256Gcm,
}

#[napi]
impl VoiceRTPSocket {
    /// Создаёт новый голосовой сокет.
    ///
    /// # Аргументы
    /// - `ssrc` — идентификатор источника синхронизации.
    /// - `key` — 32-байтовый ключ шифрования (AES-256).
    ///
    /// # Ошибки
    /// Возвращает ошибку, если длина ключа не равна 32 байтам или ключ невалиден.
    #[napi(constructor)]
    pub fn new(ssrc: u32, key: Buffer) -> Result<Self> {
        if key.len() != 32 {
            return Err(CryptoError::InvalidKeyLength(key.len()).into());
        }

        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(key.as_ref());

        let cipher = Aes256Gcm::new_from_slice(&key_array)
            .map_err(|_| CryptoError::EncryptionFailed("invalid key".into()))?;

        // Инициализируем sequence случайным числом, как того требует RFC 3550.
        let mut rng = rng();

        Ok(Self {
            options: EncryptorOptions { ssrc },
            sequence: Mutex::new(rng.random()),
            timestamp: Mutex::new(0),
            counter: Mutex::new(0),
            cipher,
        })
    }

    /// Возвращает строку с режимом шифрования (`"aead_aes256_gcm_rtpsize"`).
    #[napi(getter)]
    pub fn mode(&self) -> String {
        "aead_aes256_gcm_rtpsize".into()
    }

    /// Шифрует один аудиофрейм и формирует полный RTP-пакет.
    ///
    /// Формат пакета: [RTP Header 12 байт] [зашифрованный фрейм] [тег 16 байт] [nonce 4 байта].
    ///
    /// # Особенности
    /// - RTP-заголовок содержит версию 2, маркерный бит = 0, тип нагрузки 0x78,
    ///   а также текущие значения sequence, timestamp и SSRC.
    /// - Шифрование производится с использованием AES-256-GCM; в AAD передаётся
    ///   RTP-заголовок.
    /// - После шифрования добавляется 16-байтовый аутентификационный тег и
    ///   младшие 4 байта nonce (счётчика).
    ///
    /// # Аргументы
    /// - `frame` — `Buffer` с аудиоданными (Opus-пакет).
    ///
    /// # Ошибки
    /// Возвращает ошибку, если фрейм пуст или произошла ошибка шифрования.
    #[napi]
    pub fn packet(&self, frame: Buffer) -> Result<Buffer> {
        let frame_len = frame.len();
        if frame_len == 0 {
            return Err(CryptoError::InvalidPacket.into());
        }

        let total_len = RTP_HEADER_SIZE + frame_len + 16 + 4;

        // ===== FAST ALLOC (без vec![0; N]) =====
        let mut packet = Vec::with_capacity(total_len);
        unsafe { packet.set_len(total_len); }

        // ===== RTP HEADER =====
        let header = self.build_header();
        packet[..RTP_HEADER_SIZE].copy_from_slice(&header);

        // ===== PAYLOAD =====
        let payload_start = RTP_HEADER_SIZE;
        let payload_end = payload_start + frame_len;

        packet[payload_start..payload_end].copy_from_slice(frame.as_ref());

        // ===== NONCE =====
        let nonce_bytes = self.generate_nonce();
        let nonce = Nonce::from_slice(&nonce_bytes);

        // ===== ENCRYPT IN PLACE =====
        let tag = self
            .cipher
            .encrypt_in_place_detached(
                nonce,
                &header,
                &mut packet[payload_start..payload_end],
            )
            .map_err(|e| CryptoError::EncryptionFailed(format!("{:?}", e)))?;

        // ===== TAG =====
        let tag_pos = payload_end;
        packet[tag_pos..tag_pos + 16].copy_from_slice(tag.as_slice());

        // ===== NONCE SHORT =====
        let nonce_pos = tag_pos + 16;
        packet[nonce_pos..nonce_pos + 4]
            .copy_from_slice(&nonce_bytes[..4]);

        Ok(Buffer::from(packet))
    }

    /// Шифрует несколько фреймов за один вызов.
    ///
    /// Пакеты формируются последовательно, что гарантирует корректный
    /// порядок sequence/timestamp/nonce.
    #[napi]
    pub fn packets(&self, frames: Vec<Buffer>) -> Result<Vec<Buffer>> {
        let mut out = Vec::with_capacity(frames.len());
        for frame in frames {
            out.push(self.packet(frame)?);
        }
        Ok(out)
    }

    /// Сбрасывает состояние счётчиков (sequence, timestamp, nonce).
    ///
    /// Полезно при переподключении, чтобы избежать коллизий nonce.
    #[napi]
    pub fn destroy(&self) {
        *self.sequence.lock() = 0;
        *self.timestamp.lock() = 0;
        *self.counter.lock() = 0;
    }

    // --------------------------------------------------------------------------
    // ВНУТРЕННИЕ МЕТОДЫ
    // --------------------------------------------------------------------------

    /// Генерирует 12-байтовый nonce, используя текущий счётчик.
    ///
    /// Формат: первые 4 байта — значение счётчика в big-endian,
    /// остальные 8 байт — нули. Счётчик инкрементируется после вызова.
    /// Соответствует спецификации Discord Voice (только 4 значащих байта).
    fn generate_nonce(&self) -> [u8; 12] {
        let mut counter = self.counter.lock();
        let value = *counter;
        *counter = counter.wrapping_add(1);

        let mut nonce = [0u8; 12];
        nonce[..4].copy_from_slice(&value.to_be_bytes());
        nonce
    }

    /// Строит 12-байтовый RTP-заголовок и обновляет sequence/timestamp.
    ///
    /// Поля:
    /// - Версия (2 бита) = 2
    /// - P (1 бит) = 0
    /// - X (1 бит) = 0
    /// - CC (4 бита) = 0 → байт 0: `0x80`
    /// - M (1 бит) = 0
    /// - PT (7 бит) = 0x78 (тип нагрузки для Opus) → байт 1: `0x78`
    /// - Sequence number (16 бит)
    /// - Timestamp (32 бит)
    /// - SSRC (32 бит)
    fn build_header(&self) -> [u8; 12] {
        let mut sequence = self.sequence.lock();
        let mut timestamp = self.timestamp.lock();

        let seq = *sequence;
        let ts = *timestamp;

        // Инкрементируем с переполнением.
        *sequence = sequence.wrapping_add(1);
        *timestamp = timestamp.wrapping_add(TIMESTAMP_INC);

        let mut header = [0u8; 12];
        header[0] = 0x80; // V=2, P=0, X=0, CC=0
        header[1] = 0x78; // M=0, PT=120 (Opus)
        header[2..4].copy_from_slice(&seq.to_be_bytes());
        header[4..8].copy_from_slice(&ts.to_be_bytes());
        header[8..12].copy_from_slice(&self.options.ssrc.to_be_bytes());

        header
    }
}

// ============================================================================
// DROP
// ============================================================================

impl Drop for VoiceRTPSocket {
    fn drop(&mut self) {
        self.destroy();
    }
}