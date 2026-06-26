use bytes::{Buf, BufMut, BytesMut};
use napi::bindgen_prelude::*;
use memchr::memmem;

// ============================================================================
// LIMITS
// ============================================================================

/// Максимальный размер буфера необработанных данных (`remainder`).
/// При превышении буфер сбрасывается во избежание неконтролируемого роста.
const MAX_REMAINDER_SIZE: usize = 64 * 1024; // 64 КБ

/// Максимально допустимый размер одного Opus-пакета.
/// Пакеты большего размера считаются ошибочными и отбрасываются.
const MAX_PACKET_SIZE: usize = 4 * 1024 * 1024; // 4 МБ

// ============================================================================
// PACKET TYPES
// ============================================================================

/// Типы пакетов для OPUS, рекомендуется некоторые просто не пушить в исходное аудио
/// Для Discord - Frame, Silent. Поскольку остальные не требуются и будут откинуты, это уже потеря пакета.
#[derive(Debug, PartialEq, Copy, Clone)]
pub enum PacketType {
    Head,      // OpusHead (первые 8 байт "OpusHead", полный заголовок 19+)
    Tags,      // OpusTags (комментарии)
    Frame,     // обычный аудио фрейм
    Silent,    // специальный маркер тишины (0x80 + data)
    Broken,    // повреждённый/некорректный пакет
    End,       // 0xFF — сигнал конца потока (не Ogg end-of-stream, а наш внутренний)

    // Ogg container
    OggPage,
}

/// Выходной пакет: (тип, данные).
pub type ParsedPacket = (PacketType, bytes::Bytes);

// ============================================================================
// PARSER
// ============================================================================

/// Потоковый парсер Ogg-контейнера, извлекающий Opus-пакеты.
///
/// Реализует разбор страниц Ogg (RFC 3533) с извлечением логических
/// пакетов Opus (RFC 6716, RFC 7845). Поддерживает потоковую подачу данных,
/// корректно обрабатывая частично полученные страницы и пакеты,
/// переносимые между страницами через флаг продолжения
///
/// # Пример использования
///
/// ```ts
/// let mut parser = OggOpusParser::new();
/// let mut packets = Vec::new();
/// parser.parse_internal(&input_chunk, &mut packets)?;
/// // packets содержит (PacketType, Bytes)
/// ```
#[derive(Debug)]
pub struct OggOpusDemuxer {
    /// Буфер для накопления входных данных, не образующих полную Ogg-страницу.
    /// После обработки всех полных страниц остаток сдвигается в начало буфера.
    remainder: BytesMut,

    /// Буфер для сборки пакета, который может начинаться на одной странице
    /// и продолжаться на следующей (сегменты длиной 255 байт).
    packet_carry: Vec<u8>,

    /// Идентификатор текущего логического потока (serial number).
    /// При смене serial сбрасывается `packet_carry`, так как пакеты
    /// разных потоков не могут смешиваться.
    bitstream_serial: Option<i32>
}

impl Default for OggOpusDemuxer {
    fn default() -> Self {
        Self::new()
    }
}

impl OggOpusDemuxer {
    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /// Создаёт новый экземпляр парсера с пустыми буферами.
    ///
    /// Начальная ёмкость `remainder` — 2 КБ, `packet_carry` — 1 КБ.
    /// При необходимости буферы будут автоматически расширяться.
    pub fn new() -> Self {
        OggOpusDemuxer {
            remainder: BytesMut::with_capacity(2 * 1024),
            packet_carry: Vec::with_capacity(1024),
            bitstream_serial: None
        }
    }

    // =========================================================================
    // INFO
    // =========================================================================

    /// Возвращает суммарный объём данных, ожидающих обработки
    /// (остаток во входном буфере + незавершённый пакет).
    pub fn pending_len(&self) -> usize {
        self.remainder.len() + self.packet_carry.len()
    }

    // =========================================================================
    // PUBLIC PARSE API
    // =========================================================================

    /// Подаёт очередной фрагмент данных и помещает готовые пакеты в `output`.
    ///
    /// Если `chunk` пуст, вызывается принудительная выдача последнего
    /// накопленного пакета (`flush_internal`), что полезно при завершении потока.
    ///
    /// Каждый элемент `output` — кортеж `(PacketType, Bytes)`, где `Bytes`
    /// содержит копию данных пакета.
    pub fn parse_internal(&mut self, chunk: &[u8], output: &mut Vec<ParsedPacket>) -> Result<()> {
        // Если входящий пакет пуст
        if chunk.is_empty() { return self.flush_internal(output); }

        // Передаем на дальнейший разбор пакета
        self.parse_core(chunk, |packet_type, data| {
            output.push((packet_type, bytes::Bytes::copy_from_slice(data)));
            Ok(())
        })
    }

    // =========================================================================
    // FLUSH
    // =========================================================================

    /// Выдаёт последний собранный, но ещё не завершённый пакет.
    ///
    /// Вызывается при получении пустого чанка (EOF). Если в `packet_carry`
    /// есть данные, они интерпретируются как финальный пакет, для него
    /// определяется тип и он добавляется в выходной вектор.
    fn flush_internal(&mut self, output: &mut Vec<ParsedPacket>) -> Result<()> {
        // Если есть в буфере еще данные о последних пакетах
        if !self.packet_carry.is_empty() {
            let packet = std::mem::take(&mut self.packet_carry);
            let packet_type = Self::detect_packet_type(&packet);
            // Превращаем старый Vec в Bytes без лишнего копирования содержимого
            output.push((packet_type, bytes::Bytes::from(packet)));
        }
        Ok(())
    }

    // =========================================================================
    // CORE PARSER
    // =========================================================================

    /// Основной цикл разбора: добавляет `chunk` в `remainder` и последовательно
    /// выделяет полные Ogg-страницы, передавая их в `handle_page_core`.
    ///
    /// Для каждой страницы вызывается замыкание `on_packet`, получающее
    /// тип пакета и ссылку на данные.
    ///
    /// Если страница обработана с ошибкой, парсер пропускает 4 байта (сигнатуру
    /// "OggS") и продолжает поиск следующей страницы, что обеспечивает
    /// устойчивость к повреждённым данным.
    fn parse_core<F>(&mut self, chunk: &[u8], mut on_packet: F) -> Result<()>
    where
        F: FnMut(PacketType, &[u8]) -> Result<()>,
    {
        // put_slice работает гораздо умнее, чем extend_from_slice для Vec
        self.remainder.put_slice(chunk);

        // Защита от переполнения (бесконечный рост при битом стриме)
        if self.remainder.len() > MAX_REMAINDER_SIZE {
            self.remainder.clear();
            self.packet_carry.clear();
            return Err(Error::from_reason("Ogg parser remainder overflow"));
        }

        loop {
            if self.remainder.len() < 27 {
                break; // Не хватает даже на минимальный заголовок
            }

            // Ищем сигнатуру "OggS"
            let pos = match memmem::find(&self.remainder, b"OggS") {
                Some(pos) => pos,
                None => {
                    // Если OggS не найден, безопасно отбрасываем весь мусор,
                    // оставляя только последние 3 байта (на случай, если "OggS" разорван между фреймами)
                    if self.remainder.len() > 3 {
                        let discard_len = self.remainder.len() - 3;
                        self.remainder.advance(discard_len);
                    }
                    return Ok(());
                }
            };

            // Сдвигаем окно прямо к началу сигнатуры OggS
            if pos > 0 {
                self.remainder.advance(pos);
            }

            // Теперь remainder гарантированно начинается с "OggS"
            let segments_count = match self.remainder.get(26) {
                Some(&v) => v as usize,
                None => break,
            };

            let header_size = 27 + segments_count;
            if self.remainder.len() < header_size {
                break; // Ждём следующего чанка для загрузки таблицы сегментов
            }

            let segment_table = &self.remainder[27..header_size];
            let payload_size: usize = segment_table.iter().map(|&s| s as usize).sum();
            let page_end = header_size + payload_size;

            if self.remainder.len() < page_end {
                break; // Ждём загрузки данных (payload)
            }

            // У нас есть полная страница
            let full_page = &self.remainder[..page_end];

            // Обрабатываем. Если ошибка, пропускаем сигнатуру (4 байта), чтобы найти следующий OggS
            if Self::handle_page_core(full_page, &mut self.packet_carry, &mut self.bitstream_serial, &mut on_packet).is_err() {
                self.remainder.advance(4);
                continue;
            }

            // УСПЕХ: страница обработана. Просто "проглатываем" её из буфера за O(1)
            self.remainder.advance(page_end);
        }

        Ok(())
    }

    // =========================================================================
    // PAGE PARSER
    // =========================================================================

    /// Разбор одной полностью загруженной Ogg страницы.
    /// Алгоритм:
    /// - Читаем header_type (flags: continuation, BOS, EOS).
    /// - Извлекаем serial.
    /// - Если serial изменился → сброс carry.
    /// - Если BOS или EOS → сброс carry (по спецификации Ogg: новый поток).
    /// - Если страница НЕ является continuation (флаг 0x01 == 0) и при этом есть непустой carry —
    ///   это означает, что предыдущий пакет оборвался без флага continuation, но данные остались —
    ///   сбрасываем carry (нарушение, но мы защищаемся).
    /// - Далее итерируем по сегментам:
    ///   - Если segment_len < 255 → пакет завершён.
    ///   - Если segment_len == 255 → пакет продолжается на следующем сегменте / странице.
    /// - При каждом завершении пакета вызываем on_packet с детектированным типом.
    fn handle_page_core<F>(page: &[u8], packet_carry: &mut Vec<u8>, bitstream_serial: &mut Option<i32>, on_packet: &mut F) -> Result<()>
    where F: FnMut(PacketType, &[u8]) -> Result<()> {
        if page.len() < 27 {
            return Err(Error::from_reason("Invalid OGG page"));
        }

        let header_type = page[5];
        let continued = (header_type & 0x01) != 0;
        let bos = (header_type & 0x02) != 0;
        let eos = (header_type & 0x04) != 0;

        let serial = i32::from_le_bytes(page[14..18].try_into().map_err(|_| Error::from_reason("Invalid serial"))?);

        // Смена потока
        if *bitstream_serial != Some(serial) {
            packet_carry.clear();
            *bitstream_serial = Some(serial);
        }

        // BOS/EOS: начало или конец логического потока — сбрасываем carry (должен был быть чистым, но на всякий случай)
        if bos || eos {
            packet_carry.clear();
        }

        let segments_count = page[26] as usize;
        let segment_table = &page[27..27 + segments_count];
        let mut offset = 27 + segments_count;

        // Если эта страница не является продолжением (continued == false) и у нас есть битый фрейм из прошлых страниц,
        // значит поток повреждён (прошлый пакет не был завершён, но новая страница его не продолжает).
        // Согласно спецификации, такое не должно происходить, но для устойчивости очищаем carry.
        if !continued && !packet_carry.is_empty() {
            packet_carry.clear();
        }

        for &segment_len in segment_table {
            let segment_len = segment_len as usize;
            let end = offset + segment_len;
            let data = page.get(offset..end).ok_or_else(|| Error::from_reason("Segment out of bounds"))?;

            packet_carry.extend_from_slice(data);

            if packet_carry.len() > MAX_PACKET_SIZE {
                packet_carry.clear();
                return Err(Error::from_reason("Opus packet overflow"));
            }

            offset = end;

            // Если сегмент не максимальной длины (255), то пакет закончен.
            // Если segment_len == 255 — пакет продолжается.
            if segment_len < 255 {
                if !packet_carry.is_empty() {
                    let packet_type = Self::detect_packet_type(&packet_carry);
                    on_packet(packet_type, &packet_carry)?;
                    packet_carry.clear();
                }
            }
        }

        Ok(())
    }

    // =========================================================================
    // PACKET DETECTION
    // =========================================================================

    /// Определяет тип полученного пакета на основе его содержимого и длины.
    ///
    /// Анализирует сигнатуры и структуру согласно RFC 6716 (Opus),
    /// RFC 7845 (Opus в Ogg) и особенностям реализации Discord.
    ///
    /// Возможные возвращаемые значения:
    /// - [`PacketType::End`] — одиночный байт `0xFF` (внутренний сигнал EOF).
    /// - [`PacketType::OggPage`] — Ogg-страница (начинается с `b"OggS"`).
    /// - [`PacketType::Head`] — Opus-заголовок идентификации (`b"OpusHead"`, длина ≥ 19).
    /// - [`PacketType::Tags`] — Opus-заголовок комментариев (`b"OpusTags"`, длина ≥ 12).
    /// - [`PacketType::Silent`] — PLC-пакеты тишины Discord (`0xF8FFFE` / `0xFCFFFE`).
    /// - [`PacketType::Frame`] — валидный звуковой кадр Opus (проверен TOC).
    /// - [`PacketType::Broken`] — пакет не соответствует ни одному известному формату.
    #[inline]
    pub fn detect_packet_type(packet: &[u8]) -> PacketType {
        let len = packet.len();

        // Пустой пакет заведомо некорректен.
        if len == 0 {
            return PacketType::Broken;
        }

        // Внутренний сигнал «конец потока» – ровно один байт 0xFF.
        else if len == 1 && packet[0] == 0xFF {
            return PacketType::End;
        }

        // Ogg-страница: всегда начинается с магической последовательности "OggS".
        // Минимальная длина Ogg-страницы – 28 байт, но здесь проверяем только сигнатуру,
        // чтобы отличить от Opus-пакетов.
        else if len >= 4 && packet.starts_with(b"OggS") {
            return PacketType::OggPage;
        }

        // Opus identification header (OpusHead).
        // Должен содержать как минимум 19 байт: "OpusHead" (8 байт), версия (1),
        // количество каналов (1), pre-skip (2), sample rate (4), output gain (2),
        // mapping family (1) – итого 19.
        else if packet.starts_with(b"OpusHead") {
            return if len >= 19 {
                PacketType::Head
            } else {
                PacketType::Broken
            };
        }

        // Opus comment header (OpusTags).
        // Минимальная длина 12 байт: "OpusTags" (8 байт), vendor string length (4) = 0,
        // user comment list length (4) = 0, но фактически не может быть 0 – поэтому 12.
        else if packet.starts_with(b"OpusTags") {
            return if len >= 12 {
                PacketType::Tags
            } else {
                PacketType::Broken
            };
        }

        // Специальные пакеты тишины, используемые в Discord и кодеках с PLC.
        // Последовательности `0xF8 0xFF 0xFE` и `0xFC 0xFF 0xFE` соответствуют
        // пакетам Silence/PLC (Packet Loss Concealment).
        else if packet == [0xF8, 0xFF, 0xFE]
            || packet == [0xFC, 0xFF, 0xFE]
        {
            return PacketType::Silent;
        }

        // Проверка Opus-пакета через байт TOC (Table Of Contents).
        // Первый байт Opus-пакета всегда TOC.
        let toc = packet[0];

        // Старшие 5 бит – конфигурация (номер конфигурации Opus).
        // Допустимые значения 0..31 (RFC 6716, раздел 3.1).
        let config = toc >> 3;
        if config > 31 {
            return PacketType::Broken;
        }

        // Два младших бита – количество кадров (frame count mode).
        // 0b00 – 1 кадр, 0b01 – 2 равных кадра, 0b10 – 2 разных кадра, 0b11 – произвольное число.
        let frame_code = toc & 0b11;

        match frame_code {
            0b00 | 0b01 | 0b10 => {
                // Одиночный кадр или два кадра – всегда считаем валидным,
                // так как дальнейшие проверки длины не требуются, (Opus-пакет не может быть короче 1 байта, что уже выполнено).
                PacketType::Frame
            }
            0b11 => {
                // Код 0b11: поле count в следующем байте (младшие 6 бит) задаёт
                // количество кадров минус 1 (например, 0 означает 1 кадр).
                // Пакет должен содержать минимум 2 байта.
                if len < 2 {
                    return PacketType::Broken;
                }

                let count = packet[1] & 0x3F;

                // RFC 6716;
                if count > 0 { return PacketType::Broken; }

                PacketType::Frame
            }
            // Несуществующие комбинации 0b100..0b111 заведомо невозможны для 2-битного поля,
            // но оставим рукав для компилятора.
            4_u8..=u8::MAX => PacketType::Broken,
        }
    }

    /// Полностью очищает внутреннее состояние парсера.
    ///
    /// Полезно при переключении источника или после критической ошибки.
    pub fn cleanup(&mut self) {
        self.remainder.clear();
        self.packet_carry.clear();
        self.bitstream_serial = None;
    }
}

// ============================================================================
// DROP
// ============================================================================

impl Drop for OggOpusDemuxer {
    fn drop(&mut self) {
        self.cleanup();
    }
}