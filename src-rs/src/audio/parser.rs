use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Максимальный допустимый размер Ogg-страницы (в байтах) для защиты от битых данных.
const MAX_PAGE_SIZE: usize = 1024 * 1024; // 1 MB

/// Типы пакетов Opus
#[derive(Debug, PartialEq)]
enum PacketType {
    Head,  // OpusHead
    Tags,  // OpusTags
    Frame, // аудиоданные
}

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
        self.remainder.extend_from_slice(chunk.as_ref());

        let total_len = self.remainder.len();
        let mut processed = 0;

        while processed + 27 <= total_len {
            let window = &self.remainder[processed..];

            // Ищем следующую сигнатуру "OggS"
            let pos = match window.windows(4).position(|w| w == b"OggS") {
                Some(p) => p,
                None => break,
            };
            processed += pos;
            if processed + 27 > total_len {
                break;
            }
            let window = &self.remainder[processed..];

            let header_type = window[5];
            let segments_count = window[26] as usize;
            let header_size = 27 + segments_count;

            if processed + header_size > total_len {
                break;
            }

            let segment_table = &window[27..header_size];
            let payload_size: usize = segment_table.iter().map(|&b| b as usize).sum();

            if payload_size > MAX_PAGE_SIZE {
                return Err(Error::from_reason(format!(
                    "Ogg page payload too large: {} bytes (max {})",
                    payload_size, MAX_PAGE_SIZE
                )));
            }

            let page_end = processed + header_size + payload_size;
            if page_end > total_len {
                break;
            }

            let page = &self.remainder[processed..page_end];

            Self::handle_page(
                env,
                page,
                header_type,
                segments_count,
                &emit,
                &mut self.packet_carry,
                &mut self.bitstream_serial,
                &mut self.waiting_for_head,
            )?;

            processed = page_end;
        }

        if processed > 0 {
            self.remainder = self.remainder.split_off(processed);
        }

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn handle_page(
        env: Env,
        page: &[u8],
        header_type: u8,
        segments_count: usize,
        emit: &JsFunction,
        packet_carry: &mut Vec<u8>,
        bitstream_serial: &mut i32,
        waiting_for_head: &mut bool,
    ) -> Result<()> {
        if page.len() < 27 + segments_count {
            return Err(Error::from_reason("Page too short for segment table"));
        }

        let serial = i32::from_le_bytes(
            page.get(14..18)
                .and_then(|s| s.try_into().ok())
                .ok_or_else(|| Error::from_reason("Invalid Ogg page: missing serial"))?,
        );

        // Смена потока
        if *bitstream_serial != -1 && *bitstream_serial != serial {
            packet_carry.clear();
            *waiting_for_head = true;
        }
        *bitstream_serial = serial;

        let bos = (header_type & 0x02) != 0;

        if bos {
            packet_carry.clear();
            *waiting_for_head = true;
        }

        let segment_table = &page[27..27 + segments_count];
        let mut data_offset = 27 + segments_count;

        for &s_size in segment_table {
            let s_size = s_size as usize;

            if data_offset + s_size > page.len() {
                return Err(Error::from_reason("Segment exceeds page length"));
            }

            packet_carry.extend_from_slice(&page[data_offset..data_offset + s_size]);
            data_offset += s_size;

            if s_size < 255 {
                let _ = Self::process_packet(env, emit, packet_carry, waiting_for_head)?;
                packet_carry.clear();
            }
        }

        Ok(())
    }

    fn process_packet(
        env: Env,
        emit: &JsFunction,
        packet_carry: &mut Vec<u8>,
        waiting_for_head: &mut bool,
    ) -> Result<bool> {
        if packet_carry.is_empty() {
            return Ok(false);
        }

        let packet_type = Self::detect_packet_type(packet_carry);

        if packet_type == PacketType::Head {
            *waiting_for_head = false;
        }

        if *waiting_for_head && packet_type == PacketType::Frame {
            return Ok(false);
        }

        let type_str = env.create_string(match packet_type {
            PacketType::Head => "head",
            PacketType::Tags => "tags",
            PacketType::Frame => "frame",
        })?;

        let data = std::mem::take(packet_carry);
        let buffer = env.create_buffer_with_data(data)?;

        emit.call(None, &[type_str.into_unknown(), buffer.into_unknown()])?;

        Ok(true)
    }

    fn detect_packet_type(packet: &[u8]) -> PacketType {
        if packet.len() >= 8 {
            if &packet[0..8] == b"OpusHead" {
                return PacketType::Head;
            } else if &packet[0..8] == b"OpusTags" {
                return PacketType::Tags;
            }
        }
        PacketType::Frame
    }

    #[napi]
    pub fn destroy(&mut self) {
        self.remainder.clear();
        self.packet_carry.clear();
        self.bitstream_serial = -1;
        self.waiting_for_head = true;
    }
}

impl Drop for OggOpusParser {
    fn drop(&mut self) {
        self.destroy();
    }
}