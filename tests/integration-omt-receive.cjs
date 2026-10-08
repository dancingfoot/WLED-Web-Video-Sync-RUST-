// End-to-end check that a real OMT source reaches the LED output stage.
//
// Connects to the engine, selects an advertised OMT publisher, then reads
// telemetry to confirm decoded frames are actually flowing through the pixel
// pipeline (fps and DMX packets, not just a successful TCP connect).
//
// Usage: node tests/integration-omt-receive.cjs [port]
//
// Exit codes: 0 = receiving, 1 = problem, 77 = skipped (no publisher advertising)
const WebSocket = require('ws');

const PORT = process.argv[2] || '8080';
const PROBE_MS = 15000;
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);

let sources = [];
let selectedId = null;
let last = null;
let done = false;

const finish = (code, msg) => {
  if (done) return;
  done = true;
  console.log(msg);
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(code), 100);
};

ws.on('error', (e) => finish(1, `WS ERROR: ${e.message} (is the engine running on port ${PORT}?)`));

ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(raw.toString()); } catch { return; }

  if (m.type === 'omt_sources') {
    sources = m.data || [];
    if (!selectedId && sources.length) {
      // Prefer a loopback/test publisher when one is available.
      const pick = sources.find((s) => /test pattern/i.test(s.name)) || sources[0];
      selectedId = pick.id;
      console.log(`selecting: ${pick.name} (${pick.host}:${pick.port})`);
      ws.send(JSON.stringify({ command: 'select_omt_source', id: pick.id }));
    }
  }

  if (m.type === 'telemetry') last = m.data;
});

setTimeout(() => {
  if (!last) {
    finish(1, `no telemetry from the engine on port ${PORT}`);
    return;
  }

  const status = last.source_status || '';
  console.log('source_status :', status);
  console.log('fps           :', last.fps);
  console.log('packets_sent  :', last.packets_sent);
  console.log('bytes_sent    :', last.bytes_sent);
  console.log('render_time_us:', last.render_time_us);

  if (sources.length === 0) {
    finish(77, 'SKIP: no OMT publisher is advertising on this network.');
  } else if (/receiving/i.test(status) && last.fps > 0 && last.packets_sent > 0) {
    finish(0, 'OK: decoded OMT frames are flowing through the pixel pipeline.');
  } else if (/fell back/i.test(status)) {
    // The engine handled an unreachable publisher correctly, but this run did
    // not prove decoding end to end.
    finish(1, `INCONCLUSIVE: the publisher was unreachable and the engine fell back. ${status}`);
  } else {
    finish(1, `PROBLEM: frames are not reaching the output stage. ${status}`);
  }
}, PROBE_MS);
