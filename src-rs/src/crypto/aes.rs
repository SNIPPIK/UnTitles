use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::atomic::{AtomicU16, AtomicU32, Ordering};
use std::fmt;
use rand::{rng, RngExt};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};

/// Время OPUS пакета
/// 48kHz * 20ms / 1000
const TIMESTAMP_INC: u32 = 960;
const MAX_FRAME_SIZE: usize = 4096; // Максимальный размер Opus фрейма

/// Кастомная ошибка для криптографических операций.
#[derive(Debug)]
pub enum CryptoError {
    InvalidKeyLength(usize),
    EncryptionFailed(String),
    FrameTooLarge(usize),
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CryptoError::InvalidKeyLength(len) => {
                write!(f, "Invalid key length: expected 32, got {}", len)
            }
            CryptoError::EncryptionFailed(msg) => {
                write!(f, "Encryption failed: {}", msg)
            }
            CryptoError::FrameTooLarge(size) => {
                write!(f, "Frame too large: {} > {}", size, MAX_FRAME_SIZE)
            }
        }
    }
}

impl std::error::Error for CryptoError {}

impl From<CryptoError> for Error {
    fn from(e: CryptoError) -> Self {
        Error::new(Status::GenericFailure, e.to_string())
    }
}

/// Параметры шифрования, специфичные для данного RTP-потока.
/// Содержит SSRC (идентификатор источника синхронизации) и ключ AES-256.
#[derive(Clone)]
struct EncryptorOptions {
    ssrc: u32
}

/// Буферизованный RTP-сокет для голоса с шифрованием AES-256-GCM.
///
/// Генерирует RTP-пакеты с правильными заголовками (sequence, timestamp, SSRC),
/// шифрует полезную нагрузку (Opus-фрейм) с использованием режима AEAD_AES_256_GCM_RTPSIZE,
/// который требует включения заголовка RTP в дополнительные аутентифицированные данные (AAD)
///
/// Счётчики sequence, timestamp и nonce counter управляются атомарно и потокобезопасны
#[napi(js_name = "VoiceRTPSocket")]
pub struct VoiceRTPSocket {
    /// Параметры шифрования (SSRC и ключ)
    options: EncryptorOptions,

    /// Счётчик последовательности RTP (16 бит). Автоматически увеличивается для каждого пакета
    sequence: AtomicU16,

    /// Временная метка RTP (32 бита). Увеличивается на TIMESTAMP_INC для каждого пакета
    timestamp: AtomicU32,

    /// Счётчик для формирования nonce (первые 4 байта nonce). Используется как счётчик пакетов
    counter: AtomicU32,

    /// AES-GCM с 256-битным ключом и 96-битным одноразовым значением
    cipher: Aes256Gcm
}

#[napi]
impl VoiceRTPSocket {
    /// Создаёт новый экземпляр VoiceRTPSocket.
    ///
    /// # Аргументы
    /// * `ssrc` - 32-битный идентификатор источника синхронизации (SSRC), уникальный для потока.
    /// * `key` - Buffer длиной ровно 32 байта, содержащий ключ AES-256-GCM.
    ///
    /// Начальные значения sequence, timestamp и counter генерируются случайным образом
    /// для улучшения криптостойкости и предотвращения угадывания.
    #[napi(constructor)]
    pub fn new(ssrc: u32, key: Buffer) -> Result<Self> {
        // Проверяем длину — обязательно 32 байта для AES-256-GCM
        if key.len() != 32 {
            return Err(CryptoError::InvalidKeyLength(key.len()).into());
        }

        // Копируем данные из Buffer в фиксированный массив
        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(key.as_ref());

        let mut rng = rng();

        Ok(Self {
            cipher: Aes256Gcm::new_from_slice(&key)
                .map_err(|_| CryptoError::EncryptionFailed("invalid key".into()))?,

            options: EncryptorOptions { ssrc },
            sequence: AtomicU16::new(rng.random_range(0..=u16::MAX)),
            timestamp: AtomicU32::new(rng.random()),
            counter: AtomicU32::new(rng.random()),
        })
    }

    /// Возвращает строку, идентифицирующую режим шифрования.
    #[napi(getter)]
    pub fn mode(&self) -> String {
        "aead_aes256_gcm_rtpsize".to_string()
    }

    /// Возвращает текущий nonce (12 байт) и его первые 4 байта (tail).
    ///
    /// Nonce формируется как:
    /// - первые 4 байта: значение счётчика `counter` (увеличивается при каждом вызове)
    /// - остальные 8 байт: нули (согласно спецификации Discord/RTP)
    #[napi(getter)]
    pub fn nonce(&self) -> Result<Vec<Buffer>> {
        let counter = self.counter.fetch_add(1, Ordering::AcqRel);

        let mut nonce = [0u8; 12];
        nonce[0..4].copy_from_slice(&counter.to_be_bytes());

        let tail = nonce[0..4].to_vec();

        Ok(vec![
            Buffer::from(nonce.to_vec()),
            Buffer::from(tail),
        ])
    }

    /// Создаёт зашифрованный RTP-пакет из переданного Opus-фрейма.
    ///
    /// Структура пакета (RFC 3550 + Discord AEAD AES256-GCM RTP Size):
    /// - RTP Header (12 байт): V=2, P=0, X=0, CC=0, M=0, PT=120, SEQ, TS, SSRC
    /// - Encrypted Payload (N байт)
    /// - Authentication Tag (16 байт)
    /// - Nonce Tail (4 байта): первые 4 байта nonce в конце пакета
    #[napi]
    pub fn packet(&self, frame: Buffer) -> Result<Buffer> {
        // Проверяем размер фрейма, чтобы избежать фрагментации.
        if frame.len() > MAX_FRAME_SIZE {
            return Err(CryptoError::FrameTooLarge(frame.len()).into());
        }

        let header = self.build_header();
        let counter = self.counter.fetch_add(1, Ordering::Relaxed);

        // Формируем nonce: 32-bit счётчик + 8 нулевых байт (всего 12 байт)
        let mut nonce_bytes = [0u8; 12];
        nonce_bytes[0..4].copy_from_slice(&counter.to_be_bytes());
        // остальные 8 байт уже нули

        let nonce = Nonce::from(nonce_bytes);

        // Payload = Opus фрейм, AAD = RTP header (для аутентификации)
        let payload = Payload {
            msg: frame.as_ref(),
            aad: &header,
        };

        let ciphertext_with_tag = self.cipher
            .encrypt(&nonce, payload)
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

        // GCM тег — последние 16 байт (полный размер)
        let tag_start = ciphertext_with_tag.len() - 16;
        let encrypted = &ciphertext_with_tag[..tag_start];
        let tag = &ciphertext_with_tag[tag_start..];

        // Финальный пакет: Header + Encrypted + Tag + 4-byte nonce tail
        let mut packet = Vec::with_capacity(
            header.len() + encrypted.len() + tag.len() + 4
        );
        packet.extend_from_slice(&header);
        packet.extend_from_slice(encrypted);
        packet.extend_from_slice(tag);
        packet.extend_from_slice(&counter.to_be_bytes()); // Nonce tail (первые 4 байта nonce)

        Ok(Buffer::from(packet))
    }

    /// Формирует RTP-заголовок согласно RFC 3550.
    ///
    /// Структура (12 байт):
    /// - Байт 0: V(2)=2, P(1)=0, X(1)=0, CC(4)=0 → 0x80
    /// - Байт 1: M(1)=0, PT(7)=120 (Opus) → 0x78
    /// - Байты 2-3: Sequence number (16-bit, увеличивается на 1)
    /// - Байты 4-7: Timestamp (32-bit, увеличивается на 960 для 48kHz/20ms)
    /// - Байты 8-11: SSRC (32-bit, уникальный идентификатор)
    fn build_header(&self) -> Vec<u8> {
        let mut header = vec![0u8; 12];

        // Байт 0: Version + Flags
        header[0] = 0x80;

        // Байт 1: Payload Type
        header[1] = 0x78;

        // Байты 2-3: Sequence number (увеличивается на 1 с каждым пакетом)
        let seq = self.sequence.fetch_add(1, Ordering::Relaxed);
        header[2..4].copy_from_slice(&seq.to_be_bytes());

        // Байты 4-7: Timestamp (увеличивается на 960 для Opus 48kHz/20ms)
        let ts = self.timestamp.fetch_add(TIMESTAMP_INC, Ordering::Relaxed);
        header[4..8].copy_from_slice(&ts.to_be_bytes());

        // Байты 8-11: SSRC
        header[8..12].copy_from_slice(&self.options.ssrc.to_be_bytes());

        header
    }

    /// Сбрасывает все внутренние счётчики в ноль.
    #[napi]
    pub fn destroy(&mut self) {
        self.sequence.store(0, Ordering::Relaxed);
        self.timestamp.store(0, Ordering::Relaxed);
        self.counter.store(0, Ordering::Relaxed);
    }
}