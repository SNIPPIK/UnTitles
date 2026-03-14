use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::atomic::{AtomicU32, Ordering};
use std::fmt;
use rand::{rng, RngExt};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};

/// Приращение временной метки (timestamp) для каждого отправленного пакета.
/// Рассчитано для 20 мс фреймов при частоте дискретизации 48 кГц:
/// 48000 samples/sec * 0.02 sec = 960 samples.
pub const TIMESTAMP_INC: u32 = 960;

/// Максимальное 16-битное значение, используется для обнуления счётчика
/// последовательности (sequence number) при переполнении.
const MAX_16BIT: u32 = 0xFFFF;

/// Тип полезной нагрузки RTP для Opus (стандартное значение для Discord).
const PAYLOAD_TYPE: u8 = 120;

/// Максимальный размер фрейма (MTU - накладные расходы), чтобы избежать фрагментации.
const MAX_FRAME_SIZE: usize = 1200;

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
    ssrc: u32,
    key: [u8; 32],
}

/// Буферизованный RTP-сокет для голоса с шифрованием AES-256-GCM.
///
/// Генерирует RTP-пакеты с правильными заголовками (sequence, timestamp, SSRC),
/// шифрует полезную нагрузку (Opus-фрейм) с использованием режима AEAD_AES_256_GCM_RTPSIZE,
/// который требует включения заголовка RTP в дополнительные аутентифицированные данные (AAD).
///
/// Счётчики sequence, timestamp и nonce counter управляются атомарно и потокобезопасны.
#[napi(js_name = "VoiceRTPSocket")]
pub struct VoiceRTPSocket {
    /// Параметры шифрования (SSRC и ключ).
    options: EncryptorOptions,

    /// Счётчик последовательности RTP (16 бит). Автоматически увеличивается для каждого пакета.
    sequence: AtomicU32,

    /// Временная метка RTP (32 бита). Увеличивается на TIMESTAMP_INC для каждого пакета.
    timestamp: AtomicU32,

    /// Счётчик для формирования nonce (первые 4 байта nonce). Используется как счётчик пакетов.
    counter: AtomicU32,
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
            options: EncryptorOptions { ssrc, key: key_array },
            sequence: AtomicU32::new(rng.random_range(0..=MAX_16BIT)),
            timestamp: AtomicU32::new(rng.random()),
            counter: AtomicU32::new(rng.random()),
        })
    }

    /// Возвращает строку, идентифицирующую режим шифрования.
    #[napi(getter)]
    pub fn mode(&self) -> String {
        "aead_aes256_gcm_rtpsize".to_string()
    }

    /// Устанавливает счётчик последовательности вручную (для восстановления после реконнекта).
    #[napi]
    pub fn set_sequence(&self, seq: u32) {
        self.sequence.store(seq & MAX_16BIT, Ordering::Release);
    }

    /// Устанавливает временную метку вручную.
    #[napi]
    pub fn set_timestamp(&self, ts: u32) {
        self.timestamp.store(ts, Ordering::Release);
    }

    /// Устанавливает счётчик nonce вручную.
    #[napi]
    pub fn set_counter(&self, cnt: u32) {
        self.counter.store(cnt, Ordering::Release);
    }

    /// Возвращает текущий nonce (12 байт) и его первые 4 байта (tail).
    ///
    /// Nonce формируется как:
    /// - первые 4 байта: значение счётчика `counter` (увеличивается при каждом вызове)
    /// - остальные 8 байт: нули (согласно спецификации Discord/RTP)
    #[napi]
    pub fn get_nonce(&self) -> Result<Vec<Buffer>> {
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
    #[napi]
    pub fn packet(&self, frame: Buffer) -> Result<Buffer> {
        // Проверяем размер фрейма, чтобы избежать фрагментации.
        if frame.len() > MAX_FRAME_SIZE {
            return Err(CryptoError::FrameTooLarge(frame.len()).into());
        }

        let header = self.build_header();
        let counter = self.counter.fetch_add(1, Ordering::AcqRel);

        let mut nonce_bytes = [0u8; 12];
        nonce_bytes[0..4].copy_from_slice(&counter.to_be_bytes());
        let nonce = Nonce::from(nonce_bytes);
        let tail = nonce_bytes[0..4].to_vec();

        let cipher = Aes256Gcm::new_from_slice(&self.options.key)
            .map_err(|_| CryptoError::EncryptionFailed("invalid key".into()))?;

        let payload = Payload {
            msg: frame.as_ref(),
            aad: &header,
        };

        let ciphertext_with_tag = cipher
            .encrypt(&nonce, payload)
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

        let tag_start = ciphertext_with_tag.len() - 16;
        let encrypted = &ciphertext_with_tag[..tag_start];
        let tag = &ciphertext_with_tag[tag_start..];

        let mut packet = Vec::with_capacity(header.len() + encrypted.len() + tag.len() + tail.len());
        packet.extend_from_slice(&header);
        packet.extend_from_slice(encrypted);
        packet.extend_from_slice(tag);
        packet.extend_from_slice(&tail);

        Ok(Buffer::from(packet))
    }

    /// Внутренний метод формирования RTP-заголовка.
    fn build_header(&self) -> Vec<u8> {
        let mut header = vec![0u8; 12];

        header[0] = 0x80; // Version 2, no extensions
        header[1] = PAYLOAD_TYPE; // Marker 0, Payload Type

        let seq = self.sequence.fetch_add(1, Ordering::Relaxed) & MAX_16BIT;
        header[2..4].copy_from_slice(&(seq as u16).to_be_bytes());

        let ts = self.timestamp.fetch_add(TIMESTAMP_INC, Ordering::Relaxed);
        header[4..8].copy_from_slice(&ts.to_be_bytes());

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