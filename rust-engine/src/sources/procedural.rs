use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::info;
use crate::types::VideoFrame;

pub enum ProceduralPattern {
    RainbowWave,
    PlasmaClouds,
    FireFlames,
    AudioSpectrum,
}

pub struct ProceduralEngine;

impl ProceduralEngine {
    /// Starts the generator and returns a flag that stops it. It must be stopped
    /// when another source (e.g. an OMT stream) takes over, otherwise both would
    /// feed the same frame channel and the output would flicker between them.
    pub fn start_generator(
        pattern: ProceduralPattern,
        frame_tx: mpsc::Sender<Arc<VideoFrame>>,
        width: usize,
        height: usize,
        fps: u32,
    ) -> Arc<AtomicBool> {
        info!("Spawning Procedural Generator at {} FPS ({}x{})", fps, width, height);

        let stop = Arc::new(AtomicBool::new(false));
        let stop_task = stop.clone();

        tokio::spawn(async move {
            let frame_duration = std::time::Duration::from_nanos(1_000_000_000 / fps.max(1) as u64);
            let mut interval = tokio::time::interval(frame_duration);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            let mut tick: u64 = 0;
            let mut frame = vec![0u8; width * height * 3];

            loop {
                interval.tick().await;
                if stop_task.load(Ordering::Relaxed) {
                    break;
                }
                tick = tick.wrapping_add(1);
                let time = (tick as f32) * 0.04;

                match pattern {
                    ProceduralPattern::RainbowWave => {
                        for y in 0..height {
                            for x in 0..width {
                                let hue = (x as f32 / width as f32 + y as f32 / height as f32 + time) % 1.0;
                                let (r, g, b) = hsv_to_rgb(hue, 1.0, 1.0);
                                let idx = (y * width + x) * 3;
                                frame[idx] = r;
                                frame[idx + 1] = g;
                                frame[idx + 2] = b;
                            }
                        }
                    }
                    ProceduralPattern::PlasmaClouds => {
                        for y in 0..height {
                            for x in 0..width {
                                let cx = x as f32 / width as f32 - 0.5;
                                let cy = y as f32 / height as f32 - 0.5;
                                let v1 = (cx * 10.0 + time).sin();
                                let v2 = (cy * 10.0 - time * 0.8).cos();
                                let v3 = ((cx * cx + cy * cy) * 12.0 - time * 1.5).sin();
                                let val = ((v1 + v2 + v3) / 3.0) * 0.5 + 0.5;

                                let (r, g, b) = hsv_to_rgb(val, 0.9, 1.0);
                                let idx = (y * width + x) * 3;
                                frame[idx] = r;
                                frame[idx + 1] = g;
                                frame[idx + 2] = b;
                            }
                        }
                    }
                    ProceduralPattern::FireFlames => {
                        for y in 0..height {
                            let y_factor = 1.0 - (y as f32 / height as f32);
                            for x in 0..width {
                                let noise = ((x as f32 * 0.4 + time * 3.0).sin() * 0.5 + 0.5) * y_factor;
                                let r = (noise * 255.0).clamp(0.0, 255.0) as u8;
                                let g = ((noise * 0.5) * 255.0).clamp(0.0, 255.0) as u8;
                                let b = ((noise * 0.1) * 255.0).clamp(0.0, 255.0) as u8;
                                let idx = (y * width + x) * 3;
                                frame[idx] = r;
                                frame[idx + 1] = g;
                                frame[idx + 2] = b;
                            }
                        }
                    }
                    ProceduralPattern::AudioSpectrum => {
                        for x in 0..width {
                            let x_rel = x as f32 / width as f32;
                            let bar_height = ((x_rel * 8.0 + time * 2.0).sin().abs() * 0.8 + 0.2) * (height as f32);
                            for y in 0..height {
                                let idx = (y * width + x) * 3;
                                if (height - 1 - y) as f32 <= bar_height {
                                    let hue = 0.33 - (y as f32 / height as f32) * 0.33; // Green to Red
                                    let (r, g, b) = hsv_to_rgb(hue.max(0.0), 1.0, 1.0);
                                    frame[idx] = r;
                                    frame[idx + 1] = g;
                                    frame[idx + 2] = b;
                                } else {
                                    frame[idx] = 0;
                                    frame[idx + 1] = 0;
                                    frame[idx + 2] = 0;
                                }
                            }
                        }
                    }
                }

                if frame_tx.send(Arc::new(VideoFrame::new(width, height, frame.clone()))).await.is_err() {
                    break;
                }
            }
        });

        stop
    }
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let c = v * s;
    let x = c * (1.0 - (((h * 6.0) % 2.0) - 1.0).abs());
    let m = v - c;
    let (r, g, b) = match (h * 6.0) as i32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    (
        ((r + m) * 255.0) as u8,
        ((g + m) * 255.0) as u8,
        ((b + m) * 255.0) as u8,
    )
}
