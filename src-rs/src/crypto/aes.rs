use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::atomic::{AtomicU32, Ordering};
use rand::RngExt;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use rand::rng;

pub const TIMESTAMP_INC: u32 = 960; // 48 кГц × 20 мс
const MAX_16BIT: u32 = 0xFFFF;

/// Параметры шифрования
#[derive(Clone)]
struct EncryptorOptions {
    ssrc: u32,
    key: [u8; 32],
}

#[napi(js_name = "VoiceRTPSocket")]
pub struct VoiceRTPSocket {
    options: EncryptorOptions,
    sequence: AtomicU32,
    timestamp: AtomicU32,
    counter: AtomicU32,
}

#[napi]
impl VoiceRTPSocket {
    #[napi(constructor)]
    pub fn new(ssrc: u32, key: Buffer) -> Result<Self> {
        // Проверяем длину — обязательно 32 байта для AES-256-GCM
        if key.len() != 32 {
            return Err(Error::new(
                Status::InvalidArg,
                format!("Key must be exactly 32 bytes, got {}", key.len()),
            ));
        }

        // Копируем данные из Buffer в фиксированный массив
        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(key.as_ref());

        let mut rng = rng();

        Ok(Self {
            options: EncryptorOptions {
                ssrc,
                key: key_array,
            },
            sequence: AtomicU32::new(rng.random_range(0..=MAX_16BIT)),
            timestamp: AtomicU32::new(rng.random()),
            counter: AtomicU32::new(rng.random()),
        })
    }

    /// Режим шифрования
    #[napi(getter)]
    pub fn mode(&self) -> String {
        "aead_aes256_gcm_rtpsize".to_string()
    }

    /// Возвращает nonce (12 байт) и tail (первые 4 байта)
    #[napi]
    pub fn get_nonce(&self) -> Result<Vec<Buffer>> {
        let counter = self.counter.fetch_add(1, Ordering::SeqCst);

        let mut nonce = [0u8; 12];
        nonce[0..4].copy_from_slice(&counter.to_be_bytes());

        let tail = nonce[0..4].to_vec();

        Ok(vec![
            Buffer::from(nonce.to_vec()),
            Buffer::from(tail),
        ])
    }

    /// Создаёт зашифрованный RTP-пакет из Opus-фрейма
    #[napi]
    pub fn packet(&self, frame: Buffer) -> Result<Buffer> {
        let header = self.build_header();

        // Генерируем nonce на основе counter
        let counter = self.counter.fetch_add(1, Ordering::SeqCst);
        let mut nonce_bytes = [0u8; 12];
        nonce_bytes[0..4].copy_from_slice(&counter.to_be_bytes());
        let nonce = Nonce::from(nonce_bytes);
        let tail = nonce_bytes[0..4].to_vec();

        let cipher = Aes256Gcm::new_from_slice(&self.options.key)
            .map_err(|_| Error::new(Status::GenericFailure, "Invalid AES-256 key".to_string()))?;

        let payload = Payload {
            msg: frame.as_ref(),
            aad: &header,
        };

        let ciphertext_with_tag = cipher
            .encrypt(&nonce, payload)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Encryption failed: {}", e)))?;

        // Разделяем ciphertext и tag (последние 16 байт)
        let tag_start = ciphertext_with_tag.len() - 16;
        let encrypted = &ciphertext_with_tag[..tag_start];
        let tag = &ciphertext_with_tag[tag_start..];

        // Собираем полный пакет
        let mut packet = Vec::with_capacity(header.len() + encrypted.len() + tag.len() + tail.len());

        packet.extend_from_slice(&header);
        packet.extend_from_slice(encrypted);
        packet.extend_from_slice(tag);
        packet.extend_from_slice(&tail);

        Ok(Buffer::from(packet))
    }

    /// Внутренний метод — формирует RTP-заголовок
    fn build_header(&self) -> Vec<u8> {
        let mut header = vec![0u8; 12];

        header[0] = 0x80;                    // Version 2, no padding/extension/CC
        header[1] = 0x78;                    // Marker 0, Payload Type 120 (Opus)

        let seq = self.sequence.fetch_add(1, Ordering::SeqCst) & MAX_16BIT;
        header[2..4].copy_from_slice(&(seq as u16).to_be_bytes());

        let ts = self.timestamp.fetch_add(TIMESTAMP_INC, Ordering::SeqCst);
        header[4..8].copy_from_slice(&ts.to_be_bytes());

        header[8..12].copy_from_slice(&self.options.ssrc.to_be_bytes());

        header
    }

    /// Метод destroy (для совместимости с JS-версией)
    #[napi]
    pub fn destroy(&mut self) {
        // Обнуляем поля
        self.sequence.store(0, Ordering::SeqCst);
        self.timestamp.store(0, Ordering::SeqCst);
        self.counter.store(0, Ordering::SeqCst);
    }
}