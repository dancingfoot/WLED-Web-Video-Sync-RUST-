/// WLED WARLS and DRGB Realtime protocols (default port: 21324)

pub struct WarlsBuilder;

impl WarlsBuilder {
    /// Builds WLED DRGB packet.
    /// Byte 0: 0x02 (DRGB identifier)
    /// Byte 1: Timeout in seconds
    /// Byte 2+: Raw RGB bytes
    pub fn build_drgb(rgb_data: &[u8], timeout_secs: u8) -> Vec<u8> {
        let mut packet = vec![0u8; 2 + rgb_data.len()];
        packet[0] = 0x02;
        packet[1] = timeout_secs;
        packet[2..].copy_from_slice(rgb_data);
        packet
    }

    /// Builds WLED WARLS packet (triplets of index, R, G, B; max 256 LEDs)
    /// Byte 0: 0x01 (WARLS identifier)
    /// Byte 1: Timeout in seconds
    /// Byte 2+: [Index, R, G, B]
    pub fn build_warls(rgb_data: &[u8], timeout_secs: u8) -> Vec<u8> {
        let led_count = (rgb_data.len() / 3).min(256);
        let mut packet = vec![0u8; 2 + led_count * 4];
        packet[0] = 0x01;
        packet[1] = timeout_secs;

        for i in 0..led_count {
            let out_idx = 2 + i * 4;
            let in_idx = i * 3;
            packet[out_idx] = i as u8;
            packet[out_idx + 1] = rgb_data[in_idx];
            packet[out_idx + 2] = rgb_data[in_idx + 1];
            packet[out_idx + 3] = rgb_data[in_idx + 2];
        }

        packet
    }
}
