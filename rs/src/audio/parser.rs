use bytes::{Buf, BufMut, BytesMut};
use napi::bindgen_prelude::*;
use memchr::memmem;

// ============================================================================
// LIMITS
// ============================================================================

/// Максимальный размер буфера необработанных данных (remainder).
/// Если накопилось > 8 MiB — поток битый (нет синхронизации OggS).
/// Защита от бесконечного роста памяти.
const MAX_REMAINDER_SIZE: usize = 8 * 1024 * 1024;

/// Максимальный размер собираемого Opus пакета.
/// Opus фреймы обычно до ~1275 байт, но в Ogg они могут быть составными.
/// Защита от переполнения из-за битой таблицы сегментов (например, chain of 255).
const MAX_PACKET_SIZE: usize = 1024 * 1024;  // 1 MiB — запас для "злых" потоков

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
    End        // 0xFF — сигнал конца потока (не Ogg end-of-stream, а наш внутренний)
}

/// Выходной пакет: (тип, данные).
pub type ParsedPacket = (PacketType, Vec<u8>);

// ============================================================================
// PARSER
// ============================================================================

/// Streaming Ogg Opus parser.
pub struct OggOpusParser {
    /// Неполные входные данные, которые не удалось обработать за прошлый раз (нет полной страницы).
    remainder: BytesMut,

    /// Буфер текущего собираемого пакета (может быть начат на одной странице и продолжиться на следующей).
    packet_carry: Vec<u8>,

    /// Serial number текущего логического потока (первые 4 байта страницы).
    /// Если встретили страницу с другим serial — поток сменился (например, переход на другой стрим в файле),
    /// сбрасываем carry.
    bitstream_serial: Option<i32>
}

impl Default for OggOpusParser {
    fn default() -> Self {
        Self::new()
    }
}

impl OggOpusParser {
    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    pub fn new() -> Self {
        OggOpusParser {
            remainder: BytesMut::with_capacity(8 * 1024),
            packet_carry: Vec::with_capacity(4096),
            bitstream_serial: None
        }
    }

    // =========================================================================
    // INFO
    // =========================================================================

    #[inline]
    pub fn pending_len(&self) -> usize {
        self.remainder.len() + self.packet_carry.len()
    }

    // =========================================================================
    // PUBLIC PARSE API
    // =========================================================================

    /// Основная точка входа: подаём кусок данных, получаем на выход готовые пакеты.
    /// Если chunk пустой — получаем остатки (flush).
    pub fn parse_internal(&mut self, chunk: &[u8], output: &mut Vec<ParsedPacket>) -> Result<()> {
        // Если входящий пакет пуст
        if chunk.is_empty() {
            return self.flush_internal(output);
        }

        // Передаем на дальнейший разбор пакета
        self.parse_core(chunk, |packet_type, data| {
            output.push((packet_type, data.to_vec()));
            Ok(())
        })
    }

    // =========================================================================
    // FLUSH
    // =========================================================================

    /// Вызывается при EOF (chunk пустой). Выдаёт последний собираемый пакет, если есть.
    fn flush_internal(&mut self, output: &mut Vec<ParsedPacket>) -> Result<()> {
        // Если есть в буфере еще данные о последних пакетах
        if !self.packet_carry.is_empty() {
            let packet = std::mem::take(&mut self.packet_carry);
            let packet_type = Self::detect_packet_type(&packet);
            output.push((packet_type, packet));
        }
        Ok(())
    }

    // =========================================================================
    // CORE PARSER
    // =========================================================================

    /// Внутренний цикл разбора.
    /// Принцип: ищем сигнатуру "OggS" в remainder начиная с cursor.
    /// Каждый раз, когда находим полную страницу (хватает заголовка + таблицы сегментов + полезной нагрузки),
    /// отдаём её в `handle_page_core`, которая через функцию on_packet выдаёт готовые пакеты.
    /// Оставшиеся необработанные байты сдвигаем в начало remainder.
    ///
    /// Параметры:
    /// - chunk: новые данные, добавляются в remainder.
    /// - on_packet: функция, получает (PacketType, &[u8]) — владение данных остаётся за парсером.
    ///              В текущей реализации `parse_internal` копирует в Vec, но можно оптимизировать.
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
                    // оставляя только последние 3 байта (на случай, если "OggS" разорван между чанками)
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
                    let packet_type = Self::detect_packet_type(packet_carry);
                    on_packet(packet_type, packet_carry)?;
                    packet_carry.clear();
                }
            }
        }

        Ok(())
    }

    // =========================================================================
    // PACKET DETECTION
    // =========================================================================

    /// Логика:
    /// - Пустой → Broken
    /// - Длина 1: 0x80 → Silent, 0xFF → End
    /// - Длина <8 → Broken (не может быть валидным Opus фреймом)
    /// - Проверяет строки "OpusHead" и "OpusTags" в начале.
    /// - Иначе — если длина >=8 → считаем Frame (здесь также может быть Silent с ведущим 0x80,
    ///   но мы относим их к Frame, так как структурно это валидные пакеты).
    #[inline]
    pub fn detect_packet_type(packet: &[u8]) -> PacketType {
        if packet.is_empty() {
            return PacketType::Broken;
        }

        // Проверяем заголовки Ogg (длинные строки)
        else if packet.len() >= 8 {
            if packet.starts_with(b"OpusHead") {
                return if packet.len() >= 19 { PacketType::Head } else { PacketType::Broken };
            }
            else if packet.starts_with(b"OpusTags") {
                return PacketType::Tags;
            }
        }

        // Стандартный кадр тишины Opus (20 мс, стерео) — то, что нужно Discord
        else if packet == [0xF8, 0xFF, 0xFE] || packet == [0xFC, 0xFF, 0xFE] {
            return PacketType::Silent;
        }

        // Внутренний сигнал конца потока (если ты используешь 1 байт 0xFF для управления)
        else if packet.len() == 1 && packet[0] == 0xFF {
            return PacketType::End;
        }

        // Всё остальное — валидный аудиофрейм.
        // Opus имеет TOC-байт под индексом 0. Не проверяем длину, так как
        // фрейм может быть размером от 1 байта до 1275 байт.
        PacketType::Frame
    }
}