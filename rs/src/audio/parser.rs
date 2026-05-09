use napi::bindgen_prelude::*;
use memchr::memmem;

/// Тип пакета Opus, извлечённого из потока Ogg.
/// Соответствует трём возможным типам пакетов в спецификации Opus over Ogg.
#[derive(Debug, PartialEq, Copy, Clone)]
pub enum PacketType {
    Head,
    Tags,
    Frame,
    Broken
}

/// Новый тип для выходных пакетов
pub type ParsedPacket = (PacketType, Vec<u8>); // (тип, данные)

/// Парсер Ogg Opus потока, работающий в режиме потока (streaming).
///
/// Разбивает входящие фрагменты данных на страницы Ogg, собирает пакеты
/// и классифицирует их как заголовки, теги или аудио-фреймы. Сохраняет
/// состояние между вызовами для обработки неполных страниц.
///
/// Предназначен для использования как из Rust (быстрый внутренний API),
/// так и из Node.js через N-API (метод `parse` с JS-вызовом).
pub struct OggOpusParser {
    /// Буфер для неполных данных, оставшихся от предыдущего вызова parse.
    /// Позволяет обрабатывать поток фрагментарно.
    remainder: Vec<u8>,

    /// Временный буфер для сборки текущего пакета, который может быть
    /// разбит на несколько сегментов Ogg страницы или даже несколько страниц.
    pub packet_carry: Vec<u8>,

    /// Серийный номер битового потока (bitstream serial) текущей логической
    /// последовательности страниц. Используется для детектирования смены потока
    /// или сброса состояния (при появлении страницы с новым serial).
    bitstream_serial: Option<i32>,

    /// Количество байт от начала буфера `remainder`, которые уже были проверены на наличие маркера "OggS".
    ///
    /// Оптимизация, позволяющая не сканировать уже просмотренную область при повторных вызовах `parse_core`.
    ///
    /// ## Как работает
    /// - Изначально `scanned_bytes = 0`.
    /// - При поиске маркера мы начинаем не с `cursor`, а с `max(cursor, scanned_bytes)`, пропуская уже проверенные данные.
    /// - Если маркер найден, `scanned_bytes` обновляется до его позиции (все байты до неё теперь считаются проверенными).
    /// - Если маркер не найден, `scanned_bytes` устанавливается в `remainder.len() - 3`, оставляя последние 3 байта
    ///   на случай, если начало маркера "OggS" попадёт в следующий фрагмент (сигнатура длиной 4 байта, оставляем запас).
    /// - После удаления обработанных данных из `remainder` (через `drain`) значение `scanned_bytes` уменьшается на размер удалённой части.
    scanned_bytes: usize
}

impl OggOpusParser {
    /// Создаёт новый парсер с начальным состоянием.
    pub fn new() -> Self {
        OggOpusParser {
            remainder: Vec::with_capacity(1024),
            packet_carry: Vec::with_capacity(1024),
            bitstream_serial: None,
            scanned_bytes: 0
        }
    }

    /// Внутренний Rust-ориентированный API (быстрый, без накладных расходов N-API).
    /// Принимает фрагмент данных и добавляет обнаруженные пакеты в переданный вектор `output`.
    ///
    /// # Аргументы
    /// * `chunk` - новые входные данные
    /// * `output` - вектор, в который будут добавлены кортежи (тип пакета, данные)
    pub fn parse_internal(&mut self, chunk: &[u8], output: &mut Vec<ParsedPacket>) -> Result<()> {
        if chunk.is_empty() {
            return self.flush_internal(output);
        }

        self.parse_core(chunk, |packet_type, data| {
            output.push((packet_type, data.to_vec()));
            Ok(())
        })
    }

    /// Принудительно извлекает все оставшиеся данные из парсера и завершает обработку потока.
    ///
    /// Этот метод должен вызываться после того, как все входные данные были переданы в парсер
    /// (например, при закрытии потока или достижении EOF). Он обрабатывает ситуацию, когда
    /// в буферах парсера остались неполные данные, которые не могут быть завершены обычным
    /// способом из-за отсутствия последующих страниц Ogg.
    fn flush_internal(&mut self, output: &mut Vec<ParsedPacket>) -> Result<()> {
        if !self.remainder.is_empty() || !self.packet_carry.is_empty() {
            Self::process_packet_core(
                &mut self.packet_carry,
                &mut |packet_type, data| {
                    output.push((packet_type, data.to_vec()));
                    Ok(())
                },
            )?;
            self.packet_carry.clear();
        }
        Ok(())
    }

    /// Основная логика парсинга Ogg-потока.
    ///
    /// Добавляет новый фрагмент данных в буфер `remainder`, затем циклически извлекает
    /// полные Ogg-страницы, обрабатывает их и вызывает функцию `on_packet` для каждого
    /// собранного пакета. Реализована оптимизация поиска маркера "OggS" с использованием
    /// поля `scanned_bytes`, чтобы не сканировать уже проверенные участки буфера.
    ///
    /// # Аргументы
    /// * `chunk` - новый фрагмент данных (может быть пустым, но обычно не пуст)
    /// * `on_packet` - функция, вызываемая для каждого завершённого пакета
    ///                 (тип пакета + ссылка на данные без копирования)
    ///
    /// # Возвращает
    /// `Result<()>` – ошибка может возникнуть при переполнении payload, слишком большой странице
    /// или при ошибках в `handle_page_core`.
    ///
    /// # Примечания
    /// - Метод сохраняет состояние между вызовами (буфер `remainder`, `scanned_bytes` и т.д.).
    /// - Пустой `chunk` не обрабатывается здесь — вызывающий код должен самостоятельно вызвать `flush`.
    fn parse_core<F>(&mut self, chunk: &[u8], mut on_packet: F) -> Result<()>
    where F: FnMut(PacketType, &[u8]) -> Result<()> {
        // Добавляем новый фрагмент в конец остатка
        self.remainder.extend_from_slice(chunk);
        let mut cursor: usize = 0;

        loop {
            let available = self.remainder.len().saturating_sub(cursor);
            if available < 27 { break; }

            // Поиск сигнатуры OggS
            let search_start = cursor + self.scanned_bytes.saturating_sub(cursor);
            let window = &self.remainder[search_start..];

            let pos = match memmem::find(window, b"OggS") {
                Some(p) => search_start + p,
                None => {
                    // Мы сдвигаем курсор в самый конец буфера (оставляя 3 байта
                    cursor = self.remainder.len().saturating_sub(3);
                    self.scanned_bytes = cursor;
                    break;
                }
            };

            // Перемещаем курсор к началу найденной страницы
            cursor = pos;

            // Читаем заголовок страницы
            let page = &self.remainder[cursor..];

            // Безопасное извлечение количества сегментов
            let segments_count = *page.get(26).ok_or_else(|| Error::from_reason("Truncated page header"))? as usize;
            let header_size = 27 + segments_count;

            if page.len() < header_size { break; }

            let segment_table = &page[27..header_size];
            let mut payload_size: usize = 0;

            // Суммируем размеры сегментов, проверяя переполнение
            for &s in segment_table {
                payload_size += s as usize;
            }

            let page_end = header_size + payload_size;
            if page.len() < page_end { break; }

            // Обработка полной страницы
            let full_page = &page[..page_end];
            if let Err(_) = Self::handle_page_core(
                full_page,
                &mut self.packet_carry,
                &mut self.bitstream_serial,
                &mut on_packet
            ) {
                // Если страница битая, пропускаем сигнатуру и ищем дальше
                cursor += 4;
                self.scanned_bytes = cursor;
                continue;
            }

            cursor += page_end;
            self.scanned_bytes = cursor;
        }

        // Удаляем весь отработанный мусор и собранные страницы одним махом
        if cursor > 0 {
            self.remainder.drain(..cursor);
            // Корректируем `scanned_bytes`: вычитаем количество удалённых байт
            self.scanned_bytes = self.scanned_bytes.saturating_sub(cursor);
        }

        Ok(())
    }

    /// Обрабатывает одну полную Ogg-страницу: разбирает таблицу сегментов, собирает из них пакеты
    /// и вызывает функцию `on_packet` для каждого завершённого пакета.
    ///
    /// # Аргументы
    /// * `page` – полные данные страницы (заголовок + сегменты + полезная нагрузка)
    /// * `header_type` – флаги заголовка (continuation, BOS, EOS и т.д.)
    /// * `segments` – количество сегментов в таблице сегментов
    /// * `packet_carry` – буфер для текущего собираемого пакета (может содержать данные с предыдущей страницы)
    /// * `bitstream_serial` – текущий серийный номер потока (будет обновлён)
    /// * `waiting_for_head` – флаг ожидания заголовка OpusHead (может быть изменён)
    /// * `on_packet` – функция, вызываемый для каждого завершённого пакета (тип пакета + ссылка на данные)
    ///
    /// # Алгоритм
    /// 1. Определяем флаг `continued` – является ли эта страница продолжением предыдущего пакета.
    /// 2. Если страница не продолжает пакет, но в `packet_carry` что-то есть – значит предыдущий пакет был оборван,
    ///    и мы его сбрасываем (по спецификации Ogg).
    /// 3. Извлекаем серийный номер потока из байтов 14-17 (little-endian).
    /// 4. Если серийный номер изменился (и не равен -1) – это новый логический поток, сбрасываем состояние.
    /// 5. Обновляем `bitstream_serial`.
    /// 6. Если страница помечена как BOS (beginning of stream) – также сбрасываем состояние.
    /// 7. Проходим по всем сегментам из таблицы сегментов:
    ///    - Добавляем данные сегмента в `packet_carry`.
    ///    - Если размер сегмента меньше 255, это сигнал конца пакета. Вызываем `process_packet_core`
    ///      для обработки накопленного пакета, затем очищаем `packet_carry` для следующего.
    ///    - Если сегмент равен 255, пакет продолжается на следующем сегменте (или странице).
    /// 8. После обработки всех сегментов пакет может остаться в `packet_carry`, если последний сегмент был 255,
    ///    и будет продолжен на следующей странице.
    ///
    /// # Примечания
    /// - Функция не перемещает `packet_carry` (оставляет его владельцу), но очищает после завершённого пакета.
    /// - Используются безопасные проверки границ через `page.get(..)`, избегая паники.
    /// - `on_packet` получает ссылку на данные пакета без копирования (только чтение).
    fn handle_page_core<F>(page: &[u8], packet_carry: &mut Vec<u8>, bitstream_serial: &mut Option<i32>, on_packet: &mut F) -> Result<()>
    where F: FnMut(PacketType, &[u8]) -> Result<()> {
        let header_type = page[5];
        let continued = (header_type & 0x01) != 0;
        let bos = (header_type & 0x02) != 0;

        // Извлекаем серийный номер потока из байтов 14-17 (little-endian, как в спецификации Ogg)
        let serial = i32::from_le_bytes(page[14..18].try_into().unwrap());

        // Обновляем текущий серийный номер
        *bitstream_serial = Some(serial);

        // Если страница не является продолжением, но в буфере `packet_carry` уже есть данные,
        // значит предыдущий пакет был оборван (например, из-за ошибки в потоке). Сбрасываем его.
        // Сброс только при реальной смене потока
        if !continued || bos {
            packet_carry.clear();
        }

        // Таблица сегментов находится сразу после 27-байтового заголовка, занимает `segments` байт.
        let segments_count = page[26] as usize;
        let segment_table = &page[27..27 + segments_count];
        let mut offset = 27 + segments_count;

        // Проходим по всем сегментам
        for &s_len in segment_table {
            let s_len = s_len as usize; // размер текущего сегмента (0-255)
            let end = offset + s_len;

            // Безопасное копирование
            let data = page.get(offset..end).ok_or_else(|| Error::from_reason("Segment out of bounds"))?;

            // Добавляем данные сегмента в текущий собираемый пакет
            packet_carry.extend_from_slice(data);
            offset = end;

            // Если сегмент меньше 255, это сигнал конца пакета (по спецификации Ogg: пакет завершается,
            // когда встречается сегмент с размером <255, либо когда заканчиваются сегменты на странице).
            if s_len < 255 {
                let p_type = Self::detect_packet_type(packet_carry);
                on_packet(p_type, packet_carry)?;
                packet_carry.clear();
            }
        }

        Ok(())
    }

    /// Обрабатывает завершённый пакет: определяет его тип и, если он не должен быть
    /// проигнорирован, вызывает `on_packet`.
    ///
    /// Логика игнорирования:
    /// - Если ожидается заголовок (`waiting_for_head == true`) и пакет является фреймом,
    ///   он отбрасывается (поток ещё не синхронизирован).
    /// - Если пакет является Head, флаг `waiting_for_head` сбрасывается.
    fn process_packet_core<F>(packet: &mut Vec<u8>, on_packet: &mut F) -> Result<()>
    where F: FnMut(PacketType, &[u8]) -> Result<()> {
        // Пустой пакет игнорируем (не должен возникать, но на всякий случай).
        if packet.is_empty() { return Ok(()); }

        // Определяем тип пакета по его содержимому.
        let packet_type = Self::detect_packet_type(packet);

        // Передаём итоговые данные
        on_packet(packet_type, packet)?;

        // Очищаем буфер, сохраняя выделенную память для следующего пакета.
        packet.clear();

        Ok(())
    }

    /// Определяет тип пакета Opus по его начальным байтам.
    /// Возвращает PacketType только если пакет соответствует спецификации.
    #[inline]
    fn detect_packet_type(packet: &[u8]) -> PacketType {
        match packet.len() {
            0 => PacketType::Broken, // Пустой пакет
            3 => PacketType::Frame, // SILENT_FRAME
            1..=7 => PacketType::Broken, // Слишком короткий для Head/Tags
            _ => {
                match &packet[..8] {
                    b"OpusHead" => {
                        // Проверяем минимальную длину для валидного Head пакета (19 байт)
                        if packet.len() >= 19 {
                            PacketType::Head
                        } else {
                            PacketType::Broken // Битый Head
                        }
                    }
                    b"OpusTags" => {
                        // OpusTags должен быть минимум 8 байт
                        if packet.len() >= 8 {
                            PacketType::Tags
                        } else {
                            PacketType::Broken // Битый Tags
                        }
                    }
                    _ => PacketType::Frame,
                }
            }
        }
    }
}