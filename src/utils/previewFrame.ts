/**
 * Decoding of the binary preview frames the Rust engine pushes over its
 * WebSocket.
 *
 * Framing: [0x01][width u16 LE][height u16 LE][RGB8 ...]
 *
 * The engine decodes OMT video natively, so this preview is the only way the
 * browser can show what the receiver is actually getting.
 */

export interface PreviewFrame {
  width: number;
  height: number;
  /** Tightly packed RGB24, `width * height * 3` bytes. */
  rgb: Uint8ClampedArray;
}

export const PREVIEW_MESSAGE_TYPE = 0x01;
const HEADER_BYTES = 5;

/**
 * Parse one preview message. Returns null for anything malformed rather than
 * throwing, so a stray message can never break the render loop.
 */
export function parsePreviewFrame(buffer: ArrayBuffer): PreviewFrame | null {
  if (buffer.byteLength < HEADER_BYTES) return null;

  const view = new DataView(buffer);
  if (view.getUint8(0) !== PREVIEW_MESSAGE_TYPE) return null;

  const width = view.getUint16(1, true);
  const height = view.getUint16(3, true);
  if (width === 0 || height === 0) return null;

  const expected = width * height * 3;
  if (buffer.byteLength < HEADER_BYTES + expected) return null;

  return {
    width,
    height,
    rgb: new Uint8ClampedArray(buffer, HEADER_BYTES, expected),
  };
}

/**
 * Copy a parsed frame into a canvas so it can be scaled into the master frame.
 * Only rebuilt when the frame actually changes.
 */
export function drawPreviewToCanvas(
  frame: PreviewFrame,
  canvas: HTMLCanvasElement
): HTMLCanvasElement {
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(frame.width, frame.height);
    const src = frame.rgb;
    const dst = img.data;
    for (let i = 0, j = 0; j < dst.length; i += 3, j += 4) {
      dst[j] = src[i];
      dst[j + 1] = src[i + 1];
      dst[j + 2] = src[i + 2];
      dst[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}
