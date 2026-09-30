use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SyncProtocol {
    #[serde(rename = "DDP")]
    Ddp,
    #[serde(rename = "Art-Net")]
    ArtNet,
    #[serde(rename = "E1.31")]
    SacnE131,
    #[serde(rename = "WARLS")]
    Warls,
    #[serde(rename = "DRGB")]
    Drgb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VideoSourceType {
    #[serde(rename = "Wayland Screen Capture")]
    WaylandPipeWire,
    #[serde(rename = "Open Media Transport (OMT)")]
    OmtStream,
    #[serde(rename = "Procedural Effects")]
    Procedural,
    #[serde(rename = "Test Pattern")]
    TestPattern,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorCalibration {
    pub brightness: f32, // 0.0 - 1.0 (default 1.0)
    pub contrast: f32,   // -1.0 to 1.0 (default 0.0)
    pub saturation: f32, // -1.0 to 1.0 (default 0.0)
    pub gamma: f32,      // 0.5 - 3.0 (default 1.0 / 2.2 for sRGB)
}

impl Default for ColorCalibration {
    fn default() -> Self {
        Self {
            brightness: 1.0,
            contrast: 0.0,
            saturation: 0.0,
            gamma: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatrixLayout {
    pub is_matrix: bool,
    pub width: usize,
    pub height: usize,
    pub total_leds: usize,
    pub serpentine: bool,
    pub reverse_rows: bool,
    pub vertical: bool,
}

impl Default for MatrixLayout {
    fn default() -> Self {
        Self {
            is_matrix: true,
            width: 16,
            height: 16,
            total_leds: 256,
            serpentine: true,
            reverse_rows: false,
            vertical: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmxUniversePatch {
    pub id: String,
    pub name: String,
    pub target_ip: String,
    pub target_port: u16,
    pub protocol: SyncProtocol,
    pub start_universe: u16,
    pub universe_count: u16,
    pub channels_per_universe: u16, // Usually 510 or 512 for Art-Net / sACN
    pub start_led_index: usize,
    pub led_count: usize,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OmtStreamInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub resolution: String,
    pub fps: u32,
    pub is_online: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineTelemetry {
    pub fps: f32,
    pub render_time_us: u64,
    pub packets_sent: u64,
    pub bytes_sent: u64,
    pub dropped_frames: u64,
    pub active_source: String,
    pub active_protocol: String,
    pub total_leds: usize,
    pub total_universes: usize,
}

impl Default for EngineTelemetry {
    fn default() -> Self {
        Self {
            fps: 0.0,
            render_time_us: 0,
            packets_sent: 0,
            bytes_sent: 0,
            dropped_frames: 0,
            active_source: "Procedural Effects".to_string(),
            active_protocol: "DDP".to_string(),
            total_leds: 256,
            total_universes: 1,
        }
    }
}
