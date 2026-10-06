/**
 * Checks the frontend source-region maths. Mirrors the Rust unit tests so both
 * halves of the pipeline agree that the sampled region's aspect equals the
 * matrix aspect (i.e. the image is never stretched).
 *
 * Run: node_modules/.bin/tsx build/region-math.test.ts
 */
import assert from 'node:assert';
import {
  autoFitPercent,
  autoFitRegion,
  aspectLockedPercent,
  clampRegion,
  regionFromPercent,
} from '../src/utils/regionMath';

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

console.log('regionMath');

check('16:9 source on a square matrix uses a centered square, not the whole frame', () => {
  const r = autoFitRegion(1280, 720, 16, 16);
  assert.ok(Math.abs(r.h - 720) < 1e-6, `height should be 720, got ${r.h}`);
  assert.ok(Math.abs(r.w - 720) < 1e-6, `width should be 720, got ${r.w}`);
  assert.ok(Math.abs(r.x - 280) < 1e-6, `x should be centered at 280, got ${r.x}`);
  assert.ok(Math.abs(r.y - 0) < 1e-6, `y should be 0, got ${r.y}`);
});

check('region pixel aspect always equals matrix aspect', () => {
  const cases: Array<[number, number, number, number]> = [
    [1280, 720, 16, 16],
    [1920, 1080, 32, 16],
    [640, 480, 8, 32],
    [100, 100, 10, 10],
    [3840, 2160, 64, 64],
  ];
  for (const [sw, sh, mw, mh] of cases) {
    const r = autoFitRegion(sw, sh, mw, mh);
    const regionAspect = r.w / r.h;
    const matrixAspect = mw / mh;
    assert.ok(
      Math.abs(regionAspect - matrixAspect) < 1e-4,
      `${sw}x${sh} -> ${mw}x${mh}: region aspect ${regionAspect} != matrix aspect ${matrixAspect}`
    );
    assert.ok(r.w <= sw + 1e-6 && r.h <= sh + 1e-6, 'region must stay inside the frame');
    assert.ok(r.x >= -1e-6 && r.y >= -1e-6, 'region must stay inside the frame');
  }
});

check('clamp keeps an oversized region inside the frame', () => {
  const r = clampRegion({ x: 0.9 * 1280, y: 0.9 * 720, w: 500, h: 500 }, 1280, 720);
  assert.ok(r.x + r.w <= 1280 + 1e-6, `x+w = ${r.x + r.w} exceeds frame`);
  assert.ok(r.y + r.h <= 720 + 1e-6, `y+h = ${r.y + r.h} exceeds frame`);
  assert.ok(r.w >= 1 && r.h >= 1, 'region must not collapse');
});

check('aspect-locked resize keeps the crop matched to the matrix', () => {
  const srcW = 1280;
  const srcH = 720;
  const matrixW = 16;
  const matrixH = 16;
  const ratio = matrixW / matrixH / (srcW / srcH); // customWidth / customHeight

  for (const delta of [-40, -10, 0, 15, 60]) {
    const { width, height } = aspectLockedPercent(60, delta, ratio);
    const region = regionFromPercent(50, 50, width, height, srcW, srcH);
    const regionAspect = region.w / region.h;
    const matrixAspect = matrixW / matrixH;
    assert.ok(
      Math.abs(regionAspect - matrixAspect) < 0.02,
      `delta ${delta}: region aspect ${regionAspect.toFixed(4)} != matrix aspect ${matrixAspect} ` +
        `(w%=${width}, h%=${height})`
    );
    assert.ok(width >= 2 && width <= 100 && height >= 2 && height <= 100, 'percentages in range');
  }
});

check('switching to manual crop seeds an undistorted region', () => {
  const { width, height } = autoFitPercent(1280 / 720, 16 / 16);
  assert.ok(Math.abs(width - 56.25) < 1e-6, `expected 56.25% wide, got ${width}`);
  assert.ok(Math.abs(height - 100) < 1e-6, `expected 100% high, got ${height}`);
  const rect = regionFromPercent(50, 50, width, height, 1280, 720);
  assert.ok(
    Math.abs(rect.w / rect.h - 1) < 1e-6,
    `seeded crop aspect ${rect.w / rect.h} should be square to match the matrix`
  );
});

check('aspect-locked resize survives a degenerate ratio', () => {
  const { width, height } = aspectLockedPercent(60, 10, 0);
  assert.ok(Number.isFinite(width) && Number.isFinite(height));
  assert.ok(width >= 2 && height >= 2);
});

console.log(failures === 0 ? '\nPASS: all region maths checks passed' : `\nFAIL: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
