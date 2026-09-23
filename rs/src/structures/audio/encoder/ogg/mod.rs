pub mod packet_type;
mod opus_specification;

use crate::structures::audio::{
    encoder::ogg::packet_type::{PacketType, ParsedPacket},
    opus::SILENT_FRAME
};
use std::io::{Error, ErrorKind, Result};
use bytes::{Buf, BufMut, BytesMut};
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

/// Потоковый парсер Ogg-контейнера, извлекающий Opus-пакеты.
///
/// Реализует разбор страниц Ogg (RFC 3533) с извлечением логических
/// пакетов Opus (RFC 6716, RFC 7845). Поддерживает потоковую подачу данных,
/// корректно обрабатывая частично полученные страницы и пакеты,
/// переносимые между страницами через флаг продолжения.
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
            remainder: BytesMut::with_capacity(1024),
            packet_carry: Vec::with_capacity(256),
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
        if chunk.is_empty() { return Ok(()); }

        self.parse_core(chunk, |packet_type, data| {
            output.push((packet_type, data.to_vec()));
            Ok(())
        })
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

        loop {
            // Нам хотя бы нужен capture pattern.
            if self.remainder.len() < 4 { break; }

            // Ищем следующую сигнатуру "OggS".
            let pos = match memmem::find(&self.remainder, b"OggS") {
                Some(pos) => pos,
                None => {
                    // Сигнатура не найдена: оставляем хвост в 3 байта,
                    // на случай если "OggS" разрезана пополам.
                    //
                    // Сохраняем последние 3 байта:
                    // они могут оказаться началом "OggS" в следующем chunk.
                    let keep = self.remainder.len().min(3);
                    let drop_len = self.remainder.len() - keep;

                    if drop_len != 0 {
                        self.remainder.advance(drop_len);
                    }

                    break;
                }
            };

            // Отбрасываем мусор перед сигнатурой.
            if pos != 0 { self.remainder.advance(pos); }

            // Недостаточно данных для заголовка Ogg-страницы.
            else if self.remainder.len() < 27 { break; }

            // Дополнительная проверка capture pattern.
            // Здесь уже обязательно OggS.
            debug_assert_eq!(&self.remainder[..4], b"OggS");

            // Версия Ogg: должна быть 0.
            if self.remainder[4] != 0 {
                self.remainder.advance(1);
                continue;
            }

            let segment_count = self.remainder[26] as usize;
            let header_size = 27 + segment_count;

            // Ждём полную таблицу сегментов.
            if self.remainder.len() < header_size {
                break;
            }

            let segment_table = &self.remainder[27..header_size];

            let payload_size = segment_table
                .iter()
                .map(|&len| len as usize)
                .sum::<usize>();

            // Защита от переполнения при вычислении конца страницы.
            let page_size = match header_size.checked_add(payload_size) {
                Some(size) => size,
                None => {
                    self.remainder.advance(4);
                    continue;
                }
            };

            // Ждём полный payload.
            // Вся страница ещё не пришла.
            if self.remainder.len() < page_size { break; }

            let page = &self.remainder[..page_size];

            // Обработка страницы; при ошибке формата очищаем состояние переноса.
            match Self::handle_page_core(page, &mut self.packet_carry, &mut self.bitstream_serial, &mut on_packet) {
                Ok(()) => {
                    self.remainder.advance(page_size);
                }

                Err(PageError::Malformed(_)) => {
                    // Повреждённая страница не должна ломать весь stream.
                    self.packet_carry.clear();
                    self.bitstream_serial = None;
                    self.remainder.advance(page_size);
                }

                Err(PageError::Callback(err)) => {
                    // Ошибку потребителя нельзя проглатывать.
                    return Err(err);
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
    fn handle_page_core<F>(page: &[u8], packet_carry: &mut Vec<u8>, bitstream_serial: &mut Option<u32>, on_packet: &mut F) -> std::result::Result<(), PageError> where
        F: FnMut(PacketType, &[u8]) -> Result<()>,
    {
        // Минимальный размер Ogg page header.
        if page.len() < 27 {
            return Err(PageError::malformed("Invalid OGG page"));
        }

        // Capture pattern.
        else if &page[..4] != b"OggS" {
            return Err(PageError::malformed("Invalid OGG capture pattern"));
        }

        // Ogg version.
        else if page[4] != 0 {
            return Err(PageError::malformed("Unsupported OGG version"));
        }

        let header_type = page[5];

        // В Ogg используются только младшие 3 бита:
        // 0x01 = continued, 0x02 = BOS, 0x04 = EOS.
        // Остальные биты зарезервированы и должны быть нулевыми.
        // Ogg использует только 3 младших флага.
        if header_type & 0xF8 != 0 {
            return Err(PageError::malformed("Invalid OGG header flags"));
        }

        let continued = (header_type & 0x01) != 0;
        let bos = (header_type & 0x02) != 0;
        let eos = (header_type & 0x04) != 0;

        // Serial number.
        let serial = u32::from_le_bytes(
            page[14..18]
                .try_into()
                .map_err(|_| PageError::malformed("Invalid OGG serial"))?,
        );

        let segment_count = page[26] as usize;
        let header_size = 27 + segment_count;

        if page.len() < header_size {
            return Err(PageError::malformed("Invalid OGG segment table"));
        }

        // ------------------------------------------------------------------
        // BOS
        // ------------------------------------------------------------------

        // BOS-страница не может быть continuation.
        else if bos && continued {
            return Err(PageError::malformed("Invalid OGG BOS continuation"));
        }

        // ------------------------------------------------------------------
        // Logical bitstream
        // ------------------------------------------------------------------

        if *bitstream_serial != Some(serial) {
            // Если это новый logical bitstream — старый незавершённый
            // packet больше не имеет отношения к новому потоку.
            // Новый logical stream.
            //
            // Старый незавершённый packet больше нельзя продолжать.
            packet_carry.clear();
            *bitstream_serial = Some(serial);
        }

        // ------------------------------------------------------------------
        // CONTINUATION
        // ------------------------------------------------------------------

        // Проверяем continuation до обработки сегментов.
        if continued {
            // Если страница объявляет продолжение, у нас обязательно
            // должен существовать packet, начатый предыдущей страницей.
            if packet_carry.is_empty() {
                return Err(PageError::malformed(
                    "OGG continuation without previous packet",
                ));
            }
        } else if !packet_carry.is_empty() {
            // Предыдущая страница закончилась segment=255, то есть packet
            // должен был продолжиться здесь, но continuation отсутствует.
            return Err(PageError::malformed(
                "OGG packet continuation mismatch",
            ));
        }

        // ------------------------------------------------------------------
        // SEGMENTS
        // ------------------------------------------------------------------

        let segment_table = &page[27..header_size];
        let mut offset = header_size;

        for &segment_len_u8 in segment_table {
            let segment_len = segment_len_u8 as usize;

            let end = offset
                .checked_add(segment_len)
                .ok_or_else(|| PageError::malformed("OGG segment overflow"))?;

            if end > page.len() {
                packet_carry.clear();

                return Err(PageError::malformed(
                    "OGG segment out of bounds",
                ));
            }

            // Проверяем размер ещё до расширения Vec.
            // Ограничение размера Opus packet.
            let new_len = packet_carry
                .len()
                .checked_add(segment_len)
                .ok_or_else(|| PageError::malformed("Opus packet overflow"))?;

            if new_len > MAX_PACKET_SIZE {
                packet_carry.clear();

                return Err(PageError::malformed(
                    "Opus packet exceeds maximum size",
                ));
            }

            if segment_len != 0 {
                packet_carry.extend_from_slice(&page[offset..end]);
            }

            offset = end;

            // Lacing value < 255 означает конец packet.
            if segment_len_u8 < 255 {
                Self::finish_packet(packet_carry, on_packet)?;
            }
        }

        // Для Ogg page payload должен полностью соответствовать
        // lacing table.
        if offset != page.len() {
            packet_carry.clear();

            return Err(PageError::malformed(
                "OGG page payload size mismatch",
            ));
        }

        // ------------------------------------------------------------------
        // EOS
        // ------------------------------------------------------------------

        // EOS с незавершённым packet означает обрезанный поток.
        // Проверяем ПОСЛЕ обработки всех сегментов.
        else if eos && !packet_carry.is_empty() {
            packet_carry.clear();

            return Err(PageError::malformed(
                "OGG EOS with unfinished packet",
            ));
        }

        Ok(())
    }

    /// Завершает сборку Opus-пакета и передаёт его потребителю.
    ///
    /// В зависимости от типа пакета выполняется его коррекция:
    /// - `PLC` заменяется на `Silent` с использованием `SILENT_FRAME`;
    /// - `VBR` превращается в `SVBR` (SILENT_FRAME + оригинальный payload);
    /// - остальные типы передаются без изменений.
    #[inline]
    fn finish_packet<F>(packet_carry: &mut Vec<u8>, on_packet: &mut F) -> std::result::Result<(), PageError> where
        F: FnMut(PacketType, &[u8]) -> Result<()>,
    {
        // Для Opus пустой packet не имеет смысла.
        if packet_carry.is_empty() { return Ok(()); }
        let packet_type = PacketType::detect_packet_type(packet_carry);

        // Более деликатно разбираем типы пакета.
        match packet_type {
            PacketType::PLC => {
                // Удаляем мусорный PLC, отправляем Silent.
                on_packet(PacketType::Silent, &SILENT_FRAME)
                    .map_err(PageError::callback)?;
            }

            PacketType::VBR => {
                // Не используем splice():
                // он двигает весь существующий packet.
                //
                // Создаём временный буфер только для SVBR:
                // вставляем SILENT_FRAME в начало, остаток (старый carry)
                // идёт следом.
                let mut svbr = Vec::with_capacity(SILENT_FRAME.len() + packet_carry.len());

                svbr.extend_from_slice(&SILENT_FRAME);
                svbr.extend_from_slice(packet_carry);

                on_packet(PacketType::SVBR, &svbr)
                    .map_err(PageError::callback)?;
            }

            _ => {
                on_packet(packet_type, packet_carry)
                    .map_err(PageError::callback)?;
            }
        }

        packet_carry.clear();

        Ok(())
    }

    /// Полный сброс внутренних буферов.
    ///
    /// ВАЖНО:
    /// Здесь НЕ делаем shrink_to_fit().
    ///
    /// Demuxer, скорее всего, используется многократно.
    /// Сохранение capacity предотвращает повторные allocation/free
    /// при следующих chunks/pages.
    #[inline]
    fn reset_storage(&mut self) {
        self.remainder.clear();
        self.packet_carry.clear();
        self.bitstream_serial = None;
    }

    /// Очищает все внутренние данные (вызывает reset_storage).
    #[inline]
    pub fn cleanup(&mut self) {
        self.reset_storage();
    }
}

// ============================================================================
// Ошибки страницы
// ============================================================================

/// Разделяет два класса ошибок при разборе Ogg-страницы:
///
/// - `Malformed` — повреждённая страница. Ошибка локальная: парсер может
///   продолжить работу, сбросив состояние переноса и пропустив битую страницу.
/// - `Callback` — ошибка из `on_packet`. Пришла из пользовательского кода,
///   парсер не имеет права её «проглатывать» — она должна проброситься наружу.
///
/// Такое разделение позволяет вызывающему коду различать:
/// - данные повреждены (можно продолжать);
/// - обработчик сломался (нужно прекратить).
enum PageError {
    /// Повреждённая страница; парсер восстанавливается и продолжает.
    Malformed(Error),

    /// Ошибка из `on_packet`; должна быть проброшена наружу как есть.
    Callback(Error),
}

impl PageError {
    /// Создаёт `Malformed`-ошибку с текстовым сообщением.
    ///
    /// Использует `ErrorKind::InvalidData` — семантически это ошибка данных,
    /// а не операции ввода-вывода.
    #[inline]
    fn malformed(message: &'static str) -> Self {
        Self::Malformed(Error::new(ErrorKind::InvalidData, message))
    }

    /// Оборачивает ошибку из `on_packet` в вариант `Callback`.
    ///
    /// Отдельный конструктор подчёркивает, что такие ошибки не являются
    /// следствием повреждения данных и не должны обрабатываться как `Malformed`.
    #[inline]
    fn callback(error: Error) -> Self {
        Self::Callback(error)
    }
}

// ============================================================================
// DROP
// ============================================================================
impl Drop for OggOpusDemuxer {
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        {
            eprintln!(
                "OggOpusDemuxer drop | remainder={} cap={} | packet={} cap={}",
                self.remainder.len(),
                self.remainder.capacity(),
                self.packet_carry.len(),
                self.packet_carry.capacity(),
            );
        }
    }
}