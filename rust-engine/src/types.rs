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

/// A decoded, tightly packed RGB24 frame plus its dimensions.
///
/// Sources deliver frames at their own native size, so the sampler always crops
/// and downscales from the real source resolution rather than a fixed one.
#[derive(Debug, Clone)]
pub struct VideoFrame {
    pub width: usize,
    pub height: usize,
    /// `width * height * 3` bytes, RGB order.
    pub rgb: Vec<u8>,
}

impl VideoFrame {
    pub fn new(width: usize, height: usize, rgb: Vec<u8>) -> Self {
        Self { width, height, rgb }
    }
}

/// A small RGB copy of the active source frame, published for the UI.
///
/// Without this the browser cannot show an OMT stream at all: the video is
/// decoded natively inside the engine and only ever leaves it as LED pixel
/// data, so the preview would stay a placeholder even while the matrix is
/// being driven correctly.
#[derive(Debug, Clone)]
pub struct PreviewFrame {
    pub width: usize,
    pub height: usize,
    pub rgb: Vec<u8>,
    /// Increments per produced preview so clients can skip duplicates.
    pub sequence: u64,
}

/// Nearest-neighbour downscale of an RGB frame, for the UI preview.
///
/// Deliberately cheap — this runs inside the real-time frame path and must
/// never become the bottleneck.
pub fn make_preview(frame: &VideoFrame, max_width: usize) -> PreviewFrame {
    let src_w = frame.width.max(1);
    let src_h = frame.height.max(1);
    let dst_w = max_width.min(src_w).max(1);
    let dst_h = (((dst_w as f32) * (src_h as f32) / (src_w as f32)).round()).max(1.0) as usize;

    let mut rgb = vec![0u8; dst_w * dst_h * 3];
    for y in 0..dst_h {
        let sy = (y * src_h) / dst_h;
        for x in 0..dst_w {
            let sx = (x * src_w) / dst_w;
            let s = (sy * src_w + sx) * 3;
            let d = (y * dst_w + x) * 3;
            if s + 2 < frame.rgb.len() {
                rgb[d] = frame.rgb[s];
                rgb[d + 1] = frame.rgb[s + 1];
                rgb[d + 2] = frame.rgb[s + 2];
            }
        }
    }

    PreviewFrame { width: dst_w, height: dst_h, rgb, sequence: 0 }
}

/// The sub-rectangle of the source frame that gets mapped onto the LED matrix.
///
/// All fields are normalized to the source frame (0.0 - 1.0). This exists so a
/// 16:9 source can drive a square matrix without being stretched: the region's
/// aspect is matched to the matrix aspect and only that part of the frame is used.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SourceRegion {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    /// When true the region is recomputed each frame as the largest centered
    /// crop matching the matrix aspect, so the image is never distorted.
    /// The explicit x/y/width/height are ignored while this is set.
    pub auto_aspect: bool,
}

impl Default for SourceRegion {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
            auto_aspect: true,
        }
    }
}

impl SourceRegion {
    /// Largest centered region of the source whose aspect ratio equals the
    /// matrix aspect ratio. This is the zero-distortion crop: it uses as much of
    /// the frame as possible while keeping circles circular.
    pub fn centered_for_aspect(
        source_width: usize,
        source_height: usize,
        target_width: usize,
        target_height: usize,
    ) -> Self {
        if source_width == 0 || source_height == 0 || target_width == 0 || target_height == 0 {
            return Self::default();
        }
        let source_aspect = source_width as f32 / source_height as f32;
        let target_aspect = target_width as f32 / target_height as f32;

        let (w, h) = if source_aspect > target_aspect {
            // Source is wider than the matrix: keep full height, trim the sides.
            (target_aspect / source_aspect, 1.0)
        } else {
            // Source is taller (or equal): keep full width, trim top/bottom.
            (1.0, source_aspect / target_aspect)
        };

        Self {
            x: (1.0 - w) * 0.5,
            y: (1.0 - h) * 0.5,
            width: w,
            height: h,
            auto_aspect: false,
        }
    }

    /// Clamped, usable bounds regardless of what the client sent.
    pub fn normalized(&self, source_width: usize, source_height: usize, target_width: usize, target_height: usize) -> (f32, f32, f32, f32) {
        if self.auto_aspect {
            let r = Self::centered_for_aspect(source_width, source_height, target_width, target_height);
            return (r.x, r.y, r.width, r.height);
        }
        let w = self.width.clamp(0.001, 1.0);
        let h = self.height.clamp(0.001, 1.0);
        let x = self.x.clamp(0.0, 1.0 - w);
        let y = self.y.clamp(0.0, 1.0 - h);
        (x, y, w, h)
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
    /// Human-readable state of the active source, e.g. "connecting to omt://…"
    /// or a connection error. Shown in the UI so failures are never silent.
    pub source_status: String,
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
            source_status: "procedural generator running".to_string(),
            total_leds: 256,
            total_universes: 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 16:9 source driving a square matrix must use a centered square slice of
    /// the frame, not the whole frame squeezed into the square.
    #[test]
    fn square_matrix_gets_centered_square_crop_of_widescreen() {
        let r = SourceRegion::centered_for_aspect(1280, 720, 16, 16);
        assert!((r.height - 1.0).abs() < 1e-6, "should use full height");
        assert!((r.width - 720.0 / 1280.0).abs() < 1e-6, "width should be 720/1280");
        assert!((r.x - (1.0 - 720.0 / 1280.0) * 0.5).abs() < 1e-6, "should be centered");
        assert!(r.y.abs() < 1e-6);
    }

    /// The whole point of the region: the pixels actually sampled must have the
    /// same aspect ratio as the matrix, otherwise the image is stretched.
    #[test]
    fn region_pixel_aspect_always_matches_matrix_aspect() {
        let cases = [
            (1280usize, 720usize, 16usize, 16usize),
            (1920, 1080, 32, 16),
            (640, 480, 8, 32),
            (100, 100, 10, 10),
            (3840, 2160, 64, 64),
        ];
        for (sw, sh, tw, th) in cases {
            let r = SourceRegion::centered_for_aspect(sw, sh, tw, th);
            let region_aspect = (r.width * sw as f32) / (r.height * sh as f32);
            let matrix_aspect = tw as f32 / th as f32;
            assert!(
                (region_aspect - matrix_aspect).abs() < 1e-4,
                "source {sw}x{sh} -> matrix {tw}x{th}: region aspect {region_aspect} != matrix aspect {matrix_aspect}"
            );
            assert!(r.width <= 1.0 + 1e-6 && r.height <= 1.0 + 1e-6, "region must stay in frame");
            assert!(r.x >= -1e-6 && r.y >= -1e-6, "region must stay in frame");
        }
    }

    /// A client can send anything; the region must be clamped into the frame.
    #[test]
    fn out_of_range_region_is_clamped_into_frame() {
        let r = SourceRegion { x: 0.9, y: 0.95, width: 0.5, height: 0.5, auto_aspect: false };
        let (x, y, w, h) = r.normalized(1280, 720, 16, 16);
        assert!(x + w <= 1.0 + 1e-6, "x+w = {} exceeds frame", x + w);
        assert!(y + h <= 1.0 + 1e-6, "y+h = {} exceeds frame", y + h);
        assert!(w >= 0.001 && h >= 0.001, "degenerate region");
    }

    #[test]
    fn auto_aspect_overrides_explicit_values() {
        let r = SourceRegion { x: 0.9, y: 0.9, width: 0.01, height: 0.01, auto_aspect: true };
        let (x, y, w, h) = r.normalized(1280, 720, 16, 16);
        assert!((w - 720.0 / 1280.0).abs() < 1e-6, "auto mode must ignore explicit width");
        assert!((h - 1.0).abs() < 1e-6);
        assert!(x > 0.2 && y.abs() < 1e-6);
    }
}
