use crate::structures::audio::encoder::ogg::opus_specification::{
    OpusPacketError, OpusPacketInfo, OpusToc,
    MAX_OPUS_FRAMES, MAX_OPUS_FRAME_BYTES
};

/// Максимально допустимая длина length-поля (RFC 6716 §3.2.1).
const MAX_LENGTH_FIELD_BYTES: usize = 3;

/// Типы пакетов для OPUS. Рекомендуется часть из них не отправлять в аудио-буфер.
/// Для Discord актуальны `Frame` и `Silent`; остальные типы не требуются
/// и будут отброшены (потеря пакета).
#[derive(Debug, PartialEq, Copy, Clone)]
pub enum PacketType {
    /// Заголовок идентификации Opus (OpusHead).
    Head,
    /// Заголовок комментариев Opus (OpusTags).
    Tags,

    /// Обычный Opus-аудиофрейм.
    Frame,
    /// Специальный маркер тишины.
    Silent,
    /// Packet Loss Concealment — пакет восстановления потерь.
    PLC,
    /// Пакет/фрейм с переменным битрейтом (VBR).
    VBR,

    /// Повреждённый или некорректный пакет.
    Broken,
    /// Внутренний маркер конца потока (0xFF).

    End,

    /// Страница Ogg-контейнера.
    OggPage
}

/// Выходной пакет: кортеж из типа и данных.
pub type ParsedPacket = (PacketType, Vec<u8>);

impl PacketType {
    /// Проверяет, относится ли тип пакета к обрабатываемым аудио фреймам.
    ///
    /// Возвращает `true` для одного из:
    /// - `Frame` — обычный Opus-фрейм;
    /// - `VBR` — фрейм с переменным битрейтом;
    /// - `Silent` — пакет тишины;
    /// - `PLC` — пакет восстановления потерь.
    ///
    /// Такие пакеты должны передаваться в аудио-декодер или буфер,
    /// в отличие от служебных (`Head`, `Tags`, `OggPage` и т.п.).
    pub fn is_audio_frame(self) -> bool {
        matches!(self, Self::Frame | Self::VBR | Self::Silent)
    }

    /// Определяет тип пакета по его содержимому и длине.
    ///
    /// Поддерживает:
    /// - RFC 6716 (Opus Audio Codec);
    /// - Ogg-контейнер;
    /// - Discord PLC (Packet Loss Concealment) маркеры.
    ///
    /// # Аргументы
    /// * `packet` — байтовый срез пакета.
    ///
    /// # Возвращаемое значение
    /// Вариант [`PacketType`], соответствующий распознанному формату.
    pub fn detect_packet_type(packet: &[u8]) -> PacketType {
        match packet {
            // Пустой пакет — некорректен.
            [] => PacketType::Broken,

            // Внутренний маркер конца потока.
            [0xFF] => PacketType::End,

            // Discord PLC / silence маркеры.
            [0xFC, 0xFF, 0xFE] => PacketType::PLC,
            [0xF8, 0xFF, 0xFE] => PacketType::Silent,

            // Страница Ogg-контейнера.
            _ if packet.len() >= 4 && packet.starts_with(b"OggS") => {
                PacketType::OggPage
            }

            // Заголовок идентификации Opus.
            _ if packet.starts_with(b"OpusHead") => {
                if packet.len() >= 19 {
                    PacketType::Head
                } else {
                    PacketType::Broken
                }
            }

            // Заголовок комментариев Opus.
            _ if packet.starts_with(b"OpusTags") => {
                if packet.len() >= 12 {
                    PacketType::Tags
                } else {
                    PacketType::Broken
                }
            }

            // Во всех остальных случаях пытаемся разобрать как Opus-пакет.
            _ => match parse_opus_packet(packet) {
                // Успешный разбор с флагом VBR.
                Ok(info) if info.vbr => PacketType::VBR,
                // Успешный разбор обычного фрейма.
                Ok(_) => PacketType::Frame,
                // Разбор не прошёл — считаем пакет повреждённым.
                Err(_) => PacketType::Broken,
            },
        }
    }
}

/// Читает length-поле Opus согласно RFC 6716 §3.2.1.
///
/// В packet framing Opus размер некоторых структур кодируется
/// последовательностью байт. Значение `255` означает, что поле
/// продолжается следующим байтом, а любое значение меньше `255`
/// завершает поле.
///
/// Поэтому итоговое значение вычисляется как сумма всех прочитанных
/// байт:
///
/// ```text
/// 255 + 255 + 100 = 610
/// ```
///
/// Ограничение `MAX_LENGTH_FIELD_BYTES` не является частью арифметики
/// длины как таковой. Это защитная граница парсера, предотвращающая
/// бесконечный или чрезмерно длинный malformed length field.
///
/// Функция намеренно работает непосредственно с исходным packet buffer
/// и не создаёт временных структур или аллокаций.
///
/// # Arguments
///
/// * `packet` — полный входной Opus-пакет.
/// * `offset` — текущая позиция чтения. При успешном чтении указатель
///   перемещается за пределы обработанного length-поля.
///
/// # Returns
///
/// Возвращает суммарное значение length-поля.
///
/// # Errors
///
/// * [`OpusPacketError::TruncatedLengthField`] — пакет закончился
///   до завершения length-поля.
/// * [`OpusPacketError::TooLarge`] — произошло переполнение `usize`
///   при накоплении длины.
/// * [`OpusPacketError::InvalidLengthField`] — поле превысило
///   установленное внутреннее ограничение по количеству байт.
#[inline]
fn read_length(packet: &[u8], offset: &mut usize) -> Result<usize, OpusPacketError> {
    let mut total = 0usize;

    // Ограничиваем количество байт, которое функция имеет право
    // прочитать для одного length-поля.
    //
    // Это дополнительная защита от повреждённого или намеренно
    // сформированного пакета с бесконечной последовательностью `255`.
    for _ in 0..MAX_LENGTH_FIELD_BYTES {
        // Получаем текущий байт.
        //
        // Использование `.get()` вместо прямого индексирования
        // гарантирует отсутствие panic при обрезанном packet buffer.
        let byte = *packet
            .get(*offset)
            .ok_or(OpusPacketError::TruncatedLengthField)?;

        // Перемещаем позицию чтения сразу после потреблённого байта.
        *offset += 1;

        // Length кодируется суммой последовательных значений.
        //
        // checked_add() нужен не столько для обычного Opus-пакета,
        // сколько как дополнительная гарантия безопасности при работе
        // с потенциально повреждённым или искусственно сформированным
        // входом.
        total = total
            .checked_add(byte as usize)
            .ok_or(OpusPacketError::TooLarge(usize::MAX))?;

        // Значение меньше 255 завершает length-поле.
        //
        // Значение 255 означает "продолжение", поэтому цикл должен
        // перейти к чтению следующего байта.
        if byte != 255 {
            return Ok(total);
        }
    }

    // Все разрешённые байты были `255`, но завершающего байта
    // так и не встретилось.
    Err(OpusPacketError::InvalidLengthField)
}

/// Выполняет строгий структурный разбор Opus-пакета
/// согласно RFC 6716 §3.2.
///
/// Функция занимается исключительно packet framing:
///
/// ```text
/// raw Opus bytes
///       │
///       ▼
///      TOC
///       │
///       ├── frame code
///       ├── frame count
///       ├── VBR / CBR
///       └── padding
///              │
///              ▼
///       frame boundaries
///              │
///              ▼
///       OpusPacketInfo
/// ```
///
/// Декодирование Opus здесь не выполняется.
///
/// Аналогично функция не занимается RTP, UDP, Discord Voice,
/// FFmpeg или PCM. Это позволяет использовать parser независимо
/// от транспортного слоя.
///
/// Проверяются:
///
/// * наличие TOC;
/// * допустимость frame code;
/// * количество кадров;
/// * наличие и размер padding;
/// * VBR length fields;
/// * границы frame payload;
/// * размер каждого кадра;
/// * CBR/VBR packet structure;
/// * итоговая согласованность размера пакета.
///
/// Функция не выполняет heap allocation и не копирует содержимое
/// входного packet.
///
/// # Arguments
///
/// * `packet` — полный Opus packet без RTP-заголовка.
///
/// # Returns
///
/// Возвращает [`OpusPacketInfo`] с уже разобранной структурой
/// packet framing.
///
/// # Errors
///
/// Возвращает [`OpusPacketError`] при любом нарушении структуры
/// пакета или внутренних ограничений parser-а.
#[inline]
pub fn parse_opus_packet(packet: &[u8]) -> Result<OpusPacketInfo, OpusPacketError> {
    let packet_len = packet.len();

    // Выполняем самые дешёвые проверки до любого структурного разбора.
    //
    // Пустой packet не содержит даже TOC.
    //
    // Слишком большой packet сразу отбрасывается как выходящий
    // за внутреннюю границу parser-а.
    match packet_len {
        0 => return Err(OpusPacketError::Empty),
        sz if sz > MAX_OPUS_FRAME_BYTES => {
            return Err(OpusPacketError::TooLarge(sz));
        }
        _ => {}
    }

    // Первый байт любого Opus packet — TOC.
    //
    // Здесь он уже гарантированно существует, поскольку выше
    // проверено packet_len != 0.
    let toc = OpusToc::parse(packet[0]);

    // Позиция следующего непрочитанного байта.
    //
    // После TOC она начинается с offset = 1.
    let mut offset = 1;

    // Из frame code определяем:
    //
    // * количество кадров;
    // * используется ли VBR;
    // * присутствует ли padding.
    //
    // Это центральная точка packet framing: дальнейший разбор
    // полностью зависит от полученной структуры.
    let (frame_count, vbr, has_padding) = match toc.frame_code {
        // Один frame, размер определяется оставшимся payload.
        00 => (1, false, false),

        // Два frame с одинаковым размером.
        01 => (2, false, false),

        // Два frame с индивидуальными размерами.
        10 => (2, true, false),

        // Специальная структура:
        //
        // следующий байт содержит:
        //
        // bit 7 — VBR
        // bit 6 — padding
        // bit 5..0 — количество frames
        11 => {
            // Для чтения frame-count byte должен существовать
            // хотя бы ещё один байт после TOC.
            if offset >= packet_len {
                return Err(OpusPacketError::TruncatedHeader);
            }

            let ch = packet[offset];
            offset += 1;

            // Младшие 6 бит содержат количество кадров.
            let frame_count = (ch & 0x7F) as usize;

            // Zero frames недопустимы, а parser дополнительно
            // ограничивает количество кадров внутренним максимумом.
            if frame_count == 0 || frame_count > MAX_OPUS_FRAMES {
                return Err(OpusPacketError::InvalidFrameCount(
                    frame_count as u8
                ));
            }

            // Bit 7: VBR flag.
            //
            // true означает, что размеры frames будут явно
            // указаны в packet.
            //
            // false означает CBR-раскладку.
            //
            // Bit 6: padding flag.
            //
            // При его наличии после frame payload находится
            // дополнительный padding, размер которого кодируется
            // отдельным length-полем.
            (
                frame_count,
                (ch & 0x80) != 0,
                (ch & 0x40) != 0,
            )
        }

        // frame_code занимает ровно два бита, поэтому других
        // значений существовать не может.
        _ => (3, false, false)
    };

    // Если packet содержит padding, сначала считываем его размер.
    //
    // Padding располагается в конце packet и не является частью
    // аудио frames, поэтому его необходимо исключить из payload
    // до расчёта frame sizes.
    let padding_bytes = if has_padding {
        read_length(packet, &mut offset)?
    } else {
        0
    };

    // После чтения служебных полей offset не должен выйти
    // за границу packet.
    //
    // Также padding должен физически помещаться в оставшийся
    // packet buffer.
    if offset > packet_len
        || padding_bytes > packet_len - offset
    {
        return Err(OpusPacketError::TruncatedHeader);
    }

    // Всё, что осталось между текущей позицией и padding,
    // является непосредственно frame payload.
    //
    // Важно: padding уже исключён и не участвует в расчёте
    // размеров Opus frames.
    let payload_bytes =
        packet_len - offset - padding_bytes;

    // Даже один frame должен содержать данные.
    //
    // Отдельно от этого CBR/VBR parser проверит конкретный
    // допустимый размер frame.
    if payload_bytes == 0 {
        return Err(OpusPacketError::PayloadTooShort {
            payload: 0,
            frames: frame_count,
        });
    }

    // Теперь разбираем непосредственно frame payload.
    //
    // VBR требует чтения length fields для frames.
    //
    // CBR не содержит отдельных length fields:
    // размер определяется делением общего payload на количество frames.
    if vbr {
        parse_vbr_frames(
            packet,
            &mut offset,
            frame_count,
            payload_bytes,
        )?;
    } else {
        parse_cbr_frames(frame_count, payload_bytes)?;
    }

    // Финальная проверка согласованности.
    //
    // Здесь offset уже указывает на границу frame metadata/payload,
    // поэтому к нему добавляются:
    //
    // * фактический frame payload;
    // * padding.
    //
    // Результат должен точно совпасть с размером исходного packet.
    let expected_packet_size = offset
        .checked_add(payload_bytes)
        .and_then(|size| size.checked_add(padding_bytes))
        .ok_or(OpusPacketError::TooLarge(usize::MAX))?;

    if expected_packet_size != packet_len {
        return Err(OpusPacketError::PacketSizeMismatch {
            expected: expected_packet_size,
            actual: packet_len,
        });
    }

    // Все структурные проверки пройдены.
    //
    // Возвращаем компактное описание packet-а без копирования
    // исходных bytes.
    Ok(OpusPacketInfo {
        /*toc,
        frame_count,
        padding_bytes,
        payload_bytes,*/
        vbr,
    })
}

/// Разбирает размеры кадров VBR-пакета.
///
/// В VBR packet размеры первых `N - 1` кадров записаны
/// непосредственно перед frame payload в виде length fields.
///
/// Размер последнего кадра отдельно не хранится:
///
/// ```text
/// last_frame = payload_size - sum(previous_frames)
/// ```
///
/// Это позволяет избежать отдельного length field для последнего
/// кадра и одновременно даёт возможность проверить, что все
/// объявленные размеры действительно помещаются в packet.
///
/// Функция не извлекает сами frames и не копирует их данные.
/// Она только проверяет корректность их границ.
///
/// # Arguments
///
/// * `packet` — исходный Opus packet.
/// * `offset` — текущая позиция чтения metadata.
/// * `frame_count` — количество frames.
/// * `payload_bytes` — общий размер frame payload после исключения
///   padding.
#[inline]
fn parse_vbr_frames(packet: &[u8], offset: &mut usize, frame_count: usize, payload_bytes: usize) -> Result<(), OpusPacketError> {
    // Накапливаем размеры всех frames, кроме последнего.
    //
    // Последний frame вычисляется как остаток payload.
    let mut declared_sum = 0usize;

    // Последний frame не имеет собственного length field.
    let last_idx = frame_count - 1;

    // Читаем length field только для первых N - 1 frames.
    for _ in 0..last_idx {
        let frame_size = read_length(packet, offset)?;

        // Нулевой frame не содержит аудиоданных.
        //
        // Также запрещаем frame, превышающий максимально допустимый
        // размер одного Opus frame.
        if frame_size == 0
            || frame_size > MAX_OPUS_FRAME_BYTES
        {
            return Err(OpusPacketError::InvalidFrameSize(frame_size));
        }

        // Суммируем уже объявленные frame sizes.
        //
        // checked_add() гарантирует отсутствие integer overflow
        // даже при повреждённом input.
        declared_sum = declared_sum
            .checked_add(frame_size)
            .ok_or(OpusPacketError::TooLarge(usize::MAX))?;
    }

    // Размер последнего frame не записан явно.
    //
    // Он определяется как оставшаяся часть payload после
    // всех предыдущих frames.
    let last_frame_size = payload_bytes
        .checked_sub(declared_sum)
        .ok_or(OpusPacketError::PayloadMismatch {
            expected: declared_sum,
            actual: payload_bytes,
        })?;

    // Проверяем последний frame теми же ограничениями.
    //
    // Если declared_sum оказался больше payload, checked_sub()
    // уже вернул ошибку выше.
    if last_frame_size == 0
        || last_frame_size > MAX_OPUS_FRAME_BYTES
    {
        return Err(OpusPacketError::InvalidFrameSize(
            last_frame_size,
        ));
    }

    Ok(())
}

/// Проверяет размеры кадров CBR-пакета.
///
/// В CBR каждый frame имеет одинаковый размер, поэтому отдельные
/// length fields отсутствуют.
///
/// Размер одного frame вычисляется напрямую:
///
/// ```text
/// frame_size = payload_bytes / frame_count
/// ```
///
/// Для корректного CBR packet-а payload обязан делиться на количество
/// frames без остатка.
///
/// Функция не изменяет packet и не извлекает аудиоданные.
#[inline]
fn parse_cbr_frames(frame_count: usize, payload_bytes: usize) -> Result<(), OpusPacketError> {
    // Все frames должны иметь одинаковый размер.
    //
    // Если деление даёт остаток, packet физически невозможно
    // разбить на одинаковые frames.
    if payload_bytes % frame_count != 0 {
        return Err(OpusPacketError::PayloadNotDivisible {
            payload: payload_bytes,
            frames: frame_count,
        });
    }

    // Теперь деление гарантированно даёт целое значение.
    let frame_size = payload_bytes / frame_count;

    // Проверяем нижнюю и верхнюю границы одного frame.
    //
    // Нулевой размер невозможен, а превышение
    // MAX_OPUS_FRAME_BYTES нарушает ограничение формата.
    if frame_size == 0
        || frame_size > MAX_OPUS_FRAME_BYTES
    {
        return Err(OpusPacketError::InvalidFrameSize(frame_size));
    }

    Ok(())
}