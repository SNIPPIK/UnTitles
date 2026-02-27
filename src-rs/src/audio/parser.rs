use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub struct OggOpusParser {
    remainder: Vec<u8>,
    packet_carry: Vec<u8>,
    bitstream_serial: i32,
    waiting_for_head: bool,
}

#[napi]
impl OggOpusParser {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            remainder: Vec::with_capacity(32768),
            packet_carry: Vec::with_capacity(8192),
            bitstream_serial: -1,
            waiting_for_head: true,
        }
    }

    #[napi]
    pub fn parse(&mut self, env: Env, chunk: Buffer, emit: JsFunction) -> Result<()> {
        // Всегда добавляем новый чанк в remainder
        self.remainder.extend_from_slice(chunk.as_ref());

        let mut offset = 0;
        let work_len = self.remainder.len();

        while offset + 27 <= work_len {
            let current_slice = &self.remainder[offset..];

            if &current_slice[0..4] != b"OggS" {
                offset += 1;
                continue;
            }

            let segments_count = current_slice[26] as usize;
            let header_size = 27 + segments_count;

            if offset + header_size > work_len {
                break;
            }

            let segment_table = &current_slice[27..header_size];
            let payload_size: usize = segment_table.iter().map(|&x| x as usize).sum();

            if offset + header_size + payload_size > work_len {
                break;
            }

            let page_end = offset + header_size + payload_size;
            let page = self.remainder[offset..page_end].to_vec();
            self.handle_page(env, &page, segments_count, &emit)?;

            offset = page_end;
        }

        // Удаляем обработанную часть
        if offset > 0 {
            self.remainder.drain(0..offset);
        }

        Ok(())
    }

    fn handle_page(
        &mut self,
        env: Env,
        page: &[u8],
        segments_count: usize,
        emit: &JsFunction,
    ) -> Result<()> {
        let serial = i32::from_le_bytes(page[14..18].try_into().unwrap());

        if self.bitstream_serial != -1 && self.bitstream_serial != serial {
            self.packet_carry.clear();
            self.waiting_for_head = true;
        }

        self.bitstream_serial = serial;

        let segment_table = &page[27..27 + segments_count];
        let mut data_offset = 27 + segments_count;

        for &s_size in segment_table {
            let s_size = s_size as usize;

            self.packet_carry
                .extend_from_slice(&page[data_offset..data_offset + s_size]);

            data_offset += s_size;

            if s_size < 255 {
                self.process_packet(env, emit)?;
                self.packet_carry.clear();
            }
        }

        Ok(())
    }

    fn process_packet(&mut self, env: Env, emit: &JsFunction) -> Result<()> {
        if self.packet_carry.is_empty() {
            return Ok(());
        }

        let mut p_type = "frame";

        if self.packet_carry.len() >= 8 {
            if &self.packet_carry[0..8] == b"OpusHead" {
                p_type = "head";
                self.waiting_for_head = false;
            } else if &self.packet_carry[0..8] == b"OpusTags" {
                p_type = "tags";
            }
        }

        if self.waiting_for_head && p_type == "frame" {
            return Ok(());
        }

        let type_str = env.create_string(p_type)?;
        let buffer = env.create_buffer_copy(&self.packet_carry)?;
        
        // Если буфер не является пустышкой
        if !buffer.is_empty() {
            emit.call(None, &[type_str.into_unknown(), buffer.into_unknown()])?;
            return Ok(());
        }

        Ok(())
    }

    #[napi]
    pub fn destroy(&mut self) {
        self.remainder.clear();
        self.packet_carry.clear();
        self.bitstream_serial = -1;
        self.waiting_for_head = true;
    }
}
