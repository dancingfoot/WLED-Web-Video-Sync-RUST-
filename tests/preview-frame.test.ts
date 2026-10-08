/**
 * Checks the binary preview-frame decoder against bytes in the exact layout the
 * Rust engine sends (see rust-engine/src/server.rs).
 *
 * Run: node_modules/.bin/tsx tests/preview-frame.test.ts
 */
import assert from 'node:assert';
import { parsePreviewFrame, PREVIEW_MESSAGE_TYPE } from '../src/utils/previewFrame';

let failures = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(err as Error).message}`);
  }
};

/** Build a message the way the engine does. */
function buildPreview(width: number, height: number, fill: (i: number) => [number, number, number]) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = fill(i);
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  const buf = new ArrayBuffer(5 + rgb.length);
  const view = new DataView(buf);
  view.setUint8(0, PREVIEW_MESSAGE_TYPE);
  view.setUint16(1, width, true);
  view.setUint16(3, height, true);
  new Uint8Array(buf, 5).set(rgb);
  return buf;
}

console.log('previewFrame');

check('parses a well-formed frame with the real 240x135 layout', () => {
  const buf = buildPreview(240, 135, (i) => [i % 256, (i * 2) % 256, (i * 3) % 256]);
  const frame = parsePreviewFrame(buf);
  assert.ok(frame, 'should parse');
  assert.strictEqual(frame!.width, 240);
  assert.strictEqual(frame!.height, 135);
  assert.strictEqual(frame!.rgb.length, 240 * 135 * 3);
  // First pixel and a pixel deep into the buffer must land correctly.
  assert.deepStrictEqual([frame!.rgb[0], frame!.rgb[1], frame!.rgb[2]], [0, 0, 0]);
  const i = 1000;
  assert.deepStrictEqual(
    [frame!.rgb[i * 3], frame!.rgb[i * 3 + 1], frame!.rgb[i * 3 + 2]],
    [i % 256, (i * 2) % 256, (i * 3) % 256],
    'pixel 1000 offset is wrong'
  );
});

check('little-endian dimensions (not big-endian)', () => {
  // 240 = 0x00F0. Big-endian parsing would read 0xF000 = 61440.
  const buf = buildPreview(240, 135, () => [1, 2, 3]);
  const view = new DataView(buf);
  assert.strictEqual(view.getUint16(1, true), 240);
  const frame = parsePreviewFrame(buf)!;
  assert.strictEqual(frame.width, 240);
  assert.strictEqual(frame.height, 135);
});

check('rejects a wrong message type', () => {
  const buf = buildPreview(8, 8, () => [1, 2, 3]);
  new DataView(buf).setUint8(0, 0x02);
  assert.strictEqual(parsePreviewFrame(buf), null);
});

check('rejects a truncated payload instead of reading out of bounds', () => {
  const buf = buildPreview(16, 16, () => [9, 9, 9]);
  const truncated = buf.slice(0, buf.byteLength - 10);
  assert.strictEqual(parsePreviewFrame(truncated), null);
});

check('rejects a too-short header', () => {
  assert.strictEqual(parsePreviewFrame(new ArrayBuffer(3)), null);
});

check('rejects zero dimensions', () => {
  const buf = buildPreview(8, 8, () => [1, 2, 3]);
  const view = new DataView(buf);
  view.setUint16(1, 0, true);
  assert.strictEqual(parsePreviewFrame(buf), null);
});

check('accepts a frame with trailing padding', () => {
  const base = buildPreview(8, 8, () => [7, 8, 9]);
  const padded = new ArrayBuffer(base.byteLength + 16);
  new Uint8Array(padded).set(new Uint8Array(base));
  const frame = parsePreviewFrame(padded);
  assert.ok(frame, 'trailing bytes should not break parsing');
  assert.strictEqual(frame!.width, 8);
});

console.log(failures === 0 ? '\nPASS: all preview-frame checks passed' : `\nFAIL: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
