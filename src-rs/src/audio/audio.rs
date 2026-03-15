use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::VecDeque;

/// Структура, представляющая движок аудио-буфера.
/// Хранит пакеты аудиоданных (например, кадры Opus) в виде очереди.
/// Позволяет добавлять, читать и просматривать пакеты, отслеживать позицию чтения.
#[napi]
pub struct AudioEngine {
    /// Очередь пакетов (VecDeque эффективна для добавления/удаления с обоих концов).
    buffer: VecDeque<Vec<u8>>,
    /// Максимальная ёмкость буфера в пакетах, рассчитывается из заданного количества минут.
    max_capacity: usize,
    /// Текущая позиция чтения (количество прочитанных пакетов с начала или после сброса).
    position: usize,
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
            buffer: VecDeque::with_capacity(capacity.max(1000)),
            max_capacity: capacity,
            position: 0,
        }
    }

    /// Добавляет один пакет в очередь.
    /// Если буфер переполнен (достигнут лимит по времени), удаляется самый старый пакет (FIFO).
    ///
    /// # Аргументы
    /// * `packet` – бинарный буфер с аудиоданными (из Node.js).
    #[napi]
    pub fn add_packet(&mut self, packet: Buffer) -> Result<()> {
        // Если переполнение — удаляем старый пакет
        if self.buffer.len() >= self.max_capacity {
            self.buffer.pop_front();
        }

        // Преобразуем Buffer в Vec<u8> для хранения в очереди
        self.buffer.push_back(packet.to_vec());
        Ok(())
    }

    /// Получает следующий пакет из очереди (удаляя его) и увеличивает позицию чтения.
    /// Возвращает `Option<Buffer>`, который можно передать обратно в JavaScript.
    #[napi(getter)]
    pub fn packet(&mut self) -> Option<Buffer> {
        self.buffer.pop_front().map(|data| {
            // Увеличиваем позицию только если реально вытащили данные
            if self.position < self.max_capacity {
                self.position += 1;
            }

            // Создает буфер, копируя данные.
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
            if let Some(packet) = self.buffer.pop_front() {
                // saturating_add предотвращает переполнение в очень редких случаях
                self.position = self.position.saturating_add(1);
                result.push(Buffer::from(packet));
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
        self.buffer
            .iter()
            .take(count as usize)
            .map(|p| Buffer::from(p.clone()))
            .collect()
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
        self.buffer.get(idx as usize).map(|p| Buffer::from(p.clone()))
    }

    /// Возвращает последний пакет в очереди (без удаления).
    #[napi(getter)]
    pub fn last_packet(&self) -> Option<Buffer> {
        self.buffer.back().map(|p| Buffer::from(p.clone()))
    }
}