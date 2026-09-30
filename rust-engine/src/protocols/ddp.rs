use byteorder::{BigEndian, ByteOrder};

/// Build DDP (Distributed Display Protocol) packets for WLED / ESP32.
/// Header length: 10 bytes.
/// Byte 0: Flags (0x40 frame push, 0x01 sequence enabled => 0x41)
/// Byte 1: Sequence number (1..=15 cycling)
/// Byte 2: Data type (0x01 = RGB)
/// Byte 3: Destination ID (0x01 default)
/// Byte 4-7: Offset in bytes (Big Endian)
/// Byte 8-9: Length of RGB payload in bytes (Big Endian)
pub struct DdpBuilder {
    sequence: u8,
}

impl DdpBuilder {
    pub fn new() -> Self {
        Self { sequence: 0 }
    }

    /// Increments sequence counter (1 to 15)
    fn next_sequence(&mut self) -> u8 {
        self.sequence = (self.sequence % 15) + 1;
        self.sequence
    }

    /// Build a single DDP packet with raw RGB bytes (e.g. up to 1440 RGB LEDs = 4320 bytes).
    /// If payload exceeds MAX_PACKET_SIZE, splits into sequenced chunks with PUSH flag on the final chunk.
    pub fn build_packets(&mut self, rgb_data: &[u8], offset_bytes: u32) -> Vec<Vec<u8>> {
        const MAX_DATA_PER_PACKET: usize = 1440 * 3; // 4320 bytes (fits under typical UDP MTU / WLED buffer)
        let total_len = rgb_data.len();

        if total_len <= MAX_DATA_PER_PACKET {
            let seq = self.next_sequence();
            let mut packet = vec![0u8; 10 + total_len];
            
            // Flags: 0x40 (Push frame immediately) | 0x01 (Sequence active)
            packet[0] = 0x41;
            packet[1] = seq;
            packet[2] = 0x01; // RGB
            packet[3] = 0x01; // Default Destination ID
            BigEndian::write_u32(&mut packet[4..8], offset_bytes);
            BigEndian::write_u16(&mut packet[8..10], total_len as u16);
            packet[10..].copy_from_slice(rgb_data);

            vec![packet]
        } else {
            // Fragment large frames across multiple DDP packets
            let mut packets = Vec::new();
            let mut current_offset = 0;

            while current_offset < total_len {
                let chunk_len = (total_len - current_offset).min(MAX_DATA_PER_PACKET);
                let is_last = current_offset + chunk_len >= total_len;
                let seq = self.next_sequence();

                let mut packet = vec![0u8; 10 + chunk_len];
                // Only set PUSH flag (0x40) on the last packet of the frame
                packet[0] = if is_last { 0x41 } else { 0x01 };
                packet[1] = seq;
                packet[2] = 0x01; // RGB
                packet[3] = 0x01;
                BigEndian::write_u32(&mut packet[4..8], offset_bytes + current_offset as u32);
                BigEndian::write_u16(&mut packet[8..10], chunk_len as u16);
                packet[10..].copy_from_slice(&rgb_data[current_offset..current_offset + chunk_len]);

                packets.push(packet);
                current_offset += chunk_len;
            }

            packets
        }
    }
}
