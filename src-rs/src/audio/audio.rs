use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::VecDeque;

#[napi]
pub struct AudioEngine {
    buffer: VecDeque<Vec<u8>>,
    max_capacity: usize, // Для ограничения по времени (например, 8 минут)
    position: usize,
}

#[napi]
impl AudioEngine {
    #[napi(constructor)]
    pub fn new(max_minutes: u32) -> Self {
        // 50 пакетов в секунду * 60 секунд * минуты
        let capacity = (50 * 60 * max_minutes) as usize;
        Self {
            buffer: VecDeque::with_capacity(if max_minutes > 0 { 1000 } else { capacity }),
            max_capacity: capacity,
            position: 0,
        }
    }

    #[napi]
    pub fn add_packet(&mut self, packet: Buffer) {
        if self.max_capacity == 0 || self.buffer.len() < self.max_capacity {
            self.buffer.push_back(packet.to_vec());
        }
    }

    #[napi(getter)]
    pub fn packet(&mut self) -> Option<Buffer> {
        self.buffer.pop_front().map(Buffer::from)
    }

    #[napi(getter)]
    pub fn size(&self) -> u32 {
        self.buffer.len() as u32
    }

    #[napi(getter)]
    pub fn position(&self) -> u32 {
        self.position as u32
    }

    #[napi(setter)]
    pub fn set_position(&mut self, pos: u32) {
        self.position = pos as usize;
    }

    #[napi]
    pub fn clear(&mut self) {
        self.buffer.clear();
        self.position = 0;
    }
}