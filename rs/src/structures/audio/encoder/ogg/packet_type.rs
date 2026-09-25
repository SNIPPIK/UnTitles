use crate::structures::audio::encoder::ogg::opus_specification::{
    OpusPacketError, OpusPacketInfo, OpusToc,
    MAX_OPUS_FRAMES, MAX_OPUS_FRAME_BYTES,
};

/// Тип разобранного пакета.
///
/// Используется на уровне audio pipeline для решения, что делать
/// с содержимым: передать в декодер, отбросить, обработать как служебный.
#[derive(Debug, PartialEq, Copy, Clone)]
pub enum PacketType {
    /// Описание аудиопотока (OpusHead).
    Head,
    /// Метаданные (OpusTags).
    Tags,
    /// Повреждённый или нераспознанный пакет.
    Broken,
    /// Внутренний маркер конца потока (0xFF).
    End,
    /// Страница Ogg-контейнера.
    OggPage,

    /// Обычный CBR Opus packet.
    Frame,

    /// Discord silence marker.
    Silent,

    /// Discord PLC marker.
    PLC,

    /// VBR Opus packet.
    VBR
}

/// Готовый пакет: тип и его содержимое.
pub type ParsedPacket = (PacketType, Vec<u8>);

impl PacketType {
    /// Проверяет, является ли тип пригодным для audio pipeline.
    ///
    /// В текущей реализации `End` и `Head` тоже считаются аудио-совместимыми:
    /// первый — как маркер завершения, второй — как префикс потока,
    /// который должен пройти через pipeline до появления первых фреймов.
    #[inline(always)]
    pub const fn is_audio_frame(self) -> bool {
        matches!(self,
            Self::Frame
                | Self::Silent
                | Self::VBR
                | Self::PLC
                | Self::Head
                | Self::OggPage
        )
    }

    /// Определяет тип пакета.
    ///
    /// Порядок проверок специально построен от самых дешёвых случаев
    /// к более дорогому Opus parser:
    ///
    /// 1. Пустой пакет / специальные короткие маркеры.
    /// 2. Ogg / Opus headers.
    /// 3. Полный Opus packet parser.
    ///
    /// Такой порядок позволяет на большинстве валидных аудио-пакетов
    /// не заходить в `parse_opus_packet`.
    #[inline]
    pub fn detect_packet_type(packet: &[u8]) -> PacketType {
        match packet {
            // Пустой пакет — заведомо повреждённый.
            [] => PacketType::Broken,

            // Внутренний маркер конца потока.
            [0xFF] => PacketType::End,

            // Discord PLC.
            [0xFC, 0xFF, 0xFE] => PacketType::Silent,

            // Discord silence.
            [0xF8, 0xFF, 0xFE] => PacketType::PLC,

            // Ogg page.
            _ if packet.starts_with(b"OggS") => PacketType::OggPage,

            // Opus identification header.
            // Минимально валидный OpusHead — 19 байт (см. RFC 7845).
            _ if packet.starts_with(b"OpusHead") => {
                if packet.len() >= 8 {
                    PacketType::Head
                } else {
                    PacketType::Broken
                }
            }

            // Opus comment header.
            // Минимально валидный OpusTags — 12 байт (пустой vendor + пустой список).
            _ if packet.starts_with(b"OpusTags") => {
                if packet.len() >= 8 {
                    PacketType::Tags
                } else {
                    PacketType::Broken
                }
            }

            // Всё остальное пытаемся разобрать как Opus.
            _ => match parse_opus_packet(packet) {
                // Успешный разбор с флагом VBR.
                Ok(info) if info.vbr => PacketType::VBR,
                // Обычный CBR-пакет.
                Ok(_) => PacketType::Frame,
                // Разбор не удался — считаем пакет повреждённым.
                Err(_) => PacketType::Broken,
            },
        }
    }
}

/// Читает Opus length field.
///
/// Формат (RFC 6716 §3.2.1):
///
/// ```text
/// < 255
///     значение = byte0
///
/// 255 <byte1 != 255>
///     значение = 255 + byte1
///
/// 255 255 <byte2 != 255>
///     значение = 510 + byte2
///
/// 255 255 255
///     invalid
/// ```
///
/// Развёрнуто вручную вместо цикла, поскольку здесь максимум 3 итерации.
///
/// Это находится на hot path VBR packet parser'а.
///
/// # Аргументы
/// * `packet` — исходный буфер пакета.
/// * `offset` — текущая позиция чтения, увеличивается по мере чтения.
///
/// # Ошибки
/// * `TruncatedLengthField` — данные закончились раньше конца поля.
/// * `InvalidLengthField` — все три байта равны 255 (недопустимо по RFC).
#[inline(always)]
fn read_length(packet: &[u8], offset: &mut usize) -> Result<usize, OpusPacketError> {
    // ------------------------------------------------------------------------
    // Первый байт
    // ------------------------------------------------------------------------

    let b0 = *packet
        .get(*offset)
        .ok_or(OpusPacketError::TruncatedLengthField)?;

    *offset += 1;

    // Первый байт не 255 — значение сразу известно.
    if b0 != 255 {
        return Ok(b0 as usize);
    }

    // ------------------------------------------------------------------------
    // Второй байт
    // ------------------------------------------------------------------------

    let b1 = *packet
        .get(*offset)
        .ok_or(OpusPacketError::TruncatedLengthField)?;

    *offset += 1;

    if b1 != 255 {
        return Ok(255 + b1 as usize);
    }

    // ------------------------------------------------------------------------
    // Третий байт
    // ------------------------------------------------------------------------

    let b2 = *packet
        .get(*offset)
        .ok_or(OpusPacketError::TruncatedLengthField)?;

    *offset += 1;

    if b2 != 255 {
        return Ok(510 + b2 as usize);
    }

    // Все три байта — 255. Согласно RFC это недопустимая последовательность.
    Err(OpusPacketError::InvalidLengthField)
}

/// Разбирает Opus packet.
///
/// Проверяет:
///
/// - TOC;
/// - количество frames;
/// - VBR/CBR;
/// - padding;
/// - размер каждого отдельного Opus frame;
/// - соответствие всех frame payload фактическому размеру packet.
///
/// ВАЖНО:
/// `MAX_OPUS_FRAME_BYTES` применяется к ОТДЕЛЬНОМУ frame.
///
/// Opus packet с несколькими frames закономерно может быть больше 1275 байт.
///
/// # Аргументы
/// * `packet` — полный пакет, начиная с TOC-байта.
///
/// # Возвращаемое значение
/// `OpusPacketInfo { vbr }` — минимально необходимая информация
/// для вызывающего кода. Остальные поля (размеры, padding) не выносятся
/// наружу, поскольку не используются ни в `detect_packet_type`,
/// ни в вызывающем pipeline.
///
/// # Ошибки
/// `OpusPacketError` при любом несоответствии RFC.
#[inline]
pub fn parse_opus_packet(packet: &[u8]) -> Result<OpusPacketInfo, OpusPacketError> {
    let packet_len = packet.len();

    // Пустой пакет — невалиден.
    if packet_len == 0 {
        return Err(OpusPacketError::Empty);
    }

    // ------------------------------------------------------------------------
    // TOC
    // ------------------------------------------------------------------------

    let toc = OpusToc::parse(packet[0]);
    // Смещение сразу после TOC.
    let mut offset = 1usize;

    // ------------------------------------------------------------------------
    // Frame configuration
    // ------------------------------------------------------------------------

    // Разбираем frame code и определяем параметры пакета.
    let (frame_count, vbr, has_padding) = match toc.frame_code {
        // Один кадр.
        0 => (1, false, false),

        // Два равных кадра.
        1 => (2, false, false),

        // Два кадра разного размера.
        2 => (2, true, false),

        // Произвольное число кадров — читаем дополнительный байт.
        3 => {
            let ch = *packet
                .get(offset)
                .ok_or(OpusPacketError::TruncatedHeader)?;

            offset += 1;

            // Младшие 6 бит — количество кадров.
            let frame_count = (ch & 0x3F) as usize;

            // 0 кадров недопустимо, > 48 тоже (RFC 6716).
            if frame_count == 0 || frame_count > MAX_OPUS_FRAMES {
                return Err(
                    OpusPacketError::InvalidFrameCount(
                        frame_count as u8,
                    )
                );
            }

            (
                frame_count,
                // Старший бит — VBR.
                (ch & 0x80) != 0,
                // Бит 6 — padding.
                (ch & 0x40) != 0,
            )
        }

        // `OpusToc` не должен возвращать иных значений.
        _ => {
            return Err(OpusPacketError::TruncatedHeader);
        }
    };

    // ------------------------------------------------------------------------
    // Padding
    // ------------------------------------------------------------------------

    // Длина padding'а хранится в length-кодировке, читается только при флаге.
    let padding_bytes = if has_padding {
        read_length(packet, &mut offset)?
    } else {
        0
    };

    // Заголовок + padding должны уместиться в пакет.
    let remaining = packet_len
        .checked_sub(offset)
        .ok_or(OpusPacketError::TruncatedHeader)?;

    // Padding не должен превышать доступный объём данных.
    if padding_bytes > remaining {
        return Err(OpusPacketError::TruncatedHeader);
    }

    // Реальный размер payload = доступное минус padding.
    let payload_bytes = remaining - padding_bytes;

    // Пустой payload невозможен.
    if payload_bytes == 0 {
        return Err(
            OpusPacketError::PayloadTooShort {
                payload: 0,
                frames: frame_count,
            }
        );
    }

    // ------------------------------------------------------------------------
    // Frame payload
    // ------------------------------------------------------------------------

    if vbr {
        // В VBR явно задаются длины всех кадров, кроме последнего.
        parse_vbr_frames(
            packet,
            &mut offset,
            frame_count,
            payload_bytes,
        )?;
    } else {
        // В CBR достаточно проверить делимость payload на число кадров.
        parse_cbr_frames(
            frame_count,
            payload_bytes,
        )?;
    }

    Ok(OpusPacketInfo { vbr })
}

/// Проверяет VBR packet.
///
/// В VBR размер всех frames, кроме последнего, хранится явно.
/// Размер последнего frame получается как остаток payload.
///
/// Например:
///
/// ```text
/// frame 0 = 100
/// frame 1 = 200
/// frame 2 = остаток
/// ```
///
/// # Аргументы
/// * `packet` — исходный пакет.
/// * `offset` — позиция чтения в пакете.
/// * `frame_count` — общее число кадров.
/// * `payload_bytes` — суммарный размер payload без padding'а.
///
/// # Ошибки
/// * `InvalidFrameSize` — размер отдельного кадра 0 или превышает лимит.
/// * `TooLarge` — переполнение при сложении размеров.
/// * `PayloadMismatch` — сумма объявленных размеров превысила payload.
#[inline(always)]
fn parse_vbr_frames(packet: &[u8], offset: &mut usize, frame_count: usize, payload_bytes: usize) -> Result<(), OpusPacketError> {
    // Последний frame не имеет отдельного length field:
    // он занимает весь оставшийся payload.
    let declared_count = frame_count - 1;

    let mut declared_sum = 0usize;

    // ------------------------------------------------------------------------
    // Все frames кроме последнего
    // ------------------------------------------------------------------------

    for _ in 0..declared_count {
        // Читаем размер очередного кадра.
        let frame_size = read_length(packet, offset)?;

        // Размер кадра должен быть положительным и не превышать лимит RFC.
        if frame_size == 0 || frame_size > MAX_OPUS_FRAME_BYTES {
            return Err(
                OpusPacketError::InvalidFrameSize(frame_size)
            );
        }

        // Накапливаем сумму с проверкой переполнения.
        let Some(new_sum) = declared_sum.checked_add(frame_size)
        else {
            return Err(
                OpusPacketError::TooLarge(usize::MAX)
            );
        };

        // Сумма объявленных размеров не должна превышать payload.
        if new_sum > payload_bytes {
            return Err(
                OpusPacketError::PayloadMismatch {
                    expected: new_sum,
                    actual: payload_bytes,
                }
            );
        }

        declared_sum = new_sum;
    }

    // ------------------------------------------------------------------------
    // Последний frame
    // ------------------------------------------------------------------------

    // Всё, что осталось после объявленных кадров, — последний кадр.
    let last_frame_size = payload_bytes - declared_sum;

    if last_frame_size == 0 {
        return Err(
            OpusPacketError::InvalidFrameSize(last_frame_size)
        );
    }

    if last_frame_size > MAX_OPUS_FRAME_BYTES {
        return Err(
            OpusPacketError::InvalidFrameSize(last_frame_size)
        );
    }

    Ok(())
}

/// Проверяет CBR packet.
///
/// Все frames имеют одинаковый размер:
///
/// ```text
/// payload / frame_count
/// ```
///
/// Поэтому достаточно одного деления и проверки остатка.
///
/// # Аргументы
/// * `frame_count` — число кадров в пакете.
/// * `payload_bytes` — суммарный размер payload без padding'а.
///
/// # Ошибки
/// * `PayloadNotDivisible` — payload не делится на число кадров без остатка.
/// * `InvalidFrameSize` — размер кадра 0 или превышает лимит.
#[inline(always)]
fn parse_cbr_frames(frame_count: usize, payload_bytes: usize) -> Result<(), OpusPacketError> {
    // Для CBR payload должен делиться на число кадров без остатка.
    if payload_bytes % frame_count != 0 {
        return Err(
            OpusPacketError::PayloadNotDivisible {
                payload: payload_bytes,
                frames: frame_count,
            }
        );
    }

    // Размер одного кадра.
    let frame_size = payload_bytes / frame_count;

    // Нулевой кадр недопустим.
    if frame_size == 0 {
        return Err(
            OpusPacketError::InvalidFrameSize(frame_size)
        );
    }

    // Размер кадра не должен превышать лимит RFC.
    if frame_size > MAX_OPUS_FRAME_BYTES {
        return Err(
            OpusPacketError::InvalidFrameSize(frame_size)
        );
    }

    Ok(())
}