//! Receiving and decoding Open Media Transport (OMT) video.
//!
//! OMT carries video with the VMX codec. Rather than hand-rolling that codec,
//! this uses the pure-Rust `openmediatransport` crate. It is behind the `omt`
//! Cargo feature so a default engine build pulls in no extra dependencies.
//!
//! Discovery lives in [`super::omt`]; this module only subscribes and decodes.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;
#[cfg(feature = "omt")]
use tracing::info;
#[cfg(not(feature = "omt"))]
use tracing::warn;

use crate::types::VideoFrame;

/// Shared, human-readable description of what the active source is doing.
/// Surfaced to the UI through telemetry so failures are visible, not silent.
pub type SourceStatus = Arc<Mutex<String>>;

pub fn new_status(initial: impl Into<String>) -> SourceStatus {
    Arc::new(Mutex::new(initial.into()))
}

pub fn set_status(status: &SourceStatus, msg: impl Into<String>) {
    if let Ok(mut s) = status.lock() {
        *s = msg.into();
    }
}

/// Convert a BGRA8 frame (honouring row `stride`) into tightly packed RGB24.
fn bgra_to_rgb(bgra: &[u8], width: usize, height: usize, stride: usize) -> Vec<u8> {
    let mut rgb = vec![0u8; width * height * 3];
    for y in 0..height {
        let src_row = y * stride;
        let dst_row = y * width * 3;
        if src_row + width * 4 > bgra.len() {
            break;
        }
        for x in 0..width {
            let s = src_row + x * 4;
            let d = dst_row + x * 3;
            // OMT delivers BGRA; the pipeline wants RGB.
            rgb[d] = bgra[s + 2];
            rgb[d + 1] = bgra[s + 1];
            rgb[d + 2] = bgra[s];
        }
    }
    rgb
}

/// Handle used to stop a running receiver and to find out whether it gave up.
pub struct OmtReceiverHandle {
    stop: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
}

impl OmtReceiverHandle {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    /// True once the receiver has given up, e.g. the publisher is unreachable.
    pub fn has_failed(&self) -> bool {
        self.failed.load(Ordering::Relaxed)
    }
}

/// Subscribe to an OMT source and forward decoded frames into the pipeline.
///
/// The crate's receive API is blocking, so it runs on a dedicated blocking task.
pub fn spawn(
    name: String,
    url: String,
    addresses: Vec<String>,
    frame_tx: mpsc::Sender<Arc<VideoFrame>>,
    status: SourceStatus,
) -> OmtReceiverHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let failed = Arc::new(AtomicBool::new(false));
    let failed_thread = failed.clone();

    set_status(&status, format!("connecting to {}", url));

    tokio::task::spawn_blocking(move || {
        #[cfg(feature = "omt")]
        {
            receive_loop(&name, &url, &addresses, &frame_tx, &status, &stop_thread, &failed_thread);
        }
        #[cfg(not(feature = "omt"))]
        {
            let _ = (&name, &url, &addresses, &frame_tx, &stop_thread);
            failed_thread.store(true, Ordering::Relaxed);
            warn!(
                "OMT stream selected, but this engine was built without OMT support \
                 (rebuild with: cargo build --release --features omt)"
            );
            set_status(
                &status,
                "OMT support not compiled into this build (use --features omt)".to_string(),
            );
        }
    });

    OmtReceiverHandle { stop, failed }
}

#[cfg(feature = "omt")]
fn receive_loop(
    name: &str,
    url: &str,
    addresses: &[String],
    frame_tx: &mpsc::Sender<Arc<VideoFrame>>,
    status: &SourceStatus,
    stop: &AtomicBool,
    failed: &AtomicBool,
) {
    use std::time::Duration;

    use openmediatransport::{FrameType, ReceiverConfig, ReceiverSession};

    let session = match ReceiverSession::connect_with_addresses(
        url,
        addresses,
        ReceiverConfig {
            frame_types: FrameType::VIDEO,
            connect_timeout: Duration::from_secs(5),
            ..ReceiverConfig::default()
        },
    ) {
        Ok(s) => s,
        Err(e) => {
            // A discovered publisher is not necessarily reachable — say so plainly.
            tracing::error!("OMT connect failed for {} ({}): {}", name, url, e);
            set_status(status, format!("connection failed: {}", e));
            failed.store(true, Ordering::Relaxed);
            return;
        }
    };

    info!("Receiving OMT stream {} ({})", name, url);

    let mut last_report = String::new();

    while !stop.load(Ordering::Relaxed) {
        let Some(frame) = session.recv_video_timeout(Duration::from_millis(500)) else {
            continue;
        };

        let (w, h, stride) = (
            frame.width as usize,
            frame.height as usize,
            frame.stride as usize,
        );
        if w == 0 || h == 0 {
            continue;
        }

        let rgb = bgra_to_rgb(&frame.pixels[..], w, h, stride);

        // Only touch the shared status string when something actually changed.
        let report = format!("receiving {} ({}x{})", name, w, h);
        if report != last_report {
            set_status(status, report.clone());
            last_report = report;
        }

        if frame_tx
            .blocking_send(Arc::new(VideoFrame::new(w, h, rgb)))
            .is_err()
        {
            break;
        }
    }

    session.disconnect();
    info!("OMT receiver for {} stopped", name);
    set_status(status, format!("stopped {}", name));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bgra_is_reordered_to_rgb_and_respects_stride() {
        // 2x1 image, stride padded to 12 bytes (2 px * 4 + 4 padding).
        let bgra = [
            1, 2, 3, 255, /* px0: B=1 G=2 R=3 */
            4, 5, 6, 255, /* px1: B=4 G=5 R=6 */
            9, 9, 9, 9, /* padding that must be ignored */
        ];
        let rgb = bgra_to_rgb(&bgra, 2, 1, 12);
        assert_eq!(rgb, vec![3, 2, 1, 6, 5, 4]);
    }

    #[test]
    fn short_buffer_does_not_panic() {
        let bgra = [1u8, 2, 3, 255];
        let rgb = bgra_to_rgb(&bgra, 4, 4, 16);
        assert_eq!(rgb.len(), 4 * 4 * 3);
        // Rows past the end of the data stay black rather than reading OOB.
        assert!(rgb[12..].iter().all(|&b| b == 0));
    }
}
