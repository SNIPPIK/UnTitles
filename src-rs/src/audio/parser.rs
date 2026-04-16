use napi::bindgen_prelude::*;
use crc::{Crc, Algorithm};
use napi_derive::napi;
use memchr::memmem;

// Конфигурация по спецификации Ogg (RFC 3533)
const OGG_CRC: Crc<u32> = Crc::<u32>::new(&Algorithm {
    width: 32,
    poly: 0x04C11DB7,
    init: 0x00000000,
    refin: false,
    refout: false,
    xorout: 0x00000000,
    check: 0x00000000,
    residue: 0xFFFFFFFF
});

/// Тип пакета Opus, извлечённого из потока Ogg.
/// Соответствует трём возможным типам пакетов в спецификации Opus over Ogg.
#[derive(Debug, PartialEq, Copy, Clone)]
pub enum PacketType {
    Head,
    Tags,
    Frame
}

impl PacketType {
    /// Возвращает строковое представление типа пакета для передачи в JavaScript.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Head => "head",
            Self::Tags => "tags",
            Self::Frame => "frame"
        }
    }
}

/// Объект, возвращаемый в JavaScript
#[napi(object)]
pub struct JsOpusPacket {
    pub kind: String,
    pub data: Buffer
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

#[napi]
impl OggOpusParser {
    /// Создаёт новый парсер с начальным состоянием.
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            remainder: Vec::with_capacity(1024 * 5),
            packet_carry: Vec::with_capacity(1024 * 2),
            bitstream_serial: -1,
            scanned_bytes: 0
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
    pub fn parse(&mut self, chunk: Buffer) -> Result<Vec<JsOpusPacket>> {
        let data = chunk.as_ref();
        let mut js_packets = Vec::with_capacity(10); // Эвристика для батчинга

        if data.is_empty() {
            // Пустой буфер — сигнал конца потока, сбрасываем остатки
            let mut remaining = Vec::new();
            self.flush_internal(&mut remaining)?;
            for (packet_type, pkt_data) in remaining {
                js_packets.push(JsOpusPacket {
                    kind: packet_type.as_str().to_string(),
                    data: pkt_data.into(),
                });
            }
            return Ok(js_packets);
        }

        // Вызываем общий внутренний парсер, передавая замыкание,
        // которое для каждого пакета конвертирует данные в JS-значения и вызывает вызов.
        self.parse_core(data, |packet_type, packet_slice| {
            // Копируем срез памяти напрямую в V8 Buffer, избегая промежуточного Vec
            js_packets.push(JsOpusPacket {
                kind: packet_type.as_str().to_string(),
                data: Buffer::from(packet_slice),
            });
            Ok(())
        })?;

        Ok(js_packets)
    }

    /// Внутренний Rust-ориентированный API (быстрый, без накладных расходов N-API).
    /// Принимает фрагмент данных и добавляет обнаруженные пакеты в переданный вектор `output`.
    ///
    /// # Аргументы
    /// * `chunk` - новые входные данные
    /// * `output` - вектор, в который будут добавлены кортежи (тип пакета, данные)
    pub fn parse_internal(&mut self, chunk: &[u8], output: &mut Vec<(PacketType, Vec<u8>)>) -> Result<()> {
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
    fn flush_internal(&mut self, output: &mut Vec<(PacketType, Vec<u8>)>) -> Result<()> {
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

    /// Принудительно извлекает все оставшиеся данные из парсера и завершает обработку потока.
    ///
    /// Этот метод должен вызываться после того, как все входные данные были переданы в парсер
    /// (например, при закрытии потока или достижении EOF). Он обрабатывает ситуацию, когда
    /// в буферах парсера остались неполные данные, которые не могут быть завершены обычным
    /// способом из-за отсутствия последующих страниц Ogg.
    ///
    /// # Алгоритм
    /// 1. Проверяет наличие необработанных данных в `remainder` (неполные страницы).
    /// 2. Если в `packet_carry` есть накопленный пакет, который не был завершён из-за
    ///    отсутствия последнего сегмента (<255), он обрабатывается как завершённый пакет.
    /// 3. Все пакеты добавляются в `output` для отправки в JS.
    ///
    /// # Примечания по безопасности
    /// - Неполные страницы в `remainder` (без маркера "OggS") отбрасываются, так как по
    ///   спецификации Ogg пакет может быть завершён только внутри полной страницы.
    /// - Если `packet_carry` содержит данные, они считаются последним пакетом потока.
    /// - Флаг `waiting_for_head` игнорируется, так как при завершении потока мы всё равно
    ///   отдаём всё, что накопили, даже если заголовок не был получен (это позволит избежать
    ///   потери данных в случае обрыва соединения).
    ///
    /// # Возвращаемое значение
    /// - `Ok(())` — успешно обработаны остатки.
    /// - `Err` — ошибка при обработке пакета (например, недопустимый тип).
    #[napi]
    pub fn flush(&mut self) -> Result<Vec<JsOpusPacket>> {
        let mut internal_output = Vec::new();
        self.flush_internal(&mut internal_output)?;

        let js_packets = internal_output.into_iter().map(|(kind, data)| JsOpusPacket {
            kind: kind.as_str().to_string(),
            data: Buffer::from(data),
        }).collect();

        Ok(js_packets)
    }

    /// Основная логика парсинга Ogg-потока.
    ///
    /// Добавляет новый фрагмент данных в буфер `remainder`, затем циклически извлекает
    /// полные Ogg-страницы, обрабатывает их и вызывает колбэк `on_packet` для каждого
    /// собранного пакета. Реализована оптимизация поиска маркера "OggS" с использованием
    /// поля `scanned_bytes`, чтобы не пересканировать уже проверенные участки буфера.
    ///
    /// # Аргументы
    /// * `chunk` - новый фрагмент данных (может быть пустым, но обычно не пуст)
    /// * `on_packet` - колбэк, вызываемый для каждого завершённого пакета
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
        let mut cursor: usize = 0; // текущая позиция в remainder (начало необработанных данных)

        loop {
            let available = self.remainder.len().saturating_sub(cursor);
            if available < 27 {
                // Не хватает данных даже для минимального заголовка Ogg-страницы (27 байт)
                break;
            }

            // Оптимизированный поиск маркера "OggS"
            // Начинаем поиск с позиции, где мы ещё не искали (max(cursor, scanned_bytes))
            let search_start = cursor + self.scanned_bytes.saturating_sub(cursor);
            let window = &self.remainder[search_start..];

            let pos = match memmem::find(window, b"OggS") {
                Some(p) => {
                    // Маркер найден на позиции p относительно окна; абсолютная позиция в remainder:
                    search_start + p
                }
                None => {
                    // Маркер не найден во всей оставшейся части.
                    // Чтобы не сканировать её заново при следующем вызове, запоминаем,
                    // что до конца буфера (минус 3 байта) маркера нет.
                    // Вычитаем 3, потому что маркер "OggS" (4 байта) может быть разорван на границе чанков.
                    self.scanned_bytes = search_start.saturating_sub(3);
                    break;
                }
            };

            cursor = pos;
            self.scanned_bytes = cursor; // все байты до cursor уже проверены

            // Читаем заголовок страницы
            let page = &self.remainder[cursor..];
            let segments = page[26] as usize;          // количество сегментов в таблице сегментов
            let header_size = 27 + segments;           // полный размер заголовка (27 + таблица)

            // Таблица сегментов — это `segments` байт, каждый задаёт размер сегмента (0–255).
            let segment_table = &page[27..header_size];
            let mut payload_size: usize = 0;

            // Суммируем размеры сегментов, проверяя переполнение
            for &s in segment_table {
                payload_size = payload_size
                    .checked_add(s as usize)
                    .ok_or_else(|| Error::from_reason("Payload overflow"))?;
            }

            let page_end = cursor + header_size + payload_size;

            // Если в текущий пакет не удается вместить все
            if self.remainder.len() < page_end {
                break; // страница неполная, ждём ещё данных
            }

            // Извлекаем полную страницу (заголовок + сегменты + полезная нагрузка)
            let full_page = &self.remainder[cursor..page_end];

            // Если CRC не прошел — страница битая, ищем следующий маркер
            if !Self::verify_ogg_crc(full_page) {
                println!("CRC mismatch! Skipping page...");
                //cursor += 4; // Сдвигаемся за "OggS"
                self.scanned_bytes = 0;//cursor;
                break;
            }

            // Обрабатываем страницу: разбираем сегменты, собираем пакеты
            if let Err(_err) = Self::handle_page_core(full_page, full_page[5], segments, &mut self.packet_carry, &mut self.bitstream_serial, &mut on_packet) {
                // В идеале тут нужно логирование ошибки (например, через console.warn в JS)
                // Чтобы не зациклиться, сдвигаем курсор на 1 байт вперед, чтобы на следующей
                // итерации memmem начал искать следующий "OggS"
                cursor += 4;
                self.scanned_bytes = cursor;
                break;
            }

            // Перемещаем курсор за обработанную страницу
            cursor = page_end;
            self.scanned_bytes = cursor;
        }

        // Удаляем из `remainder` все полностью обработанные байты (от 0 до cursor)
        if cursor > 0 {
            self.remainder.drain(..cursor);
            // Корректируем `scanned_bytes`: вычитаем количество удалённых байт
            self.scanned_bytes = self.scanned_bytes.saturating_sub(cursor);
        }

        Ok(())
    }

    /// Обрабатывает одну полную Ogg-страницу: разбирает таблицу сегментов, собирает из них пакеты
    /// и вызывает колбэк `on_packet` для каждого завершённого пакета.
    ///
    /// # Аргументы
    /// * `page` – полные данные страницы (заголовок + сегменты + полезная нагрузка)
    /// * `header_type` – флаги заголовка (continuation, BOS, EOS и т.д.)
    /// * `segments` – количество сегментов в таблице сегментов
    /// * `packet_carry` – буфер для текущего собираемого пакета (может содержать данные с предыдущей страницы)
    /// * `bitstream_serial` – текущий серийный номер потока (будет обновлён)
    /// * `waiting_for_head` – флаг ожидания заголовка OpusHead (может быть изменён)
    /// * `on_packet` – колбэк, вызываемый для каждого завершённого пакета (тип пакета + ссылка на данные)
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
    fn handle_page_core<F>(page: &[u8], header_type: u8, segments: usize, packet_carry: &mut Vec<u8>, bitstream_serial: &mut i32, on_packet: &mut F) -> Result<()>
    where F: FnMut(PacketType, &[u8]) -> Result<()> {
        // Флаг 0x01 в header_type означает, что этот пакет продолжает предыдущий (continuation)
        let continued = (header_type & 0x01) != 0;
        let bos = (header_type & 0x02) != 0;

        // Извлекаем серийный номер потока из байтов 14-17 (little-endian, как в спецификации Ogg)
        let serial = i32::from_le_bytes(
            page[14..18]
                .try_into()
                .map_err(|_| Error::from_reason("Invalid serial"))?,
        );

        // Если страница не является продолжением, но в буфере `packet_carry` уже есть данные,
        // значит предыдущий пакет был оборван (например, из-за ошибки в потоке). Сбрасываем его.
        if !continued && !packet_carry.is_empty() {
            packet_carry.clear();
        }

        // Если серийный номер изменился (и не равен -1, что означает первый поток), то начался новый
        // логический поток. Сбрасываем состояние: очищаем буфер пакета и переходим в режим ожидания заголовка.
        if *bitstream_serial != -1 || *bitstream_serial != serial {
            if *bitstream_serial != -1 {
                packet_carry.clear();
            }
            *bitstream_serial = serial;
        }

        // Если страница помечена как "начало потока" (BOS – header_type & 0x02), также сбрасываем состояние.
        // BOS означает, что это первая страница в новом потоке, и предыдущее состояние невалидно.
        if bos {
            packet_carry.clear();
            *bitstream_serial = 0;
        }

        // Обновляем текущий серийный номер
        //if serial != *bitstream_serial {*bitstream_serial = serial;}

        // Таблица сегментов находится сразу после 27-байтового заголовка, занимает `segments` байт.
        let segment_table = page
            .get(27..27 + segments)
            .ok_or_else(|| Error::from_reason("Segment table out of bounds"))?;
        let mut offset = 27 + segments; // начало полезной нагрузки (первый сегмент)

        // Проходим по всем сегментам
        for &s in segment_table {
            let s = s as usize; // размер текущего сегмента (0-255)
            let end = offset + s;

            // Безопасно извлекаем данные сегмента (с проверкой границ)
            let segment_data = page
                .get(offset..end)
                .ok_or_else(|| Error::from_reason("Segment data out of bounds"))?;

            // Добавляем данные сегмента в текущий собираемый пакет
            packet_carry.extend_from_slice(segment_data);
            offset = end;

            // Если сегмент меньше 255, это сигнал конца пакета (по спецификации Ogg: пакет завершается,
            // когда встречается сегмент с размером <255, либо когда заканчиваются сегменты на странице).
            if s < 255 {
                // Обрабатываем накопленный пакет (определяем тип, отбрасываем фреймы до заголовка и т.д.)
                Self::process_packet_core(packet_carry, on_packet)?;
                // Очищаем буфер для следующего пакета (сохраняем выделенную память)
                packet_carry.clear();
            }
            // Если s == 255, пакет продолжается на следующем сегменте (или на следующей странице)
        }

        // Если после обработки всех сегментов `packet_carry` не пуст, значит последний сегмент был 255,
        // и пакет будет продолжен на следующей странице. Оставляем его в буфере.
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
    /// Если пакет начинается с "OpusHead" — это Head, если с "OpusTags" — Tags,
    /// иначе — Frame.
    fn detect_packet_type(packet: &[u8]) -> PacketType {
        // Проверяем, что длина достаточна для сравнения (минимум 8 байт).
        if packet.len() == 8 {
            if &packet[..8] == b"OpusHead" {
                return PacketType::Head;
            }
            if &packet[..8] == b"OpusTags" {
                return PacketType::Tags;
            }
        }
        PacketType::Frame
    }

    /// Проверка страницы на целостность, если страница сломана то пропуск ее
    fn verify_ogg_crc(page: &[u8]) -> bool {
        if page.len() < 27 { return false; }

        // Извлекаем CRC из страницы (байты 22-25)
        let original_crc = u32::from_le_bytes([page[22], page[23], page[24], page[25]]);

        let mut digest = OGG_CRC.digest();

        digest.update(&page[0..22]);
        digest.update(&[0, 0, 0, 0]);
        digest.update(&page[26..]);

        let calculated_crc = digest.finalize();

        calculated_crc == original_crc
    }

    /// Сбрасывает состояние парсера в исходное.
    /// Может быть полезно для обработки нового потока без создания нового объекта.
    #[napi]
    pub fn destroy(&mut self) {
        self.remainder.clear();
        self.packet_carry.clear();
        self.bitstream_serial = -1;
        self.scanned_bytes = 0;
    }
}