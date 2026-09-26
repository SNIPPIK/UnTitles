mod packet_type;
mod opus_specification;

use bytes::{Buf, BufMut, BytesMut};
use napi::bindgen_prelude::*;
use memchr::memmem;
use crate::structures::audio::encoder::ogg::packet_type::{PacketType, ParsedPacket};
// ============================================================================
// LIMITS
// ============================================================================

// Жёсткий потолок на размер `remainder`. Защита от бесконечного роста
// при мусорном/повреждённом входе, где "OggS" не находится вовсе.
const MAX_REMAINDER_SIZE: usize = 64 * 1024;

// Жёсткий потолок на собираемый Opus-пакет. Защита от пакета, у которого
// lacing-таблица бесконечно говорит "продолжение" (255, 255, 255, ...).
const MAX_PACKET_SIZE: usize = 4 * 1024 * 1024;

// ============================================================================
// PARSER
// ============================================================================

/// Потоковый парсер Ogg-контейнера, извлекающий Opus-пакеты.
///
/// # Привязка к первому логическому потоку (аналог поведения TS-парсера)
///
/// Ogg допускает мультиплексирование нескольких логических потоков
/// (`serial`) в одном физическом контейнере (chained/multiplexed Ogg).
/// Как только в одном из потоков встречается `OpusHead`, этот serial
/// запоминается как основной (`primary_serial`), и все последующие
/// пакеты из ДРУГИХ потоков молча отбрасываются (не публикуются как
/// `Frame`/`Silent`/`Broken`), кроме `Tags` — заголовок комментариев
/// эмитится независимо от serial, как и в исходном TS-парсере.
///
/// Это НЕ влияет на разбор пакетов, переносимых между Ogg-страницами:
/// перенос обрабатывается персистентным `packet_carry` и корректно
/// работает даже когда последний lacing-байт страницы равен 255
/// (в отличие от портированного один-в-один TS-алгоритма, который в
/// этом случае зависает — см. пояснение в сопроводительном ответе).
#[derive(Debug)]
pub struct OggOpusDemuxer {
    /// Буфер для накопления входных данных, не образующих полную Ogg-страницу.
    /// После обработки всех полных страниц остаток сдвигается в начало буфера.
    remainder: BytesMut,

    /// Буфер для сборки пакета, который может начинаться на одной странице
    /// и продолжаться на следующей (сегменты длиной 255 байт).
    packet_carry: Vec<u8>,

    /// Serial страницы, из которой сейчас собирается `packet_carry`.
    /// Используется для решения "сбросить ли carry при смене потока".
    bitstream_serial: Option<u32>,

    /// Serial потока, в котором был найден первый `OpusHead`.
    /// `None`, пока заголовок ещё не встречен ни в одном потоке.
    primary_serial: Option<u32>,
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
        OggOpusDemuxer {
            remainder: BytesMut::new(),
            packet_carry: Vec::with_capacity(1024),
            bitstream_serial: None,
            primary_serial: None,
        }
    }

    // Сколько байт сейчас "застряло" внутри парсера (неполная страница + недопакет).
    // Полезно вызывающему для диагностики/backpressure.
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
        // Пустой chunk трактуется как "конец потока" — до-выдаём то,
        // что осталось в packet_carry, не дожидаясь следующей страницы.
        if chunk.is_empty() {
            return self.flush_internal(output);
        }

        // Замыкание копирует данные в Vec — сам парсер владеет только
        // временным packet_carry и не сохраняет ссылок в output.
        self.parse_core(chunk, |packet_type, data| {
            output.push((packet_type, Vec::from(data)));
            Ok(())
        })
    }

    /// Выдаёт последний собранный, но ещё не завершённый пакет (EOF).
    ///
    /// Тип определяется через `classify`, с учётом текущего
    /// `bitstream_serial` — так же, как и для пакетов, завершённых внутри
    /// обычного потока разбора.
    fn flush_internal(&mut self, output: &mut Vec<ParsedPacket>) -> Result<()> {
        if !self.packet_carry.is_empty() {
            let packet = std::mem::take(&mut self.packet_carry);
            let packet_type = self.classify(&packet, self.bitstream_serial);
            output.push((packet_type, packet));
        }
        Ok(())
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
    fn parse_core<F>(&mut self, chunk: &[u8], mut on_packet: F) -> Result<()> where
        F: FnMut(PacketType, &[u8]) -> Result<()>,
    {
        self.remainder.put_slice(chunk);

        // Защита от неограниченного роста при повреждённом входе.
        // Полный сброс — самый простой способ не копить мусор: теряем
        // текущий контекст, но не даём процессу упасть по OOM.
        if self.remainder.len() > MAX_REMAINDER_SIZE {
            self.remainder.clear();
            self.packet_carry.clear();
            return Err(Error::from_reason("Ogg parser remainder overflow"));
        }

        // Минимальный размер Ogg-страницы = 27 байт (fixed header).
        // Меньше — нечего разбирать даже теоретически.
        while self.remainder.len() >= 27 {
            // Ищем начало следующей страницы. Если "OggS" нет совсем,
            // оставляем последние 3 байта — там может быть "Ogg" + "S"
            // на следующей итерации после put_slice.
            let pos = match memmem::find(&self.remainder, b"OggS") {
                Some(pos) => pos,
                None => {
                    if self.remainder.len() > 3 {
                        let discard_len = self.remainder.len() - 3;
                        self.remainder.advance(discard_len);
                    }
                    return Ok(());
                }
            };

            // Сдвигаем начало буфера к найденной сигнатуре. Мусор до неё
            // просто теряется — это ожидаемое поведение ре-синхронизации.
            if pos > 0 {
                self.remainder.advance(pos);
                debug_assert_eq!(&self.remainder[..4], b"OggS");
            }

            // 27 байт фикс. заголовка + N байт lacing-таблицы.
            // N хранится в байте 26 (счётчик сегментов).
            let header_size = 27 + self.remainder[26] as usize;
            if self.remainder.len() < header_size {
                break;
            }

            let segment_table = &self.remainder[27..header_size];
            let mut payload_size = 0usize;
            for &segment in segment_table {
                payload_size += segment as usize;
            }

            // Полный размер страницы = заголовок + тело.
            // Ждём, пока придут все байты, иначе — break и выход из цикла.
            let page_end = header_size + payload_size;
            if self.remainder.len() < page_end {
                break;
            }

            let full_page = &self.remainder[..page_end];

            // handle_page_core может вернуть Err — это НЕ фатально:
            // например, если внутри одной "страницы" встретился пакет
            // с overflow. В этом случае сдвигаемся на минимум 4 байта
            // и пробуем снова найти "OggS" — так мы не зациклимся.
            if Self::handle_page_core(
                full_page,
                &mut self.packet_carry,
                &mut self.bitstream_serial,
                &mut self.primary_serial,
                &mut on_packet,
            )
                .is_err()
            {
                self.remainder.advance(header_size.min(4));
                continue;
            }

            self.remainder.advance(page_end);
        }

        Ok(())
    }

    fn handle_page_core<F>(page: &[u8], packet_carry: &mut Vec<u8>, bitstream_serial: &mut Option<u32>, primary_serial: &mut Option<u32>, on_packet: &mut F) -> Result<()> where
        F: FnMut(PacketType, &[u8]) -> Result<()>,
    {
        if page.len() < 27 {
            return Err(Error::from_reason("Invalid OGG page"));
        }

        // Флаги заголовка Ogg:
        // 0x01 — continued (страница продолжает пакет с предыдущей),
        // 0x02 — BOS (beginning of stream, первая страница потока),
        // 0x04 — EOS (end of stream).
        let header_type = page[5];
        let continued = (header_type & 0x01) != 0;
        let bos = (header_type & 0x02) != 0;
        let eos = (header_type & 0x04) != 0;

        // Serial логического потока — 4 байта LE со смещения 14.
        let serial = u32::from_le_bytes(page[14..18].try_into().unwrap());

        // При смене serial сбрасываем незавершённый пакет: он принадлежит
        // другому логическому потоку, склеивать его с новым нельзя.
        if *bitstream_serial != Some(serial) {
            packet_carry.clear();
            *bitstream_serial = Some(serial);
        }

        // BOS/EOS — границы потока, тоже гарантированно рвут перенос.
        if bos || eos {
            packet_carry.clear();
        }

        let segments_count = page[26] as usize;
        let segment_table = &page[27..27 + segments_count];
        let mut offset = 27 + segments_count;

        // Если страница НЕ помечена continued, но carry непустой —
        // это рассинхрон: старая "половинка" пакета недействительна.
        if !continued && !packet_carry.is_empty() {
            packet_carry.clear();
        }

        for &segment_len in segment_table {
            let segment_len = segment_len as usize;
            let end = offset + segment_len;
            let data = page
                .get(offset..end)
                .ok_or_else(|| Error::from_reason("Segment out of bounds"))?;

            if segment_len != 0 {
                packet_carry.extend_from_slice(data);
            }

            // Проверяем размер ДО следующей итерации, чтобы не копить
            // больше MAX_PACKET_SIZE даже транзиентно.
            if packet_carry.len() + segment_len > MAX_PACKET_SIZE {
                packet_carry.clear();
                return Err(Error::from_reason("Opus packet overflow"));
            }

            offset = end;

            // segment_len < 255 означает "пакет закончился на этом сегменте".
            // segment_len == 255 означает "продолжение следует".
            // Плюс проверка !is_empty() — пустой пакет (0 сегментов до
            // этого) не считается завершённым.
            if segment_len < 255 && !packet_carry.is_empty() {
                // classify_static сам решит: Head/Tags/Frame/... и,
                // если это первый Head, защёлкнет primary_serial.
                let packet_type = PacketType::classify_static(packet_carry, serial, primary_serial);

                // Пакеты из "чужого" потока (не primary_serial) отбрасываются
                // молча, кроме Tags — см. doc-комментарий структуры. Это
                // единственная фильтрация; сам сброс packet_carry ниже
                // выполняется в любом случае, независимо от того, был ли
                // пакет опубликован.
                if packet_type != PacketType::Unclassified || primary_serial.is_none() {
                    // Unclassified публикуется, только если ещё нет
                    // primary_serial вообще (т.е. это может быть первый
                    // проход до заголовка) — как только primary_serial уже
                    // определён, чужой поток полностью игнорируется.
                    let should_emit = match packet_type {
                        // Tags пропускаем всегда — даже из чужого потока.
                        PacketType::Tags => true,
                        // Пакет из основного потока — пропускаем.
                        _ if Some(serial) == *primary_serial => true,
                        // primary_serial ещё не найден — пропускаем как есть.
                        _ if primary_serial.is_none() => true,
                        // Всё остальное (Frame/Silent/Broken/Head из чужого
                        // потока) — глушим.
                        _ => false,
                    };

                    if should_emit {
                        on_packet(packet_type, packet_carry)?;
                    }
                }

                // Сброс carry — всегда, независимо от should_emit:
                // пакет собран, дальше пойдёт следующий.
                packet_carry.clear();
            }
        }

        Ok(())
    }


    /// Версия для `flush_internal`, где нет доступа к `&mut self` полям
    /// напрямую в замыкании — использует уже известный `bitstream_serial`.
    #[inline]
    pub fn classify(&self, packet: &[u8], serial: Option<u32>) -> PacketType {
        let detected = PacketType::detect_packet_type(packet);
        match (detected, serial, self.primary_serial) {
            // Head всегда Head, независимо от потока — вызывающий сам
            // решает, что с ним делать.
            (PacketType::Head, _, _) => PacketType::Head,

            // Пакет из основного потока — отдаём как есть.
            (_, Some(s), Some(p)) if s == p => detected,

            // primary_serial ещё не найден — всё непонятное в Unclassified.
            (_, _, None) => PacketType::Unclassified,

            // Всё прочее (в т.ч. чужой поток) — Unclassified.
            _ => PacketType::Unclassified,
        }
    }

    // Полный сброс состояния парсера. Используется в Drop и может
    // вызываться вручную при смене входного потока.
    pub fn cleanup(&mut self) {
        self.remainder.clear();
        self.packet_carry.clear();
        self.bitstream_serial = None;
        self.primary_serial = None;
    }
}

impl Drop for OggOpusDemuxer {
    fn drop(&mut self) {
        self.cleanup();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Собирает Ogg-страницу вручную: фикс. заголовок + lacing-таблица + payload.
    // Все поля, кроме serial/header_type/segment_table/payload, оставлены нулями —
    // парсер их всё равно не читает (кроме флагов и serial).
    fn build_page(serial: u32, header_type: u8, segments: &[u8], payload: &[u8]) -> Vec<u8> {
        let mut page = Vec::new();
        page.extend_from_slice(b"OggS");
        page.push(0);
        page.push(header_type);
        page.extend_from_slice(&[0u8; 8]);
        page.extend_from_slice(&serial.to_le_bytes());
        page.extend_from_slice(&[0u8; 4]);
        page.extend_from_slice(&[0u8; 4]);
        page.push(segments.len() as u8);
        page.extend_from_slice(segments);
        page.extend_from_slice(payload);
        page
    }

    // Минимальный OpusHead: сигнатура "OpusHead" + добивка нулями до 19 байт.
    // Реальный заголовок содержит ещё version/channels/etc., но парсеру
    // достаточно самой сигнатуры.
    fn opus_head_payload() -> Vec<u8> {
        let mut p = b"OpusHead".to_vec();
        p.extend_from_slice(&[0u8; 19 - 8]);
        p
    }

    #[test]
    fn locks_to_first_stream_and_ignores_others() {
        let mut demuxer = OggOpusDemuxer::new();
        let mut output = Vec::new();

        let head = opus_head_payload();
        let page_head = build_page(1, 0x02, &[head.len() as u8], &head);
        demuxer.parse_internal(&page_head, &mut output).unwrap();
        assert_eq!(output.last().unwrap().0, PacketType::Head);

        // Пакет от другого serial (не primary) — должен быть отброшен.
        let frame_len = 40;
        let other_frame = vec![0x00u8; frame_len]; // TOC config=0 -> Frame
        let page_other = build_page(2, 0x02, &[frame_len as u8], &other_frame);
        output.clear();
        demuxer.parse_internal(&page_other, &mut output).unwrap();
        assert!(output.is_empty(), "packet from non-primary stream must be dropped");

        // Пакет от primary serial — должен пройти.
        let own_frame = vec![0x00u8; frame_len];
        let page_own = build_page(1, 0x00, &[frame_len as u8], &own_frame);
        output.clear();
        demuxer.parse_internal(&page_own, &mut output).unwrap();
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].0, PacketType::Frame);
    }

    #[test]
    fn packets_before_head_are_unclassified() {
        let mut demuxer = OggOpusDemuxer::new();
        let mut output = Vec::new();

        // Frame до Head: парсер не знает, к какому потоку это относится,
        // поэтому пакет должен уйти в Unclassified, а не в Frame.
        let frame = vec![0x00u8; 30];
        let page = build_page(5, 0x02, &[frame.len() as u8], &frame);
        demuxer.parse_internal(&page, &mut output).unwrap();

        assert_eq!(output.len(), 1);
        assert_eq!(output[0].0, PacketType::Unclassified);
    }

    #[test]
    fn tags_pass_regardless_of_stream() {
        let mut demuxer = OggOpusDemuxer::new();
        let mut output = Vec::new();

        let head = opus_head_payload();
        let page_head = build_page(1, 0x02, &[head.len() as u8], &head);
        demuxer.parse_internal(&page_head, &mut output).unwrap();

        // OpusTags из чужого потока — единственное исключение из фильтра.
        let mut tags = b"OpusTags".to_vec();
        tags.extend_from_slice(&[0u8; 4]);
        let page_tags = build_page(2 /* другой serial */, 0x00, &[tags.len() as u8], &tags);

        output.clear();
        demuxer.parse_internal(&page_tags, &mut output).unwrap();
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].0, PacketType::Tags);
    }

    #[test]
    fn packet_split_across_pages_still_works_when_last_lacing_is_255() {
        // Регрессия против TS-бага: последний lacing-байт страницы == 255,
        // пакет продолжается на следующей странице. Наша реализация не
        // должна "зависать" на этом, в отличие от портированного 1:1 TS-кода.
        let mut demuxer = OggOpusDemuxer::new();
        let mut output = Vec::new();

        let head = opus_head_payload();
        let page_head = build_page(1, 0x02, &[head.len() as u8], &head);
        demuxer.parse_internal(&page_head, &mut output).unwrap();

        // Первая часть пакета: 255 байт, lacing=255 => пакет НЕ закрыт.
        let part1 = vec![0xAAu8; 255];
        let page1 = build_page(1, 0x00, &[255], &part1);
        output.clear();
        demuxer.parse_internal(&page1, &mut output).unwrap();
        assert!(output.is_empty(), "packet must not finish on a 255-length segment");

        // Вторая часть: lacing=10 (<255) => пакет закрывается.
        // Флаг continued (0x01) сигнализирует, что это продолжение.
        let part2 = vec![0x00u8; 10];
        let page2 = build_page(1, 0x01 /* continued */, &[10], &part2);
        demuxer.parse_internal(&page2, &mut output).unwrap();
        assert_eq!(output.len(), 1, "packet must complete once continuation page arrives");
    }
}