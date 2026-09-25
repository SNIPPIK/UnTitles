pub mod packet_type;
mod opus_specification;

use crate::structures::audio::{
    encoder::ogg::packet_type::{PacketType, ParsedPacket},
    opus::SILENT_FRAME
};
use std::io::{Error, ErrorKind, Result};
use bytes::{Buf, BytesMut};
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
    ///
    /// Если `chunk` пуст — ничего не делает (в текущей реализации flush)
    /// Иначе запускает основной парсер с возвратом, который склеивает
    /// переданные части в один непрерывный `Vec<u8>` и добавляет
    /// в `output` вместе с типом пакета.
    ///
    /// # Аргументы
    /// * `chunk` — новый фрагмент данных.
    /// * `output` — вектор, куда складываются готовые пакеты.
    ///
    /// # Возвращаемое значение
    /// `Ok(())` при успешном разборе; `Err` при ошибке из возврата.
    pub fn parse_internal(&mut self, chunk: &[u8], output: &mut Vec<ParsedPacket>) -> Result<()> {
        // Пустой фрагмент — нечего обрабатывать.
        if chunk.is_empty() { return Ok(()); }

        // Запускаем ядро парсера.
        self.parse_core(chunk, |packet_type, parts| {
            // Считаем итоговую длину всех частей одним проходом.
            let total_len: usize = parts.iter().map(|p| p.len()).sum();
            // Резервируем место и складываем части подряд.
            let mut data = Vec::with_capacity(total_len);

            for part in parts {
                data.extend_from_slice(part);
            }

            // Публикуем готовый пакет.
            output.push((packet_type, data));
            Ok(())
        })
    }

    /// Основной цикл разбора.
    ///
    /// Шаги:
    /// 1. Добавляет новые данные в `remainder`.
    /// 2. Ищет сигнатуру "OggS".
    /// 3. Проверяет заголовок страницы.
    /// 4. Обрабатывает полные страницы через `handle_page_core`.
    /// 5. Удаляет обработанные байты из `remainder`.
    ///
    /// # Аргументы
    /// * `chunk` — новые данные.
    /// * `on_packet` — возврат, получающий тип и части пакета.
    fn parse_core<F>(&mut self, chunk: &[u8], mut on_packet: F) -> Result<()>
    where
        F: FnMut(PacketType, &[&[u8]]) -> Result<()>,
    {
        // Дописываем новый фрагмент к накопленному остатку.
        self.remainder.extend_from_slice(chunk);

        // Защита от неограниченного роста при повреждённом входе.
        if self.remainder.len() > MAX_REMAINDER_SIZE {
            self.reset_storage();
            return Ok(());
        }

        loop {
            let buf = &self.remainder;

            // Минимум для заголовка страницы без таблицы сегментов.
            if buf.len() < 27 {
                break;
            }

            // Ищем сигнатуру страницы Ogg.
            let pos = match memmem::find(buf, b"OggS") {
                Some(v) => v,
                None => {
                    // Мусор без OggS — оставляем только хвост,
                    // где сигнатура может быть разорвана между фрагментами.
                    let keep = buf.len().min(3);
                    let drop = buf.len() - keep;
                    if drop != 0 {
                        self.remainder.advance(drop);
                    }
                    break;
                }
            };

            // Отбрасываем всё до найденной сигнатуры.
            if pos != 0 {
                self.remainder.advance(pos);
                continue;
            }

            // Число сегментов в странице.
            let segment_count = buf[26] as usize;
            // Полный размер заголовка с таблицей сегментов.
            let header_size = 27 + segment_count;

            // Ждём полной таблицы сегментов.
            if buf.len() < header_size {
                break;
            }

            // Считаем размер payload одним проходом.
            let mut payload_size = 0usize;
            for &v in &buf[27..header_size] {
                payload_size += v as usize;
            }

            // Полный размер страницы: заголовок + payload.
            let page_size = match header_size.checked_add(payload_size) {
                Some(v) => v,
                None => {
                    // Переполнение размера — пропускаем сигнатуру и ищем дальше.
                    self.remainder.advance(4);
                    continue;
                }
            };

            // Ждём полного payload.
            if buf.len() < page_size {
                break;
            }

            // Выделяем полную страницу.
            let page = &buf[..page_size];

            match Self::handle_page_core(
                page,
                &mut self.packet_carry,
                &mut self.bitstream_serial,
                &mut on_packet,
            ) {
                // Страница успешно обработана — пропускаем её.
                Ok(_) => self.remainder.advance(page_size),

                // Повреждённая страница: сбрасываем состояние и пропускаем.
                Err(PageError::Malformed(_)) => {
                    self.packet_carry.clear();
                    self.bitstream_serial = None;
                    self.remainder.advance(page_size);
                }

                // Ошибка из возврата — пробрасываем наружу как есть.
                Err(PageError::Callback(e)) => return Err(e),
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
    ///
    /// # Аргументы
    /// * `page` — полная страница.
    /// * `packet_carry` — буфер для переноса незавершённого пакета.
    /// * `bitstream_serial` — текущий serial логического потока.
    /// * `on_packet` — возврат для готовых пакетов.
    fn handle_page_core<F>(page: &[u8], packet_carry: &mut Vec<u8>, bitstream_serial: &mut Option<u32>, on_packet: &mut F) -> std::result::Result<(), PageError>
    where
        F: FnMut(PacketType, &[&[u8]]) -> Result<()>,
    {
        // Проверка базовой длины и сигнатуры, а также версии страницы (должна быть 0).
        if page.len() < 27 || &page[..4] != b"OggS" || page[4] != 0 {
            return Err(PageError::malformed("Invalid OGG page"));
        }

        let header_type = page[5];

        // Зарезервированные биты должны быть нулевыми.
        if header_type & 0xF8 != 0 {
            return Err(PageError::malformed("Invalid OGG header flags"));
        }

        // Разбор отдельных флагов.
        let continued = header_type & 0x01 != 0;
        let bos = header_type & 0x02 != 0;
        let eos = header_type & 0x04 != 0;

        // BOS и continuation не могут стоять одновременно.
        if bos && continued {
            return Err(PageError::malformed("Invalid BOS continuation"));
        }

        // Serial из байт 14..18.
        let serial = u32::from_le_bytes(page[14..18].try_into().unwrap());

        // При смене serial сбрасываем незавершённый пакет.
        if *bitstream_serial != Some(serial) {
            packet_carry.clear();
            *bitstream_serial = Some(serial);
        }

        // Флаг continuation должен соответствовать наличию незавершённого пакета.
        if continued != !packet_carry.is_empty() {
            return Err(PageError::malformed("Packet continuation mismatch"));
        }

        // Число сегментов и размер заголовка.
        let segment_count = page[26] as usize;
        let header_size = 27 + segment_count;

        if page.len() < header_size {
            return Err(PageError::malformed("Invalid segment table"));
        }

        // Указатель на начало payload.
        let mut offset = header_size;

        // Перебираем lacing values.
        for &len_u8 in &page[27..header_size] {
            let len = len_u8 as usize;
            let end = offset + len;

            // Сегмент не должен выходить за пределы страницы.
            if end > page.len() {
                packet_carry.clear();
                return Err(PageError::malformed("Segment out of bounds"));
            }

            // Дописываем данные в собираемый пакет.
            if len != 0 {
                // Защита от переполнения размера пакета.
                if packet_carry.len() + len > MAX_PACKET_SIZE {
                    packet_carry.clear();
                    return Err(PageError::malformed("Packet too large"));
                }

                packet_carry.extend_from_slice(&page[offset..end]);
            }

            offset = end;

            // Значение < 255 завершает текущий пакет.
            if len_u8 != 255 {
                Self::finish_packet(packet_carry, on_packet)?;
            }
        }

        // После обхода всех сегментов offset должен совпадать с длиной страницы.
        if offset != page.len() {
            packet_carry.clear();
            return Err(PageError::malformed("Payload mismatch"));
        }

        // EOS с незавершённым пакетом — повреждение.
        if eos && !packet_carry.is_empty() {
            packet_carry.clear();
            return Err(PageError::malformed("EOS with unfinished packet"));
        }

        Ok(())
    }

    /// Завершает сборку Opus-пакета и передаёт его потребителю.
    ///
    /// В зависимости от типа пакета выполняется его коррекция:
    /// - `PLC` заменяется на `Silent` с использованием `SILENT_FRAME`;
    /// - `VBR` превращается в `SVBR` (SILENT_FRAME + оригинальный payload);
    /// - остальные типы передаются без изменений.
    ///
    /// `on_packet` получает данные как срез срезов (`&[&[u8]]`), а не
    /// готовый непрерывный буфер: для SVBR это позволяет вызывающей
    /// стороне (`parse_internal`) собрать итоговый `Vec<u8>` за одно
    /// выделение и одно копирование, вместо того чтобы сначала строить
    /// временный `SILENT_FRAME + packet_carry` буфер здесь, а потом
    /// копировать его ещё раз на выходе.
    ///
    /// # Аргументы
    /// * `packet_carry` — собранный пакет (очищается в конце).
    /// * `on_packet` — возврат получателя.
    #[inline]
    fn finish_packet<F>(packet_carry: &mut Vec<u8>, on_packet: &mut F) -> std::result::Result<(), PageError>
    where
        F: FnMut(PacketType, &[&[u8]]) -> Result<()>,
    {
        // Пустой Opus-пакет не имеет смысла.
        if packet_carry.is_empty() { return Ok(()); }

        // Определяем тип пакета по его содержимому.
        let packet_type = PacketType::detect_packet_type(packet_carry);

        // Обрабатываем типы, требующие коррекции.
        match packet_type {
            // Пустышки
            PacketType::PLC | PacketType::End => {
                on_packet(PacketType::Silent, &[&SILENT_FRAME]).map_err(PageError::callback)?;
            }

            // SVBR = SILENT_FRAME + оригинальный payload
            PacketType::VBR => {
                on_packet(packet_type, &[&SILENT_FRAME, packet_carry.as_slice()]).map_err(PageError::callback)?;
            }

            // Обычный пакет передаётся как есть.
            _ => {
                on_packet(packet_type, &[packet_carry.as_slice()]).map_err(PageError::callback)?;
            }
        }

        // Готовим буфер к следующему пакету.
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