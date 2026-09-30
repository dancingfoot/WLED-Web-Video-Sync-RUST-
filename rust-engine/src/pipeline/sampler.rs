use rayon::prelude::*;
use crate::types::{ColorCalibration, MatrixLayout};

pub struct PixelSampler {
    gamma_lut: [u8; 256],
    last_gamma: f32,
}

impl PixelSampler {
    pub fn new(initial_gamma: f32) -> Self {
        let mut sampler = Self {
            gamma_lut: [0; 256],
            last_gamma: -1.0,
        };
        sampler.update_gamma_lut(initial_gamma);
        sampler
    }

    /// Precompute 256-byte gamma lookup table for zero-CPU gamma mapping
    pub fn update_gamma_lut(&mut self, gamma: f32) {
        if (self.last_gamma - gamma).abs() < 0.001 {
            return;
        }
        self.last_gamma = gamma;
        let g = gamma.max(0.1);
        for i in 0..256 {
            let normalized = (i as f32) / 255.0;
            let corrected = normalized.powf(g);
            self.gamma_lut[i] = (corrected * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }

    /// Color adjustments: Brightness, Contrast, Saturation and Gamma correction
    #[inline(always)]
    pub fn apply_color_corrections(
        &self,
        r: u8,
        g: u8,
        b: u8,
        calib: &ColorCalibration,
    ) -> (u8, u8, u8) {
        let mut rf = r as f32 / 255.0;
        let mut gf = g as f32 / 255.0;
        let mut bf = b as f32 / 255.0;

        // 1. Contrast: (color - 0.5) * (1 + contrast) + 0.5
        if calib.contrast.abs() > 0.001 {
            let factor = 1.0 + calib.contrast;
            rf = ((rf - 0.5) * factor + 0.5).clamp(0.0, 1.0);
            gf = ((gf - 0.5) * factor + 0.5).clamp(0.0, 1.0);
            bf = ((bf - 0.5) * factor + 0.5).clamp(0.0, 1.0);
        }

        // 2. Saturation: blend with luminance
        if calib.saturation.abs() > 0.001 {
            let lum = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf;
            let sat_mult = 1.0 + calib.saturation;
            rf = (lum + (rf - lum) * sat_mult).clamp(0.0, 1.0);
            gf = (lum + (gf - lum) * sat_mult).clamp(0.0, 1.0);
            bf = (lum + (bf - lum) * sat_mult).clamp(0.0, 1.0);
        }

        // 3. Brightness
        rf = (rf * calib.brightness).clamp(0.0, 1.0);
        gf = (gf * calib.brightness).clamp(0.0, 1.0);
        bf = (bf * calib.brightness).clamp(0.0, 1.0);

        let r_out = (rf * 255.0) as u8;
        let g_out = (gf * 255.0) as u8;
        let b_out = (bf * 255.0) as u8;

        // 4. Gamma LUT lookup
        (
            self.gamma_lut[r_out as usize],
            self.gamma_lut[g_out as usize],
            self.gamma_lut[b_out as usize],
        )
    }

    /// High-performance Rayon downsampling from raw source image to WLED Matrix or Strip
    pub fn sample_frame_to_leds(
        &mut self,
        source_rgb: &[u8],
        source_width: usize,
        source_height: usize,
        layout: &MatrixLayout,
        calib: &ColorCalibration,
    ) -> Vec<u8> {
        self.update_gamma_lut(calib.gamma);

        if layout.is_matrix {
            let target_w = layout.width.max(1);
            let target_h = layout.height.max(1);
            let total_leds = target_w * target_h;
            let mut output = vec![0u8; total_leds * 3];

            // Parallel computation across matrix rows using Rayon
            output
                .par_chunks_exact_mut(target_w * 3)
                .enumerate()
                .for_each(|(matrix_y, row_slice)| {
                    let effective_y = if layout.reverse_rows {
                        target_h - 1 - matrix_y
                    } else {
                        matrix_y
                    };

                    let src_y = (effective_y * source_height) / target_h;

                    for matrix_x in 0..target_w {
                        // Serpentine layout check: alternate rows have reversed X indexing
                        let is_row_reversed = layout.serpentine && (effective_y % 2 == 1);
                        let effective_x = if is_row_reversed {
                            target_w - 1 - matrix_x
                        } else {
                            matrix_x
                        };

                        let src_x = (effective_x * source_width) / target_w;
                        let src_idx = (src_y * source_width + src_x) * 3;

                        let r = source_rgb.get(src_idx).copied().unwrap_or(0);
                        let g = source_rgb.get(src_idx + 1).copied().unwrap_or(0);
                        let b = source_rgb.get(src_idx + 2).copied().unwrap_or(0);

                        let (cr, cg, cb) = self.apply_color_corrections(r, g, b, calib);

                        let out_idx = matrix_x * 3;
                        row_slice[out_idx] = cr;
                        row_slice[out_idx + 1] = cg;
                        row_slice[out_idx + 2] = cb;
                    }
                });

            output
        } else {
            // Single 1D Strip Downsampling
            let count = layout.total_leds.max(1);
            let mut output = vec![0u8; count * 3];

            output
                .par_chunks_exact_mut(3)
                .enumerate()
                .for_each(|(i, pixel)| {
                    let src_x = (i * source_width) / count;
                    let src_y = source_height / 2; // Center horizontal line
                    let src_idx = (src_y * source_width + src_x) * 3;

                    let r = source_rgb.get(src_idx).copied().unwrap_or(0);
                    let g = source_rgb.get(src_idx + 1).copied().unwrap_or(0);
                    let b = source_rgb.get(src_idx + 2).copied().unwrap_or(0);

                    let (cr, cg, cb) = self.apply_color_corrections(r, g, b, calib);

                    pixel[0] = cr;
                    pixel[1] = cg;
                    pixel[2] = cb;
                });

            output
        }
    }
}
