
use napi::bindgen_prelude::{ Error, Result };
use bytes::{ Buf, BufMut, BytesMut };
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
        matches!(self, Self::Frame | Self::Silent | Self::VBR | Self::PLC)
    }
}

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
    bitstream_serial: Option<u32>
}

impl Default for OggOpusDemuxer {
    fn default() -> Self {
        Self::new()
    }
}

impl OggOpusDemuxer {
    /// Создаёт новый демультиплексор с начальными буферами.
    /// `remainder` — накопительный буфер для неполных Ogg-страниц,
    /// `packet_carry` — перенос незавершённого Opus-пакета между страницами,
    /// `bitstream_serial` — идентификатор текущего логического потока.
    pub fn new() -> Self {
        Self {
            remainder: BytesMut::with_capacity(2128),
            packet_carry: Vec::with_capacity(512),
            bitstream_serial: None,
        }
    }

    /// Суммарный объём данных, ожидающих обработки:
    /// остаток во входном буфере + незавершённый пакет.
    #[inline]
    pub fn pending_len(&self) -> usize {
        self.remainder.len() + self.packet_carry.len()
    }

    /// Точка входа для разбора фрагмента данных.
    /// Если `chunk` пуст — принудительно выталкивает последний незавершённый пакет.
    /// Иначе запускает основной парсер с возвратом, копирующим данные в `output`.
    pub fn parse_internal(&mut self, chunk: &[u8], output: &mut Vec<ParsedPacket>) -> Result<()> {
        if chunk.is_empty() {
            return self.flush_internal(output);
        }

        self.parse_core(chunk, |packet_type, data| {
            output.push((packet_type, data.to_vec()));
            Ok(())
        })
    }

    /// Выдаёт последний собранный, но ещё не завершённый пакет (если есть).
    /// Вызывается при завершении потока (EOF).
    fn flush_internal(&mut self, output: &mut Vec<ParsedPacket>) -> Result<()> {
        if self.packet_carry.is_empty() {
            return Ok(());
        }

        // Забираем накопленные данные, оставляя пустой Vec.
        let packet = std::mem::take(&mut self.packet_carry);
        let packet_type = Self::detect_packet_type(&packet);

        output.push((packet_type, packet));

        Ok(())
    }

    /// Основной цикл разбора:
    /// 1. Добавляет новые данные в `remainder`.
    /// 2. Ищет сигнатуру "OggS".
    /// 3. Проверяет заголовок страницы.
    /// 4. Обрабатывает полные страницы через `handle_page_core`.
    /// 5. Удаляет обработанные байты из `remainder`.
    fn parse_core<F>(&mut self, chunk: &[u8], mut on_packet: F) -> Result<()> where
        F: FnMut(PacketType, &[u8]) -> Result<()>,
    {
        self.remainder.put_slice(chunk);

        // Защита от неограниченного роста при повреждённом входе.
        if self.remainder.len() > MAX_REMAINDER_SIZE {
            self.reset_storage();
            return Ok(());
        }

        while self.remainder.len() >= 4 {
            // Ищем следующую сигнатуру "OggS".
            let pos = match memmem::find(&self.remainder, b"OggS") {
                Some(pos) => pos,
                None => {
                    // Сигнатура не найдена: оставляем хвост в 3 байта,
                    // на случай если "OggS" разрезана пополам.
                    if self.remainder.len() > 3 {
                        let keep = 3;
                        let drop_len = self.remainder.len() - keep;
                        self.remainder.advance(drop_len);
                    }
                    break;
                }
            };

            // Отбрасываем мусор перед сигнатурой.
            if pos > 0 {
                self.remainder.advance(pos);
            }

            // Недостаточно данных для заголовка Ogg-страницы.
            if self.remainder.len() < 27 {
                break;
            }

            // Дополнительная проверка capture pattern.
            if &self.remainder[..4] != b"OggS" {
                self.remainder.advance(1);
                continue;
            }

            // Версия Ogg: должна быть 0.
            if self.remainder[4] != 0 {
                self.remainder.advance(1);
                continue;
            }

            let segments_count = self.remainder[26] as usize;
            let header_size = 27 + segments_count;

            // Ждём полную таблицу сегментов.
            if self.remainder.len() < header_size {
                break;
            }

            let segment_table = &self.remainder[27..header_size];
            let payload_size = segment_table
                .iter()
                .map(|&s| s as usize)
                .sum::<usize>();

            // Защита от переполнения при вычислении конца страницы.
            let page_end = match header_size.checked_add(payload_size) {
                Some(end) => end,
                None => {
                    self.remainder.advance(4);
                    continue;
                }
            };

            // Ждём полный payload.
            if self.remainder.len() < page_end {
                break;
            }

            let full_page = &self.remainder[..page_end];

            // Обработка страницы; при ошибке очищаем состояние переноса.
            match Self::handle_page_core(
                full_page,
                &mut self.packet_carry,
                &mut self.bitstream_serial,
                &mut on_packet,
            ) {
                Ok(()) => {
                    self.remainder.advance(page_end);
                }
                Err(_) => {
                    self.packet_carry.clear();
                    self.bitstream_serial = None;
                    self.remainder.advance(page_end);
                }
            }
        }

        Ok(())
    }

    /// Разбирает одну полностью загруженную Ogg-страницу.
    ///
    /// Проверяет:
    /// - Ogg capture pattern;
    /// - версию страницы;
    /// - зарезервированные header flags;
    /// - serial number;
    /// - continuation state;
    /// - BOS/EOS;
    /// - lacing values;
    /// - размер Opus packet.
    ///
    /// Незавершённые пакеты сохраняются в `packet_carry` и продолжаются
    /// на следующей странице.
    fn handle_page_core<F>(page: &[u8], packet_carry: &mut Vec<u8>, bitstream_serial: &mut Option<u32>, on_packet: &mut F) -> Result<()> where
        F: FnMut(PacketType, &[u8]) -> Result<()>,
    {
        // Минимальный размер Ogg page header.
        if page.len() < 27 {
            return Err(Error::from_reason("Invalid OGG page"));
        }

        // Capture pattern.
        if &page[..4] != b"OggS" {
            return Err(Error::from_reason("Invalid OGG capture pattern"));
        }

        // Ogg version.
        if page[4] != 0 {
            return Err(Error::from_reason("Unsupported OGG version"));
        }

        let header_type = page[5];

        // В Ogg используются только младшие 3 бита:
        // 0x01 = continued, 0x02 = BOS, 0x04 = EOS.
        // Остальные биты зарезервированы и должны быть нулевыми.
        if header_type & 0xF8 != 0 {
            return Err(Error::from_reason("Invalid OGG header flags"));
        }

        let continued = (header_type & 0x01) != 0;
        let bos = (header_type & 0x02) != 0;
        let eos = (header_type & 0x04) != 0;

        // Serial number.
        let serial = u32::from_le_bytes(
            page[14..18]
                .try_into()
                .map_err(|_| Error::from_reason("Invalid OGG serial"))?,
        );

        // Если это новый logical bitstream — старый незавершённый
        // packet больше не имеет отношения к новому потоку.
        if *bitstream_serial != Some(serial) {
            packet_carry.clear();
            *bitstream_serial = Some(serial);
        }

        let segments_count = page[26] as usize;
        let header_size = 27 + segments_count;

        if page.len() < header_size {
            return Err(Error::from_reason("Invalid OGG segment table"));
        }

        let segment_table = &page[27..header_size];

        // ---------------------------------------------------------------------
        // BOS
        // ---------------------------------------------------------------------

        // BOS-страница не может быть continuation.
        if bos && continued {
            return Err(Error::from_reason(
                "Invalid OGG BOS continuation",
            ));
        }

        // Если приходит BOS с незавершённым packet — состояние потока
        if bos && !packet_carry.is_empty() {
            packet_carry.clear();
            return Err(Error::from_reason(
                "OGG BOS with unfinished packet",
            ));
        }

        // ---------------------------------------------------------------------
        // CONTINUATION
        // ---------------------------------------------------------------------

        if continued {
            // Если страница объявляет продолжение, у нас обязательно
            // должен существовать packet, начатый предыдущей страницей.
            if packet_carry.is_empty() {
                return Err(Error::from_reason(
                    "OGG continuation without previous packet",
                ));
            }
        } else if !packet_carry.is_empty() {
            // Предыдущая страница закончилась segment=255, то есть packet
            // должен был продолжиться здесь, но continuation отсутствует.
            packet_carry.clear();
            return Err(Error::from_reason(
                "OGG packet continuation mismatch",
            ));
        }

        // ---------------------------------------------------------------------
        // SEGMENTS
        // ---------------------------------------------------------------------

        let mut offset = header_size;

        for &segment_len in segment_table {
            let segment_len = segment_len as usize;

            let end = offset
                .checked_add(segment_len)
                .ok_or_else(|| Error::from_reason("OGG segment overflow"))?;

            if end > page.len() {
                packet_carry.clear();
                return Err(Error::from_reason(
                    "OGG segment out of bounds",
                ));
            }

            // Проверяем размер ещё до расширения Vec.
            let new_len = packet_carry
                .len()
                .checked_add(segment_len)
                .ok_or_else(|| Error::from_reason("Opus packet overflow"))?;

            if new_len > MAX_PACKET_SIZE {
                packet_carry.clear();
                return Err(Error::from_reason(
                    "Opus packet exceeds maximum size",
                ));
            }

            if segment_len != 0 {
                packet_carry.extend_from_slice(&page[offset..end]);
            }

            offset = end;

            // segment < 255 означает конец packet.
            if segment_len < 255 {
                if !packet_carry.is_empty() {
                    let packet_type = Self::detect_packet_type(packet_carry);
                    on_packet(packet_type, packet_carry.as_slice())?;
                    packet_carry.clear();
                }
            }
        }

        // Для Ogg page payload должен полностью соответствовать
        // lacing table.
        if offset != page.len() {
            packet_carry.clear();
            return Err(Error::from_reason(
                "OGG page payload size mismatch",
            ));
        }

        // ---------------------------------------------------------------------
        // EOS
        // ---------------------------------------------------------------------

        // EOS с незавершённым packet означает обрезанный поток.
        // Проверяем ПОСЛЕ обработки всех сегментов.
        if eos && !packet_carry.is_empty() {
            packet_carry.clear();
            return Err(Error::from_reason(
                "OGG EOS with unfinished packet",
            ));
        }

        Ok(())
    }

    /// Полный сброс внутренних буферов (создание новых пустых экземпляров).
    #[inline]
    fn reset_storage(&mut self) {
        self.remainder = BytesMut::new();
        self.packet_carry = Vec::new();
        self.bitstream_serial = None;
    }

    /// Очищает все внутренние данные (вызывает reset_storage).
    pub fn cleanup(&mut self) {
        self.reset_storage();
    }

    /// Определяет тип пакета на основе его содержимого и длины.
    ///
    /// Поддерживает:
    /// - RFC 6716 (Opus Audio Codec)
    /// - Ogg контейнер
    /// - Discord PLC (Packet Loss Concealment) маркеры
    #[inline]
    pub fn detect_packet_type(packet: &[u8]) -> PacketType {
        let len = packet.len();

        if len == 0 {
            return PacketType::Broken;
        }

        // Одиночный байт 0xFF — внутренний маркер конца потока
        if len == 1 && packet[0] == 0xFF {
            return PacketType::End;
        }

        // Ogg-страница
        if len >= 4 && packet.starts_with(b"OggS") {
            return PacketType::OggPage;
        }

        // Opus identification header (OpusHead)
        // RFC 6716: минимум 19 байт
        if packet.starts_with(b"OpusHead") {
            return if len >= 19 {
                PacketType::Head
            } else {
                PacketType::Broken
            };
        }

        // Opus comment header (OpusTags)
        // RFC 6716: минимум 12 байт
        if packet.starts_with(b"OpusTags") {
            return if len >= 12 {
                PacketType::Tags
            } else {
                PacketType::Broken
            };
        }

        // Discord PLC маркеры
        match packet {
            [0xFC, 0xFF, 0xFE] => return PacketType::PLC,
            [0xF8, 0xFF, 0xFE] => return PacketType::Silent,
            _ => {}
        }

        // Байт TOC.
        let toc = packet[0];

        // Бит 5: stereo флаг (0 = mono, 1 = stereo)
        let _stereo = (toc >> 2) & 1 != 0;

        // Младшие 2 бита: код количества фреймов
        let frame_code = toc & 0b11;

        // Два младших бита — количество кадров.
        match frame_code {
            // Code 0: 1 фрейм
            0b00 => PacketType::Frame,

            // Code 1: 2 фрейма равного размера
            0b01 => PacketType::Frame,

            // Code 2: 2 фрейма разного размера (VBR)
            0b10 => PacketType::VBR,

            // Произвольное количество кадров: требуется дополнительный байт.
            0b11 => {
                if len < 2 {
                    return PacketType::Broken;
                }

                let ch = packet[1];
                // Младшие 6 бит — количество кадров.
                let frame_count = ch & 0x3F;

                // RFC 6716: максимум 48 кадров в стандарте
                if frame_count == 0 || frame_count > 48 {
                    return PacketType::Broken;
                }

                PacketType::Frame
            }

            // Остальные комбинации невозможны для 2-битного поля.
            _ => PacketType::Broken,
        }
    }
}

// ============================================================================
// DROP
// ============================================================================

impl Drop for OggOpusDemuxer {
    fn drop(&mut self) {
        self.cleanup();

        #[cfg(debug_assertions)]
        println!(
            "OggOpusDemuxer drop | remainder={} cap={} | packet={} cap={}",
            self.remainder.len(),
            self.remainder.capacity(),
            self.packet_carry.len(),
            self.packet_carry.capacity(),
        );
    }
}