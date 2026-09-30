use byteorder::{BigEndian, ByteOrder};

/// ANSI E1.31 (sACN) Packet Builder.
/// Default sACN port: 5568.
/// Multicast IP pattern: 239.255.(universe >> 8).(universe & 0xFF)
pub struct SacnBuilder {
    sequence: u8,
    cid: [u8; 16],
    source_name: String,
}

impl SacnBuilder {
    pub fn new(source_name: &str) -> Self {
        // Unique 16-byte Component Identifier (CID) for the Rust Engine
        let cid = [
            0x4a, 0x9f, 0x18, 0x22, 0xe1, 0x31, 0x4f, 0xaa,
            0xbb, 0xcc, 0xdd, 0xee, 0x11, 0x22, 0x33, 0x44,
        ];
        Self {
            sequence: 0,
            cid,
            source_name: source_name.chars().take(63).collect(),
        }
    }

    fn next_sequence(&mut self) -> u8 {
        self.sequence = self.sequence.wrapping_add(1);
        self.sequence
    }

    /// Calculate multicast IPv4 string for a given universe
    pub fn multicast_ip_for_universe(universe: u16) -> String {
        let hi = (universe >> 8) as u8;
        let lo = (universe & 0xFF) as u8;
        format!("239.255.{}.{}", hi, lo)
    }

    /// Builds a full 126-byte sACN header + DMX data payload (max 512 channels)
    pub fn build_universe_packet(&mut self, universe: u16, dmx_channels: &[u8], priority: u8) -> Vec<u8> {
        let channel_count = dmx_channels.len().min(512);
        let mut packet = vec![0u8; 126 + channel_count];

        // --- 1. Root Layer (38 bytes) ---
        BigEndian::write_u16(&mut packet[0..2], 0x0010); // Preamble size
        BigEndian::write_u16(&mut packet[2..4], 0x0000); // Post-amble size
        packet[4..16].copy_from_slice(b"ASC-E1.17\0\0\0"); // ACN Packet Identifier
        let root_length = (110 + channel_count) as u16;
        BigEndian::write_u16(&mut packet[16..18], 0x7000 | (root_length & 0x0FFF)); // Flags & Length
        BigEndian::write_u32(&mut packet[18..22], 0x00000004); // Vector: Root VECTOR_ROOT_E131_DATA
        packet[22..38].copy_from_slice(&self.cid); // Sender CID

        // --- 2. Framing Layer (77 bytes) ---
        let framing_length = (88 + channel_count) as u16;
        BigEndian::write_u16(&mut packet[38..40], 0x7000 | (framing_length & 0x0FFF)); // Flags & Length
        BigEndian::write_u32(&mut packet[40..44], 0x00000002); // Vector: VECTOR_E131_DATA_PACKET

        // Source Name (64 bytes null-padded)
        let name_bytes = self.source_name.as_bytes();
        let copy_len = name_bytes.len().min(63);
        packet[44..44 + copy_len].copy_from_slice(&name_bytes[..copy_len]);

        packet[108] = priority.clamp(1, 200); // Priority
        BigEndian::write_u16(&mut packet[109..111], 0x0000); // Synchronization Address (0 = inactive)
        packet[111] = self.next_sequence(); // Sequence number
        packet[112] = 0x00; // Options
        BigEndian::write_u16(&mut packet[113..115], universe); // Universe ID

        // --- 3. DMP Layer (11 bytes + channels) ---
        let dmp_length = (11 + channel_count) as u16;
        BigEndian::write_u16(&mut packet[115..117], 0x7000 | (dmp_length & 0x0FFF));
        packet[117] = 0x02; // Vector: VECTOR_DMP_SET_PROPERTY
        packet[118] = 0xa1; // Address & Data type
        BigEndian::write_u16(&mut packet[119..121], 0x0000); // First Property Address
        BigEndian::write_u16(&mut packet[121..123], 0x0001); // Address Increment
        BigEndian::write_u16(&mut packet[123..125], (channel_count + 1) as u16); // Property value count
        packet[125] = 0x00; // DMX Start Code

        // DMX payload
        packet[126..126 + channel_count].copy_from_slice(&dmx_channels[..channel_count]);

        packet
    }
}
