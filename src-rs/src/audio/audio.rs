use crate::audio::ring_buffer::RingBuffer;
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Структура, представляющая движок аудио-буфера.
/// Хранит пакеты аудиоданных (например, кадры Opus) в виде очереди.
/// Позволяет добавлять, читать и просматривать пакеты, отслеживать позицию чтения.
#[napi]
pub struct AudioEngine {
    /// Очередь пакетов (VecDeque эффективна для добавления/удаления с обоих концов).
    buffer: RingBuffer,

    /// Максимальная ёмкость буфера в пакетах, рассчитывается из заданного количества минут.
    max_capacity: usize,

    /// Текущая позиция чтения (количество прочитанных пакетов с начала или после сброса).
    position: usize
}

#[napi]
impl AudioEngine {
    /// Создаёт новый экземпляр AudioEngine.
    ///
    /// # Аргументы
    /// * `max_minutes` – максимальное количество минут аудио, которое может храниться в буфере.
    ///
    /// # Расчёт ёмкости
    /// Исход из того, что в секунду передаётся 50 пакетов (например, для 20 мс кадров Opus).
    /// Ёмкость = 50 пакетов/сек * 60 сек * max_minutes.
    /// Минимальная ёмкость – 1000 пакетов.
    #[napi(constructor)]
    pub fn new(max_minutes: u32) -> Self {
        // 50 пакетов в секунду * 60 секунд * минуты
        let capacity = (50 * 60 * max_minutes) as usize;
        Self {
            buffer: RingBuffer::new(capacity),
            max_capacity: capacity,
            position: 0,
        }
    }

    /// Проверяет, можно ли "слать" аудио в буфер.
    /// Возвращает true, если текущая нагрузка позволяет добавить данные без немедленного удаления старых.
    /// По сути, это проверка: "есть ли свободное место?".
    #[napi]
    pub fn can_accept(&self) -> bool {
        self.buffer.len() < self.max_capacity
    }

    /// Более "умная" проверка для системы запросов.
    /// Возвращает true, если буфер заполнен менее чем на указанный процент.
    /// Например, если передать 80, функция вернет false, когда буфер забит на 80%+.
    /// Это позволяет оставить "запас" для плавности.
    #[napi]
    pub fn can_accept_threshold(&self, threshold_percent: u32) -> bool {
        let threshold = (self.max_capacity * threshold_percent as usize) / 100;
        self.buffer.len() < threshold
    }

    /// Добавляет один пакет в очередь.
    /// Если буфер переполнен (достигнут лимит по времени), удаляется самый старый пакет (FIFO).
    ///
    /// # Аргументы
    /// * `packet` – бинарный буфер с аудиоданными (из Node.js).
    #[napi]
    pub fn add_packet(&mut self, packet: Buffer) -> Result<()> {
        let data = packet.to_vec();

        // Пытаемся добавить в кольцевой буфер
        if let Err(returned_data) = self.buffer.push(data) {
            // Если буфер полон (и это не ошибка размера) — вытесняем старый пакет (FIFO)
            if self.buffer.len() >= self.max_capacity {
                self.buffer.pop();
                let _ = self.buffer.push(returned_data);
            }
        }
        Ok(())
    }

    /// Добавляет несколько пакетов в очередь.
    ///
    /// # Аргументы
    /// * `packets` – массив бинарных буферов (из Node.js)
    #[napi]
    pub fn add_packets(&mut self, packets: Vec<Buffer>) -> Result<()> {
        for packet in packets {
            let _ = self.add_packet(packet);
        }

        Ok(())
    }

    /// Получает следующий пакет из очереди (удаляя его) и увеличивает позицию чтения.
    /// Возвращает `Option<Buffer>`, который можно передать обратно в JavaScript.
    #[napi(getter)]
    pub fn packet(&mut self) -> Option<Buffer> {
        self.buffer.pop().map(|data| {
            self.position = self.position.saturating_add(1);
            Buffer::from(data)
        })
    }

    /// Получает несколько пакетов подряд (удаляя их) и увеличивает позицию на соответствующее количество.
    ///
    /// # Аргументы
    /// * `count` – максимальное количество пакетов для получения.
    ///
    /// # Возвращает
    /// Вектор Buffer (может быть меньше запрошенного, если пакетов недостаточно).
    #[napi]
    pub fn get_packets(&mut self, count: u32) -> Vec<Buffer> {
        let mut result = Vec::with_capacity(count as usize);
        for _ in 0..count {
            if let Some(data) = self.buffer.pop() {
                self.position = self.position.saturating_add(1);
                result.push(Buffer::from(data));
            } else {
                break;
            }
        }
        result
    }

    /// Считывает несколько пакетов без удаления из очереди (просмотр).
    ///
    /// # Аргументы
    /// * `count` – количество пакетов для просмотра.
    ///
    /// # Возвращает
    /// Вектор Buffer, представляющих копии данных (осторожно: клонирование больших объёмов).
    #[napi]
    pub fn peek_packets(&self, count: u32) -> Vec<Buffer> {
        let mut result = Vec::with_capacity(count as usize);
        for i in 0..count {
            if let Some(data) = self.buffer.get_clone_at(i as usize) {
                result.push(Buffer::from(data));
            } else {
                break;
            }
        }
        result
    }

    /// Возвращает текущее количество пакетов в буфере.
    #[napi(getter)]
    pub fn size(&self) -> u32 {
        self.buffer.len() as u32
    }

    /// Возвращает текущую позицию чтения (количество извлечённых пакетов).
    #[napi(getter)]
    pub fn position(&self) -> u32 {
        self.position as u32
    }

    /// Устанавливает позицию чтения вручную (может использоваться для перемотки).
    #[napi(setter)]
    pub fn set_position(&mut self, pos: u32) {
        self.position = pos as usize;
    }

    /// Полностью очищает буфер и сбрасывает позицию в 0.
    #[napi]
    pub fn clear(&mut self) {
        self.buffer.clear();
        self.position = 0;
    }

    /// Получает пакет по индексу без удаления (прямой доступ).
    /// Индексация с 0.
    #[napi]
    pub fn get_packet_at(&self, idx: u32) -> Option<Buffer> {
        self.buffer.get_clone_at(idx as usize).map(Buffer::from)
    }

    /// Возвращает последний пакет в очереди (без удаления).
    #[napi(getter)]
    pub fn last_packet(&self) -> Option<Buffer> {
        let current_len = self.buffer.len();
        if current_len == 0 {
            None
        } else {
            self.get_packet_at((current_len - 1) as u32)
        }
    }
}