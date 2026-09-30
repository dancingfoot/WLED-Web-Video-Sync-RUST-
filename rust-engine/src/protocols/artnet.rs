use byteorder::{BigEndian, LittleEndian, ByteOrder};

/// Art-Net 4 (DMX512 over UDP) Packet Builder.
/// Default Art-Net port: 6454.
/// Max 512 DMX channels (170 RGB LEDs = 510 channels) per universe.
pub struct ArtNetBuilder {
    sequence: u8,
}

impl ArtNetBuilder {
    pub fn new() -> Self {
        Self { sequence: 0 }
    }

    fn next_sequence(&mut self) -> u8 {
        self.sequence = self.sequence.wrapping_add(1);
        if self.sequence == 0 {
            self.sequence = 1; // 0x00 disables sequence checking in Art-Net
        }
        self.sequence
    }

    /// Builds an ArtDmx packet for a specific universe.
    /// Payload is clamped to maximum 512 channels.
    pub fn build_universe_packet(&mut self, universe: u16, dmx_channels: &[u8]) -> Vec<u8> {
        let channel_count = dmx_channels.len().min(512);
        let mut packet = vec![0u8; 18 + channel_count];

        // Bytes 0-7: "Art-Net\0"
        packet[0..8].copy_from_slice(b"Art-Net\0");
        // Bytes 8-9: Opcode 0x5000 (OpArtDmx) Little-Endian
        LittleEndian::write_u16(&mut packet[8..10], 0x5000);
        // Bytes 10-11: Protocol revision 14 Big-Endian
        BigEndian::write_u16(&mut packet[10..12], 14);
        // Byte 12: Sequence number
        packet[12] = self.next_sequence();
        // Byte 13: Physical port (0)
        packet[13] = 0x00;
        // Bytes 14-15: Universe Little-Endian
        LittleEndian::write_u16(&mut packet[14..16], universe);
        // Bytes 16-17: Length of DMX channels Big-Endian (even number)
        BigEndian::write_u16(&mut packet[16..18], channel_count as u16);
        // Bytes 18+: DMX channels
        packet[18..18 + channel_count].copy_from_slice(&dmx_channels[..channel_count]);

        packet
    }

    /// Slices large arrays of RGB LEDs (e.g. 5,000+ LEDs) into multiple Art-Net universes.
    /// Each universe holds 170 RGB LEDs (510 channels).
    pub fn build_multi_universe_packets(
        &mut self,
        start_universe: u16,
        rgb_data: &[u8],
    ) -> Vec<(u16, Vec<u8>)> {
        const CHANNELS_PER_UNIVERSE: usize = 170 * 3; // 510 channels
        let mut packets = Vec::new();
        let total_bytes = rgb_data.len();
        let mut offset = 0;
        let mut current_univ = start_universe;

        while offset < total_bytes {
            let chunk_size = (total_bytes - offset).min(CHANNELS_PER_UNIVERSE);
            let packet = self.build_universe_packet(current_univ, &rgb_data[offset..offset + chunk_size]);
            packets.push((current_univ, packet));
            offset += chunk_size;
            current_univ = current_univ.wrapping_add(1);
        }

        packets
    }
}
