use crate::structures::timers::scheduler::cycle_manager::{ TICK_INTERVAL_MS };
use napi::bindgen_prelude::{ Status, Buffer, Error, Result };
use napi_derive::napi;
use std::{
    sync::atomic::{AtomicU16, AtomicU32, Ordering},
    fmt
};
use aes_gcm::{
    aead::{KeyInit, AeadInOut, inout::InOutBuf},
    Aes256Gcm, Nonce
};
use rand::{
    RngExt,
    rng
};

/// Приращение временной метки RTP для одного пакета.
/// Рассчитывается как `48000 samples/sec * 0.02 sec = 960 samples` для кадров Opus длительностью 20 мс.
const TIMESTAMP_INC: u64 = 48000 * TICK_INTERVAL_MS / 1000;

/// Размер стандартного заголовка RTP в байтах (без CSRC и расширений).
const RTP_HEADER_SIZE: usize = 12;

/// Типы ошибок, специфичные для криптографических операций.
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

/// Внутренние параметры шифрования (пока только SSRC, в будущем можно расширить).
#[derive(Clone)]
struct EncryptorOptions {
    ssrc: u32
}

/// Объект RTP-сокета для голоса, доступный из JavaScript.
/// Выполняет шифрование аудиофреймов (Opus) в соответствии с требованиями Discord.
///
/// # Атомарные счётчики
/// - `sequence` – 16-битный счётчик RTP-пакетов (оборачивается).
/// - `timestamp` – 32-битная метка времени, увеличивается на `TIMESTAMP_INC` для каждого пакета.
/// - `counter` – 32-битный счётчик nonce (используется как первые 4 байта 12-байтового nonce).
///
/// # Потокобезопасность
/// Все методы могут вызываться из разных потоков благодаря атомарным операциям.
/// Однако `cipher` внутри не является `Sync`, поэтому экземпляр `VoiceRTPSocket` не должен
/// использоваться из нескольких потоков одновременно (если только не обёрнут в Mutex).
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
        let mut rng = rng();

        Ok(VoiceRTPSocket {
            cipher: Aes256Gcm::new_from_slice(&key_array)
                .map_err(|_| CryptoError::EncryptionFailed("invalid key".into()))?,
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

    /// Шифрует один аудиофрейм (Opus) и возвращает полный RTP-пакет.
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
        Ok(self.create_packet_raw(frame)?)
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
            out.push(self.create_packet_raw(frame)?);
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

    /// Формирует зашифрованный RTP-пакет с полезной нагрузкой (Opus‑фреймом)
    /// в соответствии с режимом `aead_aes256_gcm_rtpsize`, используемым в Discord Voice.
    ///
    /// Процесс:
    /// 1. Генерируется 12-байтовый RTP-заголовок (версия, маркер, тип нагрузки,
    ///    порядковый номер, временная метка, SSRC).
    /// 2. Создаётся 12-байтовый nonce (первые 4 байта — текущий счётчик, остальные — нули).
    /// 3. Выделяется буфер достаточного размера: [RTP-заголовок | Opus-данные].
    /// 4. Шифрование выполняется **на месте** в этом буфере: Opus-фрейм заменяется
    ///    текстом той же длины. Используется `Aes256Gcm::encrypt_inout_detached`,
    ///    который принимает мутабельный буфер и возвращает аутентификационный тег (16 байт).
    /// 5. К буферу дописываются тег GCM и младшие 4 байта nonce.
    ///
    /// # Структура итогового пакета
    /// ```text
    /// [ RTP Header 12 байт ][ Зашифрованный Opus (длина frame.len()) ][ GCM Tag 16 байт ][ Nonce suffix 4 байта ]
    /// ```
    ///
    /// # Аргументы
    /// - `frame` — Node.js `Buffer` с исходным Opus-пакетом (может быть пустым? **Нет**, в вызывающем
    ///   коде есть проверка на `len > 0`).
    ///
    /// # Возвращаемое значение
    /// - `Ok(Buffer)` — зашифрованный RTP-пакет, готовый к отправке по UDP.
    /// - `Err(napi::Error)` — если произошла ошибка шифрования (например, из‑за неверного состояния
    ///   шифра, переполнения nonce‑счётчика и т.п.).
    ///
    /// # Замечания по реализации
    /// - Используется `InOutBuf` из `aead` v0.6 для работы с буфером «на месте».
    /// - После шифрования исходные данные в `frame` не изменяются (копируются в `out`).
    /// - Nonce‑счётчик автоматически инкрементируется при вызове `generate_nonce()`.
    /// - Метод не добавляет RTP-расширения, маркерный бит всегда 0.
    pub fn create_packet_raw(&self, frame: Buffer) -> Result<Buffer> {
        // Формируем 12-байтовый RTP-заголовок (обновляет sequence/timestamp атомарно).
        let header = self.build_header();

        // Получаем 12-байтовый nonce: первые 4 байта — счётчик, остальные 8 — нули.
        let nonce_bytes = self.generate_nonce();
        let nonce = Nonce::from(nonce_bytes);

        // Выделяем память под весь пакет: заголовок + полезная нагрузка + тег (16) + nonce (4).
        let mut out = Vec::with_capacity(RTP_HEADER_SIZE + frame.len() + 16 + 4);

        // Копируем заголовок.
        out.extend_from_slice(&header);

        // Копируем исходный Opus-фрейм (payload). Шифрование заменит эти данные.
        out.extend_from_slice(&frame);

        // Смещение начала полезной нагрузки в буфере `out`.
        let payload_offset = RTP_HEADER_SIZE;

        // Создаём обёртку `InOutBuf` для шифрования на месте. Она позволяет
        // `Aes256Gcm` записать текст прямо в этот же срез.
        let buffer_to_encrypt = InOutBuf::from(&mut out[payload_offset..]);

        // Шифруем на месте и получаем аутентификационный тег (16 байт).
        // AAD (дополнительные аутентифицированные данные) — RTP-заголовок.
        let tag = self
            .cipher
            .encrypt_inout_detached(
                &nonce,
                &header,            // AAD
                buffer_to_encrypt,  // шифруемый/выходной буфер
            )
            .map_err(|e| napi::Error::from_reason(format!("Encryption failed: {}", e)))?;

        // Добавляем тег GCM.
        out.extend_from_slice(tag.as_slice());

        // Добавляем младшие 4 байта nonce (суффикс, по которому получатель сможет
        // вычислить полный nonce, имея счётчик).
        out.extend_from_slice(&nonce_bytes[..4]);

        // Передаём владение буфером `out` в JavaScript без копирования.
        Ok(Buffer::from(out))
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

        header[0] = 0x80;
        header[1] = 0x78;

        let seq = self.sequence.fetch_add(1, Ordering::SeqCst);
        header[2..4].copy_from_slice(&seq.to_be_bytes());

        let ts = self.timestamp.fetch_add(TIMESTAMP_INC as u32, Ordering::SeqCst);
        header[4..8].copy_from_slice(&ts.to_be_bytes());

        header[8..12].copy_from_slice(&self.options.ssrc.to_be_bytes());

        header
    }

    /// Сбрасывает все внутренние счётчики в ноль.
    /// Используется при уничтожении экземпляра или для очистки состояния.
    #[napi]
    pub fn destroy(&mut self) {
        self.sequence.store(0, Ordering::SeqCst);
        self.timestamp.store(0, Ordering::SeqCst);
        self.counter.store(0, Ordering::SeqCst);
    }
}