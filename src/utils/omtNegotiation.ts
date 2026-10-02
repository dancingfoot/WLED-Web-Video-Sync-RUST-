import { OmtStreamInput } from '../types';

/**
 * Builds the negotiated OMT stream URI with low-resolution proxy parameters
 * transmitted to the sender during handshake.
 */
export function buildNegotiatedOmtUrl(
  stream: OmtStreamInput,
  matrixWidth: number = 16,
  matrixHeight: number = 16
): string {
  // Strip existing query string
  const base = stream.url.split('?')[0];
  const params = new URLSearchParams();

  const profile = stream.streamProfile || 'proxy';
  params.set('profile', profile);

  const res = stream.proxyResolution || '160x120';
  let targetWidth = 160;
  let targetHeight = 120;

  if (res === '160x120') {
    targetWidth = 160;
    targetHeight = 120;
  } else if (res === '320x240') {
    targetWidth = 320;
    targetHeight = 240;
  } else if (res === 'matrix_native') {
    targetWidth = matrixWidth;
    targetHeight = matrixHeight;
  } else if (res === 'source_native') {
    // No downscaling requested
    params.set('downscale', 'false');
    return `${base}?profile=${profile}`;
  }

  params.set('width', String(targetWidth));
  params.set('height', String(targetHeight));
  params.set('fps', String(stream.requestedFps || 60));
  params.set('codec', stream.codec === 'RAW_RGB' ? 'raw_rgb' : 'vmx');

  return `${base}?${params.toString()}`;
}

/**
 * Calculates estimated network bandwidth and percentage savings
 * compared to a standard 1080p stream at 60 FPS.
 */
export function calculateStreamBandwidthStats(
  proxyResolution: '160x120' | '320x240' | 'matrix_native' | 'source_native' = '160x120',
  matrixWidth: number = 16,
  matrixHeight: number = 16
): {
  pixelCount: number;
  estimatedBitrateKbps: number;
  savingsPercentage: number;
  cpuLoadEstimate: string;
} {
  const BASE_1080P_PIXELS = 1920 * 1080; // 2,073,600
  const BASE_1080P_BITRATE_KBPS = 18000; // ~18 Mbps

  let pixels = 160 * 120;
  if (proxyResolution === '160x120') {
    pixels = 160 * 120; // 19,200
  } else if (proxyResolution === '320x240') {
    pixels = 320 * 240; // 76,800
  } else if (proxyResolution === 'matrix_native') {
    pixels = matrixWidth * matrixHeight; // e.g. 256 for 16x16
  } else if (proxyResolution === 'source_native') {
    pixels = BASE_1080P_PIXELS;
  }

  const ratio = pixels / BASE_1080P_PIXELS;
  const estimatedBitrateKbps = Math.max(120, Math.round(BASE_1080P_BITRATE_KBPS * Math.sqrt(ratio)));
  const savings = Math.max(0, Math.round((1 - ratio) * 1000) / 10);

  let cpuLoad = '< 1.5%';
  if (proxyResolution === 'source_native') {
    cpuLoad = '45-60%';
  } else if (proxyResolution === '320x240') {
    cpuLoad = '< 4.0%';
  } else if (proxyResolution === '160x120') {
    cpuLoad = '< 1.5%';
  } else {
    cpuLoad = '< 0.5%';
  }

  return {
    pixelCount: pixels,
    estimatedBitrateKbps,
    savingsPercentage: savings,
    cpuLoadEstimate: cpuLoad
  };
}
