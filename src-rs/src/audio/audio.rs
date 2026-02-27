use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::VecDeque;

#[napi]
pub struct AudioEngine {
    buffer: VecDeque<Vec<u8>>,
    max_capacity: usize,
    position: usize,
}

#[napi]
impl AudioEngine {
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

    /// Добавляет один пакет в очередь
    #[napi]
    pub fn add_packet(&mut self, packet: Buffer) -> Result<()> {
        // Если переполнение — сбрасываем старые пакеты
        if self.buffer.len() >= self.max_capacity {
            self.buffer.pop_front();
        }
        
        self.buffer.push_back(packet.to_vec());
        Ok(())
    }

    /// Получить следующий пакет и продвинуть позицию
    #[napi(getter)]
    pub fn packet(&mut self) -> Option<Buffer> {
        let packet = self.buffer.pop_front();
        
        if packet.is_some() && self.position < self.max_capacity {
            self.position += 1;
        }

        packet.map(Buffer::from)
    }

    /// Получить несколько пакетов подряд и продвинуть позицию
    #[napi]
    pub fn get_packets(&mut self, count: u32) -> Vec<Buffer> {
        let mut result = Vec::with_capacity(count as usize);

        for _ in 0..count {
            if let Some(packet) = self.buffer.pop_front() {
                self.position = self.position.saturating_add(1);
                result.push(Buffer::from(packet));
            } else {
                break;
            }
        }

        result
    }

    /// Считать несколько пакетов за раз, без удаления
    #[napi]
    pub fn peek_packets(&self, count: u32) -> Vec<Buffer> {
        self.buffer
            .iter()
            .take(count as usize)
            .map(|p| Buffer::from(p.clone()))
            .collect()
    }

    /// Получить текущее количество пакетов в буфере
    #[napi(getter)]
    pub fn size(&self) -> u32 {
        self.buffer.len() as u32
    }

    /// Текущая позиция чтения
    #[napi(getter)]
    pub fn position(&self) -> u32 {
        self.position as u32
    }

    #[napi(setter)]
    pub fn set_position(&mut self, pos: u32) {
        self.position = pos as usize;
    }

    /// Очистка всего буфера
    #[napi]
    pub fn clear(&mut self) {
        self.buffer.clear();
        self.position = 0;
    }

    /// Получить пакет по позиции без удаления
    #[napi]
    pub fn get_packet_at(&self, idx: u32) -> Option<Buffer> {
        self.buffer.get(idx as usize).map(|p| Buffer::from(p.clone()))
    }

    /// Получить последний пакет в очереди
    #[napi(getter)]
    pub fn last_packet(&self) -> Option<Buffer> {
        self.buffer.back().map(|p| Buffer::from(p.clone()))
    }
}