use napi::bindgen_prelude::*;
use napi_derive::napi;
use memchr::memmem;

/// Максимально допустимый размер страницы Ogg в байтах.
/// Используется для защиты от некорректных или злонамеренных входных данных.
const MAX_PAGE_SIZE: usize = 1024 * 1024;

/// Тип пакета Opus, извлечённого из потока Ogg.
/// Соответствует трём возможным типам пакетов в спецификации Opus over Ogg.
#[derive(Debug, PartialEq, Copy, Clone)]
pub enum PacketType {
    Head,   // Заголовок идентификационного пакета ("OpusHead")
    Tags,   // Пакет с комментариями/тегами ("OpusTags")
    Frame,  // Аудио-фрейм (сами звуковые данные)
}

impl PacketType {
    /// Возвращает строковое представление типа пакета для передачи в JavaScript.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Head => "head",
            Self::Tags => "tags",
            Self::Frame => "frame",
        }
    }
}

/// Парсер Ogg Opus потока, работающий в режиме потока (streaming).
///
/// Разбивает входящие фрагменты данных на страницы Ogg, собирает пакеты
/// и классифицирует их как заголовки, теги или аудио-фреймы. Сохраняет
/// состояние между вызовами для обработки неполных страниц.
///
/// Предназначен для использования как из Rust (быстрый внутренний API),
/// так и из Node.js через N-API (метод `parse` с JS-вызовом).
#[napi]
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
    bitstream_serial: i32,

    /// Флаг ожидания заголовочного пакета (OpusHead). Если true, все кадры
    /// (PacketType::Frame) игнорируются до тех пор, пока не встретится Head.
    /// Необходимо для синхронизации с началом потока после переключения/сброса.
    waiting_for_head: bool,
}

#[napi]
impl OggOpusParser {
    /// Создаёт новый парсер с начальным состоянием.
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            remainder: Vec::with_capacity(32000),
            packet_carry: Vec::with_capacity(8192),
            bitstream_serial: -1,
            waiting_for_head: true,
        }
    }

    /// Node.js API: принимает фрагмент данных (Buffer) и вызывает JavaScript-функцию
    /// для каждого обнаруженного пакета.
    ///
    /// # Аргументы
    /// * `env` - окружение N-API (предоставляется автоматически)
    /// * `chunk` - буфер с новыми данными из потока
    /// * `emit` - JS-функция, которая будет вызвана с двумя аргументами:
    ///   - `kind` (string) – тип пакета ("head", "tags", "frame")
    ///   - `data` (Buffer) – бинарные данные пакета
    #[napi]
    pub fn parse(&mut self, env: Env, chunk: Buffer, emit: JsFunction) -> Result<()> {
        // Вызываем общий внутренний парсер, передавая замыкание,
        // которое для каждого пакета конвертирует данные в JS-значения и вызывает вызов.
        self.parse_core(chunk.as_ref(), |packet_type, data| {
            let kind = env.create_string(packet_type.as_str())?;
            let buffer = env.create_buffer_with_data(data)?; // копирует данные в JS-буфер
            emit.call(None, &[kind.into_unknown(), buffer.into_unknown()])?;
            Ok(())
        })
    }

    /// Внутренний Rust-ориентированный API (быстрый, без накладных расходов N-API).
    /// Принимает фрагмент данных и добавляет обнаруженные пакеты в переданный вектор `output`.
    ///
    /// # Аргументы
    /// * `chunk` - новые входные данные
    /// * `output` - вектор, в который будут добавлены кортежи (тип пакета, данные)
    pub fn parse_internal(
        &mut self,
        chunk: &[u8],
        output: &mut Vec<(PacketType, Vec<u8>)>,
    ) -> Result<()> {
        self.parse_core(chunk, |packet_type, data| {
            output.push((packet_type, data));
            Ok(())
        })
    }

    /// Основная логика парсинга, общая для обоих API.
    /// Обрабатывает входной фрагмент, извлекая полные Ogg-страницы и собирая пакеты.
    ///
    /// Алгоритм:
    /// 1. Добавляет новые данные в буфер `remainder`.
    /// 2. Ищет маркер начала страницы "OggS" (магическая сигнатура).
    /// 3. Проверяет, достаточно ли данных для чтения заголовка страницы (27 байт).
    /// 4. Из заголовка извлекает количество сегментов, вычисляет полный размер страницы.
    /// 5. Если все данные страницы присутствуют, передаёт её в `handle_page_core`.
    /// 6. Повторяет до тех пор, пока не закончатся полные страницы.
    /// 7. Оставляет неполные данные в `remainder` для следующего вызова.
    fn parse_core<F>(&mut self, chunk: &[u8], mut on_packet: F) -> Result<()>
    where
        F: FnMut(PacketType, Vec<u8>) -> Result<()>,
    {
        // Добавляем новый фрагмент к остатку предыдущих вызовов.
        self.remainder.extend_from_slice(chunk);

        let mut processed = 0;          // количество уже обработанных байт в remainder
        let total_len = self.remainder.len();

        // Пытаемся извлечь страницы, пока достаточно данных для минимального заголовка.
        while processed + 27 <= total_len {
            // Ищем паттерн "OggS" начиная с текущей позиции processed.
            let window = &self.remainder[processed..];
            let pos = match memmem::find(window, b"OggS") {
                Some(p) => p,
                None => break,           // маркер не найден — ждём ещё данных
            };

            // Сдвигаем processed до начала предполагаемой страницы.
            processed += pos;

            // Проверяем, хватает ли данных для заголовка (27 байт) после этого сдвига.
            if processed + 27 > total_len {
                break;
            }

            // Читаем заголовок страницы (первые 27 байт).
            let page = &self.remainder[processed..];

            let header_type = page[5];    // флаги заголовка (например, 0x02 = начало потока)
            let segments = page[26] as usize; // количество сегментов в таблице сегментов

            let header_size = 27 + segments; // полный размер заголовка (включая таблицу сегментов)

            // Проверяем, хватает ли данных для заголовка с таблицей сегментов.
            if processed + header_size > total_len {
                break;
            }

            // Таблица сегментов — это `segments` байт, каждый задаёт размер сегмента (0–255).
            let segment_table = &page[27..header_size];

            // Вычисляем общий размер полезной нагрузки (сумма всех размеров сегментов).
            let mut payload_size = 0;
            for &s in segment_table {
                payload_size += s as usize;
            }

            // Защита от слишком больших страниц (DoS).
            if payload_size > MAX_PAGE_SIZE {
                return Err(Error::from_reason("Ogg page too large"));
            }

            let page_end = processed + header_size + payload_size;

            // Проверяем, полностью ли страница присутствует в буфере.
            if page_end > total_len {
                break;
            }

            // Извлекаем полную страницу (заголовок + данные).
            let page = &self.remainder[processed..page_end];

            // Передаём страницу на обработку (разбор сегментов и сборка пакетов).
            Self::handle_page_core(
                page,
                header_type,
                segments,
                &mut self.packet_carry,
                &mut self.bitstream_serial,
                &mut self.waiting_for_head,
                &mut on_packet,
            )?;

            // Перемещаем указатель processed за конец обработанной страницы.
            processed = page_end;
        }

        // Удаляем обработанные данные из буфера remainder.
        if processed > 0 {
            self.remainder = self.remainder.split_off(processed);
        }

        Ok(())
    }

    /// Обрабатывает одну полную Ogg-страницу: разбирает сегменты и собирает из них пакеты.
    ///
    /// # Аргументы
    /// * `page` - полные данные страницы (включая заголовок)
    /// * `header_type` - поле flags из заголовка страницы
    /// * `segments` - количество сегментов в таблице сегментов
    /// * `packet_carry` - буфер для текущего собираемого пакета (может продолжаться на след-странице)
    /// * `bitstream_serial` - серийный номер потока (проверяется на смену)
    /// * `waiting_for_head` - флаг ожидания заголовочного пакета
    /// * `on_packet` - замыкание, вызываемое для каждого завершённого пакета
    fn handle_page_core<F>(
        page: &[u8],
        header_type: u8,
        segments: usize,
        packet_carry: &mut Vec<u8>,
        bitstream_serial: &mut i32,
        waiting_for_head: &mut bool,
        on_packet: &mut F,
    ) -> Result<()>
    where
        F: FnMut(PacketType, Vec<u8>) -> Result<()>,
    {
        // Извлекаем серийный номер потока (little-endian, байты 14-17).
        let serial = i32::from_le_bytes(
            page[14..18]
                .try_into()
                .map_err(|_| Error::from_reason("Invalid serial"))?,
        );

        // Если серийный номер изменился (и не равен -1), значит начался новый логический поток.
        // Очищаем буфер пакета и устанавливаем флаг ожидания заголовка.
        if *bitstream_serial != -1 && *bitstream_serial != serial {
            packet_carry.clear();
            *waiting_for_head = true;
        }

        // Обновляем текущий серийный номер.
        *bitstream_serial = serial;

        // Если страница помечена как "начало потока" (header_type & 0x02 != 0),
        // то любой недовыдушенный пакет с предыдущей страницы должен быть отброшен,
        // и мы снова ждём заголовок (по спецификации Ogg).
        if header_type & 0x02 != 0 {
            packet_carry.clear();
            *waiting_for_head = true;
        }

        // Таблица сегментов находится сразу после 27-байтового заголовка.
        let segment_table = &page[27..27 + segments];

        // Начало полезной нагрузки (после таблицы сегментов).
        let mut offset = 27 + segments;

        // Проходим по всем сегментам.
        for &s in segment_table {
            let s = s as usize;  // размер текущего сегмента (0-255)

            let end = offset + s;
            if end > page.len() {
                return Err(Error::from_reason("Segment overflow"));
            }

            // Добавляем данные сегмента в текущий собираемый пакет.
            packet_carry.extend_from_slice(&page[offset..end]);

            offset = end;

            // Если сегмент имеет размер меньше 255, это означает конец пакета (в Ogg пакет может
            // занимать несколько сегментов, и последний сегмент всегда <255, либо пакет завершается
            // на границе страницы). Если s < 255, пакет завершён.
            if s < 255 {
                // Обрабатываем накопленный пакет.
                Self::process_packet_core(packet_carry, waiting_for_head, on_packet)?;
                // Очищаем буфер для следующего пакета.
                packet_carry.clear();
            }
        }

        // Если мы дошли до конца страницы, а пакет не завершён (последний сегмент был 255),
        // то packet_carry остаётся с данными и будет дополнен на следующей странице.
        Ok(())
    }

    /// Обрабатывает завершённый пакет: определяет его тип и, если он не должен быть
    /// проигнорирован, вызывает `on_packet`.
    ///
    /// Логика игнорирования:
    /// - Если ожидается заголовок (`waiting_for_head == true`) и пакет является фреймом,
    ///   он отбрасывается (поток ещё не синхронизирован).
    /// - Если пакет является Head, флаг `waiting_for_head` сбрасывается.
    fn process_packet_core<F>(
        packet: &mut Vec<u8>,
        waiting_for_head: &mut bool,
        on_packet: &mut F,
    ) -> Result<()>
    where
        F: FnMut(PacketType, Vec<u8>) -> Result<()>,
    {
        // Пустой пакет игнорируем (не должен возникать, но на всякий случай).
        if packet.is_empty() {
            return Ok(());
        }

        // Определяем тип пакета по его содержимому.
        let packet_type = Self::detect_packet_type(packet);

        // Если это заголовочный пакет (OpusHead), снимаем флаг ожидания.
        if packet_type == PacketType::Head {
            *waiting_for_head = false;
        }

        // Если мы всё ещё ждём заголовок, а пакет — фрейм, пропускаем его.
        if *waiting_for_head && packet_type == PacketType::Frame {
            return Ok(());
        }

        // Забираем данные из packet (std::mem::take очищает вектор, оставляя его пустым).
        let data = std::mem::take(packet);

        // Вызываем пользовательский обработчик.
        on_packet(packet_type, data)
    }

    /// Определяет тип пакета Opus по его начальным байтам.
    /// Если пакет начинается с "OpusHead" — это Head, если с "OpusTags" — Tags,
    /// иначе — Frame.
    fn detect_packet_type(packet: &[u8]) -> PacketType {
        // Проверяем, что длина достаточна для сравнения (минимум 8 байт).
        if packet.len() >= 8 {
            if &packet[..8] == b"OpusHead" {
                return PacketType::Head;
            }
            if &packet[..8] == b"OpusTags" {
                return PacketType::Tags;
            }
        }
        PacketType::Frame
    }

    /// Сбрасывает состояние парсера в исходное.
    /// Может быть полезно для обработки нового потока без создания нового объекта.
    #[napi]
    pub fn destroy(&mut self) {
        self.remainder.clear();
        self.packet_carry.clear();
        self.bitstream_serial = -1;
        self.waiting_for_head = true;
    }
}