// Measures the engine's per-frame render time distribution.
//
// This is the diagnostic that caught a ~1.8s stall: the engine was awaiting UDP
// sends to DMX targets that did not exist on the network, so the kernel's ARP
// lookups blocked the whole frame loop. Any return of a large p90/max here
// means something is blocking the render loop again.
//
// Note: telemetry is republished once per second but pushed over the WebSocket
// at 20Hz, so distinct readings are far fewer than samples. The min/median/max
// below are still correct; they are just repeated between updates.
//
// Usage: node tests/diagnose-render-perf.cjs [port] [seconds]
const WebSocket = require('ws');

const PORT = process.argv[2] || '8080';
const SECONDS = Number(process.argv[3] || 20);
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);

let selected = false;
const fps = [];
const render = [];

ws.on('error', (e) => {
  console.error(`WS ERROR: ${e.message} (is the engine running on port ${PORT}?)`);
  process.exit(1);
});

ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(raw.toString()); } catch { return; }

  if (m.type === 'omt_sources' && !selected) {
    const s = (m.data || []).find((x) => /test pattern/i.test(x.name)) || (m.data || [])[0];
    if (s) {
      selected = true;
      ws.send(JSON.stringify({ command: 'select_omt_source', id: s.id }));
    }
  }

  if (m.type === 'telemetry' && m.data) {
    if (m.data.fps > 0) fps.push(m.data.fps);
    if (m.data.render_time_us > 0) render.push(m.data.render_time_us);
  }
});

setTimeout(() => {
  const q = (a, p) =>
    a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

  console.log(`samples: fps=${fps.length} render=${render.length}`);
  if (fps.length) {
    console.log(`fps        min=${Math.min(...fps)} median=${q(fps, 0.5)} max=${Math.max(...fps)}`);
  }
  if (render.length) {
    console.log(
      `render_us  min=${Math.min(...render)} median=${q(render, 0.5)} p90=${q(render, 0.9)} max=${Math.max(...render)}`
    );
  }

  const slow = render.filter((v) => v > 100000).length;
  console.log(`frames over 100ms: ${slow}/${render.length}`);
  console.log(
    slow === 0
      ? 'OK: no render-loop stalls detected.'
      : 'PROBLEM: the render loop is stalling — check for blocking work in the frame loop.'
  );

  process.exit(slow === 0 ? 0 : 1);
}, SECONDS * 1000);
