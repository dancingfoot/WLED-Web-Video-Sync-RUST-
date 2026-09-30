import { EffectType } from '../types';

// Simple analytical noise approximations for atmospheric moving clouds (low-overhead substitute for full Perlin noise)
function fractionalNoise(x: number, y: number, t: number): number {
  const v1 = Math.sin(x * 0.08 + t * 1.5) * Math.cos(y * 0.12 - t * 0.8);
  const v2 = Math.sin((x + y) * 0.04 - t * 2.2) * 1.5;
  const v3 = Math.cos(Math.sqrt(x * x + y * y) * 0.05 + t * 0.5) * 0.8;
  return (v1 + v2 + v3) / 3.3; // Normalized to ~ [-1, 1]
}

// Convert HSV to RGB
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Global fire cooling map to persist fire state frames
let fireHeatGrid: number[][] = [];

export function renderProceduralEffect(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effect: EffectType,
  timeSec: number,
  audioData?: Uint8Array
) {
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  // Ensure fire array is initialized in correct aspect ratios
  if (effect === EffectType.FIRE) {
    if (fireHeatGrid.length !== height || fireHeatGrid[0]?.length !== width) {
      fireHeatGrid = Array.from({ length: height }, () => Array(width).fill(0));
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      if (effect === EffectType.RAINBOW) {
        // Rainbow WAVE
        const factor = (x / width) * 0.5 + (y / height) * 0.5 + timeSec * 0.1;
        const [r, g, b] = hsvToRgb(factor % 1.0, 1.0, 1.0);
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;

      } else if (effect === EffectType.PERLIN_NOISE) {
        // Noise Clouds (Plasma-like)
        const nValue = fractionalNoise(x, y, timeSec); // Between -1 and 1
        const intensity = (nValue + 1) / 2; // Map to [0, 1]

        // Beautiful cosmic violet-to-cyan gradient
        const r = Math.floor(intensity * 110 + (1 - intensity) * 40);
        const g = Math.floor(intensity * 180 + (1 - intensity) * 10);
        const b = Math.floor(intensity * 255 + (1 - intensity) * 120);

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;

      } else if (effect === EffectType.FIRE) {
        // Raging Fire model
        // Bottom row ember injectors
        if (y === height - 1) {
          fireHeatGrid[y][x] = Math.random() > 0.4 ? 1.0 : 0.2;
        } else {
          // Heat floats upwards, random cooling factor & horizontal drift
          const drift = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
          const sourceX = (x + drift + width) % width;
          const belowHeat = fireHeatGrid[y + 1][sourceX] || 0.0;
          const cooling = Math.random() * 0.12 + 0.02;
          fireHeatGrid[y][x] = Math.max(0, belowHeat - cooling);
        }

        const heat = fireHeatGrid[y][x];
        // Heat values map to: 0 -> Black, 0.4 -> Dark Red, 0.7 -> Amber, 1.0 -> Yellow White
        let r = 0, g = 0, b = 0;
        if (heat > 0.6) {
          r = 255;
          g = Math.floor((heat - 0.6) / 0.4 * 220) + 35;
          b = Math.floor((heat - 0.7) / 0.3 * 100);
        } else if (heat > 0.15) {
          r = Math.floor((heat - 0.15) / 0.45 * 255);
          g = 20;
          b = 0;
        } else if (heat > 0.03) {
          r = Math.floor(heat / 0.15 * 50);
          g = 0;
          b = 0;
        }
        
        data[idx] = Math.max(0, Math.min(255, r));
        data[idx + 1] = Math.max(0, Math.min(255, g));
        data[idx + 2] = Math.max(0, Math.min(255, b));
        data[idx + 3] = 255;

      } else if (effect === EffectType.SINE_WAVES) {
        // Interfering Sine Waves (Expanding Ripples)
        const cx1 = width * 0.3, cy1 = height * 0.4;
        const cx2 = width * 0.7, cy2 = height * 0.6;

        const d1 = Math.sqrt((x - cx1) ** 2 + (y - cy1) ** 2);
        const d2 = Math.sqrt((x - cx2) ** 2 + (y - cy2) ** 2);

        const w1 = Math.sin(d1 * 0.5 - timeSec * 5) * 0.5 + 0.5;
        const w2 = Math.sin(d2 * 0.3 - timeSec * 3) * 0.5 + 0.5;
        const sum = (w1 + w2) / 2;

        // Orange/Purple iridescent bands
        data[idx] = Math.floor(sum * 255);
        data[idx + 1] = Math.floor(sum * 70 + (1 - sum) * 30);
        data[idx + 2] = Math.floor((1 - sum) * 200 + sum * 50);
        data[idx + 3] = 255;

      } else if (effect === EffectType.AUDIO_SPECTRUM) {
        // Dynamic Audio Bands visualization
        if (audioData && audioData.length > 0) {
          const numSamples = audioData.length;
          // Distribute audio spectrum linearly across coordinates
          const sampleIdx = Math.floor((x / width) * numSamples);
          const rawAmp = audioData[sampleIdx] || 0; // [0, 255]
          const amplitudeY = rawAmp / 255; // [0, 1]

          // Compute threshold index height for bar graph
          const thresholdIdx = Math.round((1 - amplitudeY) * height);

          if (y >= thresholdIdx) {
            // Hot visual spectrum for active bands
            const factor = (y / height); // 1 is bottom
            const barIntensity = 1.0;
            const [r, g, b] = hsvToRgb((x / width) * 0.7 + 0.1, 0.9, barIntensity);
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
          } else {
            // Low intensity background
            data[idx] = 10;
            data[idx + 1] = 10;
            data[idx + 2] = 20;
          }
        } else {
          // Fallback if mic permission is loading/not granted yet
          const shiftY = Math.sin(x * 0.3 + timeSec * 4) * 0.3 + 0.7; // [0.4, 1.0]
          const thresholdIdx = Math.round(shiftY * height);

          if (y >= thresholdIdx) {
            const [r, g, b] = hsvToRgb((x / width) + 0.2, 0.9, 0.85);
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
          } else {
            data[idx] = 10;
            data[idx + 1] = 10;
            data[idx + 2] = 20;
          }
        }
        data[idx + 3] = 255;

      } else {
        // Solid custom colorful ambient glow gradient
        const factor = (timeSec * 0.1) % 1.0;
        const [r, g, b] = hsvToRgb(factor, 0.8, 0.9);
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}
