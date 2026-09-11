use std::fmt;

/// Верхний предел количества фреймов в одном Opus-пакете (RFC 6716).
const MAX_OPUS_FRAMES: usize = 48;

/// Максимальный размер одного Opus-фрейма (RFC 6716).
const MAX_OPUS_FRAME_BYTES: usize = 1275;

/// Верхний предел размера Opus-пакета: 48 фреймов по 1275 байт + заголовки.
/// Отсекает мусорные «пакеты» на входе.
const MAX_OPUS_PACKET_BYTES: usize = MAX_OPUS_FRAMES * MAX_OPUS_FRAME_BYTES + 64;

/// Типы пакетов для OPUS, рекомендуется некоторые просто не пушить в исходное аудио
/// Для Discord - Frame, Silent. Поскольку остальные не требуются и будут откинуты, это уже потеря пакета.
#[derive(Debug, PartialEq, Copy, Clone)]
pub enum PacketType {
    Head,       // OpusHead
    Tags,       // OpusTags

    Frame,      // обычный Opus audio frame
    Silent,     // специальный маркер тишины
    PLC,        // packet loss concealment
    VBR,        // VBR-related packet/frame

    Broken,     // повреждённый/некорректный пакет
    End,        // внутренний 0xFF

    OggPage,    // Ogg container page
}

/// Выходной пакет: (тип, данные).
pub type ParsedPacket = (PacketType, Vec<u8>);

impl PacketType {
    /// Проверяет, относится ли тип пакета к обрабатываемым аудио фреймам.
    ///
    /// Возвращает `true`, если пакет является одним из:
    /// - `Frame` — обычный Opus-фрейм с одним или двумя кадрами;
    /// - `Silent` — специальный пакет тишины;
    /// - `VBR` — пакет с переменным битрейтом (используемый в некоторых реализациях).
    ///
    /// Такие пакеты должны передаваться в аудио-декодер или буфер,
    /// в отличие от служебных (`Head`, `Tags`, `OggPage` и т.п.).
    pub fn is_audio_frame(self) -> bool {
        matches!(self, Self::Frame | Self::Silent | Self::VBR)
    }

    /// Определяет тип пакета на основе его содержимого и длины.
    ///
    /// Поддерживает:
    /// - RFC 6716 (Opus Audio Codec)
    /// - Ogg контейнер
    /// - Discord PLC (Packet Loss Concealment) маркеры
    pub fn detect_packet_type(packet: &[u8]) -> PacketType {
        let len = packet.len();

        if len == 0 {
            return PacketType::Broken;
        }

        // Одиночный байт 0xFF — внутренний маркер конца потока.
        if len == 1 && packet[0] == 0xFF {
            return PacketType::End;
        }

        // Ogg-страница.
        if len >= 4 && packet.starts_with(b"OggS") {
            return PacketType::OggPage;
        }

        // Opus identification header (OpusHead), RFC 6716: минимум 19 байт.
        if packet.starts_with(b"OpusHead") {
            return if len >= 19 {
                PacketType::Head
            } else {
                PacketType::Broken
            };
        }

        // Opus comment header (OpusTags), RFC 6716: минимум 12 байт.
        if packet.starts_with(b"OpusTags") {
            return if len >= 12 {
                PacketType::Tags
            } else {
                PacketType::Broken
            };
        }

        // Discord PLC маркеры.
        match packet {
            [0xFC, 0xFF, 0xFE] => return PacketType::PLC,
            [0xF8, 0xFF, 0xFE] => return PacketType::Silent,
            _ => {}
        }

        // Строгий структурный разбор Opus-пакета.
        match parse_opus_packet(packet) {
            Ok(info) => match info.toc.frame_code {
                0b10 => PacketType::VBR,
                _ => PacketType::Frame,
            },
            Err(_) => PacketType::Broken,
        }
    }
}

/// TOC-байт Opus-пакета: 5 бит config, 1 бит stereo, 2 бита frame code.
///
/// Соответствует первому байту каждого Opus-пакета (RFC 6716 §3.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpusToc {
    /// Номер конфигурации (0..=31) — определяет режим кодека и длительность кадра.
    pub config: u8,
    /// Флаг стерео: `true` — стерео, `false` — моно.
    pub stereo: bool,
    /// Код количества кадров (0..=3) — определяет структуру пакета.
    pub frame_code: u8,
}

impl OpusToc {
    /// Разбирает TOC-байт на составляющие поля.
    ///
    /// # Аргументы
    /// * `byte` — первый байт Opus-пакета.
    ///
    /// # Возвращаемое значение
    /// Структура с извлечёнными полями config/stereo/frame_code.
    #[inline]
    pub fn parse(byte: u8) -> Self {
        Self {
            // Старшие 5 бит — config.
            config: (byte >> 3) & 0x1F,
            // Бит 2 — флаг стерео.
            stereo: (byte >> 2) & 1 != 0,
            // Младшие 2 бита — код количества кадров.
            frame_code: byte & 0b11,
        }
    }
}

/// Структурная информация о корректном Opus-пакете.
#[derive(Debug, Clone, Copy)]
pub struct OpusPacketInfo {
    /// Разобранный TOC-байт.
    pub toc: OpusToc,
    /// Итоговое число аудио кадров в пакете.
    pub frame_count: usize,
    /// Сколько байт занимает padding (срезается с конца payload).
    pub padding_bytes: usize,
    /// Сколько байт приходится на сами фреймы.
    pub payload_bytes: usize,
}

/// Причина, по которой пакет не является валидным Opus-пакетом.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpusPacketError {
    /// Пустой пакет.
    Empty,
    /// Пакет превышает установленный предел.
    TooLarge(usize),
    /// Заголовок пакета обрезан.
    TruncatedHeader,
    /// Недопустимое количество кадров.
    InvalidFrameCount(u8),
    /// Поле длины обрезано.
    TruncatedLengthField,
    /// Padding превышает доступный объём данных.
    PaddingExceedsPacket { padding: usize, available: usize },
    /// Payload короче, чем требуется для указанного числа кадров.
    PayloadTooShort { payload: usize, frames: usize },
    /// Payload не делится на число кадров без остатка (для CBR).
    PayloadNotDivisible { payload: usize, frames: usize },
    /// Размер отдельного кадра превышает предел.
    FrameTooLarge(usize),
}

/// Реализация `Display` для читаемого представления ошибок.
impl fmt::Display for OpusPacketError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "empty packet"),
            Self::TooLarge(n) => write!(f, "packet {} exceeds limit", n),
            Self::TruncatedHeader => write!(f, "truncated header"),
            Self::InvalidFrameCount(n) => write!(f, "invalid frame count {}", n),
            Self::TruncatedLengthField => write!(f, "truncated length field"),
            Self::PaddingExceedsPacket { padding, available } => write!(
                f, "padding {} exceeds available {}", padding, available
            ),
            Self::PayloadTooShort { payload, frames } => write!(
                f, "payload {} too short for {} frames", payload, frames
            ),
            Self::PayloadNotDivisible { payload, frames } => write!(
                f, "payload {} not divisible by {} frames", payload, frames
            ),
            Self::FrameTooLarge(n) => write!(
                f, "frame {} exceeds {} bytes", n, MAX_OPUS_FRAME_BYTES
            ),
        }
    }
}

/// Реализация `Error` для использования в `Result`.
impl std::error::Error for OpusPacketError {}

/// Читает длину в кодировке RFC 6716 §3.2.1.
///
/// Байт 255 означает «продолжение», любое значение < 255 — конец.
/// Итоговая длина — сумма всех прочитанных байт.
///
/// # Аргументы
/// * `packet` — входные данные.
/// * `offset` — текущая позиция, будет увеличена по мере чтения.
///
/// # Возвращаемое значение
/// `Ok(сумма)` при успешном чтении.
///
/// # Ошибки
/// - `TruncatedLengthField` — данные закончились раньше конца поля.
/// - `TooLarge` — переполнение при сложении.
#[inline]
fn read_length(packet: &[u8], offset: &mut usize) -> Result<usize, OpusPacketError> {
    let mut total = 0usize;
    loop {
        // Читаем очередной байт длины.
        let b = *packet
            .get(*offset)
            .ok_or(OpusPacketError::TruncatedLengthField)?;
        *offset += 1;

        // Прибавляем с проверкой переполнения.
        total = total
            .checked_add(b as usize)
            .ok_or(OpusPacketError::TooLarge(usize::MAX))?;

        // Любое значение < 255 завершает поле.
        if b != 255 {
            return Ok(total);
        }
    }
}

/// Строгий разбор структуры Opus-пакета по RFC 6716 §3.2.
///
/// Проверяет:
/// * наличие TOC-байта;
/// * корректность кода фреймов (0..=3) и, для code 3, счётчика 1..=48;
/// * корректность length-полей padding'а и VBR-длин;
/// * что padding и фреймы не выходят за границы пакета;
/// * что payload достаточно для объявленного числа фреймов;
/// * для CBR — что payload делится на число фреймов без остатка;
/// * верхние пределы размера пакета и фрейма.
///
/// # Аргументы
/// * `packet` — байтовый срез Opus-пакета (начиная с TOC-байта).
///
/// # Возвращаемое значение
/// `OpusPacketInfo` со структурной информацией о пакете.
///
/// # Ошибки
/// Возвращает `OpusPacketError` при любом несоответствии RFC.
pub fn parse_opus_packet(packet: &[u8]) -> Result<OpusPacketInfo, OpusPacketError> {
    // Пустой пакет — заведомо невалиден.
    if packet.is_empty() {
        return Err(OpusPacketError::Empty);
    }
    // Проверка верхнего предела размера пакета.
    if packet.len() > MAX_OPUS_PACKET_BYTES {
        return Err(OpusPacketError::TooLarge(packet.len()));
    }

    // Разбираем TOC-байт.
    let toc = OpusToc::parse(packet[0]);
    // Смещение в пакете: сразу после TOC.
    let mut offset = 1usize;

    // Разбираем код фреймов.
    let (frame_count, vbr, has_padding) = match toc.frame_code {
        // Code 0: один кадр.
        0b00 => (1usize, false, false),
        // Code 1: два кадра CBR.
        0b01 => (2usize, false, false),
        // Code 2: два кадра VBR.
        0b10 => (2usize, true, false),
        // Code 3: произвольное число кадров, читаем доп. байт.
        0b11 => {
            let ch = *packet.get(offset).ok_or(OpusPacketError::TruncatedHeader)?;
            offset += 1;

            // Флаг VBR — старший бит.
            let vbr = (ch & 0x80) != 0;
            // Флаг наличия padding'а — бит 6.
            let has_padding = (ch & 0x40) != 0;
            // Количество кадров — младшие 6 бит.
            let m = (ch & 0x3F) as usize;

            // По RFC 6716 допустимо от 1 до 48 кадров.
            if m == 0 || m > MAX_OPUS_FRAMES {
                return Err(OpusPacketError::InvalidFrameCount(m as u8));
            }
            (m, vbr, has_padding)
        }
        // Невозможная ветка (frame_code имеет только 2 бита).
        _ => unreachable!(),
    };

    // Padding: длина в "length of length" кодировке.
    let padding_bytes = if has_padding {
        read_length(packet, &mut offset)?
    } else {
        0
    };

    // VBR: M-1 явных длин (длина последнего фрейма — остаток).
    let mut declared_sum = 0usize;
    if vbr && frame_count > 1 {
        for _ in 0..(frame_count - 1) {
            let len = read_length(packet, &mut offset)?;
            declared_sum = declared_sum
                .checked_add(len)
                .ok_or(OpusPacketError::TooLarge(usize::MAX))?;
        }
    }

    // Заголовок не должен вылезти за пределы пакета.
    if offset > packet.len() {
        return Err(OpusPacketError::TruncatedHeader);
    }
    // Доступный объём данных после заголовка.
    let available = packet.len() - offset;

    // Проверяем, что padding не превышает доступные данные.
    if padding_bytes > available {
        return Err(OpusPacketError::PaddingExceedsPacket {
            padding: padding_bytes,
            available,
        });
    }

    // Реальный объём payload без padding'а.
    let payload_bytes = available - padding_bytes;

    // VBR: после явных длин должен остаться хотя бы 1 байт на последний кадр.
    if vbr && frame_count > 1 {
        if declared_sum >= payload_bytes {
            return Err(OpusPacketError::PayloadTooShort {
                payload: payload_bytes,
                frames: frame_count,
            });
        }
    }

    // CBR: payload должен делиться на число кадров без остатка.
    if !vbr {
        if payload_bytes < frame_count {
            return Err(OpusPacketError::PayloadTooShort {
                payload: payload_bytes,
                frames: frame_count,
            });
        }
        if payload_bytes % frame_count != 0 {
            return Err(OpusPacketError::PayloadNotDivisible {
                payload: payload_bytes,
                frames: frame_count,
            });
        }
    }

    // Размер среднего фрейма не должен превышать 1275 байт.
    let per_frame_max = payload_bytes / frame_count.max(1);
    if per_frame_max > MAX_OPUS_FRAME_BYTES {
        return Err(OpusPacketError::FrameTooLarge(per_frame_max));
    }

    Ok(OpusPacketInfo {
        toc,
        frame_count,
        padding_bytes,
        payload_bytes,
    })
}