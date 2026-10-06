/**
 * Source-region geometry for mapping a video frame onto an LED matrix.
 *
 * A source and a matrix rarely share an aspect ratio. Mapping the whole frame
 * onto the matrix stretches the image, so instead we map a *region* of the
 * source, chosen to match the matrix's aspect ratio.
 *
 * All percentages here are relative to the full source frame, and all pixel
 * values are in source-frame pixels.
 */

export interface RegionRect {
  /** Left edge, in source pixels. */
  x: number;
  /** Top edge, in source pixels. */
  y: number;
  /** Width, in source pixels. */
  w: number;
  /** Height, in source pixels. */
  h: number;
}

/**
 * The largest centered region of the source whose aspect ratio equals the
 * matrix's. This is the zero-distortion default: it uses as much of the frame as
 * possible while keeping circles circular.
 *
 * A 16:9 source on a square matrix yields a centered square (full height, sides
 * trimmed) rather than the whole frame squeezed into the square.
 */
export function autoFitRegion(
  srcW: number,
  srcH: number,
  matrixW: number,
  matrixH: number
): RegionRect {
  if (srcW <= 0 || srcH <= 0 || matrixW <= 0 || matrixH <= 0) {
    return { x: 0, y: 0, w: Math.max(1, srcW), h: Math.max(1, srcH) };
  }

  const srcAspect = srcW / srcH;
  const matrixAspect = matrixW / matrixH;

  if (srcAspect > matrixAspect) {
    // Source wider than the matrix: keep full height, trim the sides.
    const w = srcH * matrixAspect;
    return { x: (srcW - w) / 2, y: 0, w, h: srcH };
  }
  // Source narrower/taller: keep full width, trim top and bottom.
  const h = srcW / matrixAspect;
  return { x: 0, y: (srcH - h) / 2, w: srcW, h };
}

/**
 * Convert the UI's center-based percentage mapping into a source-pixel region.
 * `customX`/`customY` are the region's center; width/height are its size.
 */
export function regionFromPercent(
  customX: number,
  customY: number,
  customWidth: number,
  customHeight: number,
  srcW: number,
  srcH: number
): RegionRect {
  return {
    x: ((customX - customWidth / 2) / 100) * srcW,
    y: ((customY - customHeight / 2) / 100) * srcH,
    w: (customWidth / 100) * srcW,
    h: (customHeight / 100) * srcH,
  };
}

/** Keep a region inside the frame; never returns a degenerate (zero-size) rect. */
export function clampRegion(r: RegionRect, srcW: number, srcH: number): RegionRect {
  const w = Math.max(1, Math.min(r.w, srcW));
  const h = Math.max(1, Math.min(r.h, srcH));
  return {
    w,
    h,
    x: Math.max(0, Math.min(r.x, srcW - w)),
    y: Math.max(0, Math.min(r.y, srcH - h)),
  };
}

/**
 * New width/height percentages for a region drag, locked to the ratio between
 * customWidth and customHeight that keeps the crop matched to the matrix aspect.
 *
 * `ratio` is `customWidth / customHeight` required for a distortion-free crop,
 * i.e. `matrixAspect / sourceAspect`. Without this a free-form resize can make
 * the region's aspect differ from the matrix and reintroduce the stretching the
 * region exists to prevent.
 */
export function aspectLockedPercent(
  startWidthPct: number,
  drivingDelta: number,
  ratio: number,
  min = 2,
  max = 100
): { width: number; height: number } {
  if (!isFinite(ratio) || ratio <= 0) {
    return { width: clamp(startWidthPct, min, max), height: clamp(startWidthPct, min, max) };
  }

  let width = clamp(startWidthPct + drivingDelta * 2, min, max);
  let height = width / ratio;

  if (height > max) {
    height = max;
    width = height * ratio;
  }
  if (height < min) {
    height = min;
    width = height * ratio;
  }

  // Two decimal places, not whole percents: rounding both axes to integers
  // breaks the ratio badly for small crops (a 2%/4% pair is 11% off square),
  // which would put the distortion straight back.
  return {
    width: round2(clamp(width, min, max)),
    height: round2(clamp(height, min, max)),
  };
}

/**
 * The auto-fit crop expressed as center-based width/height percentages.
 *
 * Used when the operator switches custom mapping on: seeding it with a fixed
 * square box would itself be distorted on a non-square source, so it starts from
 * the same undistorted crop that auto-fit was already using.
 */
export function autoFitPercent(
  srcAspect: number,
  matrixAspect: number
): { width: number; height: number } {
  if (
    !isFinite(srcAspect) ||
    !isFinite(matrixAspect) ||
    srcAspect <= 0 ||
    matrixAspect <= 0
  ) {
    return { width: 100, height: 100 };
  }
  if (srcAspect > matrixAspect) {
    return { width: (matrixAspect / srcAspect) * 100, height: 100 };
  }
  return { width: 100, height: (srcAspect / matrixAspect) * 100 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
