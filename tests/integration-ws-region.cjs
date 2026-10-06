// End-to-end check of the engine's WebSocket protocol:
//   - omt_sources snapshot on connect
//   - region snapshot on connect (auto aspect-fit by default)
//   - update_region round trip
// Run with: node build/ws-region-test.cjs
const WebSocket = require('ws');

const PORT = process.argv[2] || '8080';
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const seen = { omt_sources: 0, region: [], telemetry: 0 };
let done = false;

const finish = (code, msg) => {
  if (done) return;
  done = true;
  console.log(msg);
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(code), 100);
};

const timer = setTimeout(() => {
  finish(1, `TIMEOUT. got omt_sources=${seen.omt_sources} telemetry=${seen.telemetry} regions=${JSON.stringify(seen.region)}`);
}, 8000);

ws.on('open', () => {
  // Ask for an explicit, non-auto region.
  ws.send(JSON.stringify({
    command: 'update_region',
    region: { x: 0.25, y: 0.1, width: 0.5, height: 0.75, auto_aspect: false },
  }));
});

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  if (msg.type === 'omt_sources') {
    seen.omt_sources++;
    console.log('omt_sources snapshot:', JSON.stringify(msg.data));
  } else if (msg.type === 'telemetry') {
    seen.telemetry++;
  } else if (msg.type === 'region') {
    seen.region.push(msg.data);
    console.log('region:', JSON.stringify(msg.data));
    // First region is the connect snapshot (auto), second is our echo.
    if (seen.region.length >= 2) {
      const first = seen.region[0];
      const echo = seen.region[1];
      const autoDefaulted = first.auto_aspect === true;
      const echoOk =
        Math.abs(echo.x - 0.25) < 1e-6 &&
        Math.abs(echo.y - 0.1) < 1e-6 &&
        Math.abs(echo.width - 0.5) < 1e-6 &&
        Math.abs(echo.height - 0.75) < 1e-6 &&
        echo.auto_aspect === false;
      const telemetryOk = seen.telemetry > 0;

      clearTimeout(timer);
      if (autoDefaulted && echoOk && telemetryOk && seen.omt_sources > 0) {
        finish(0, 'PASS: snapshot(auto_aspect=true) + update_region round trip + telemetry all working');
      } else {
        finish(1, `FAIL: autoDefaulted=${autoDefaulted} echoOk=${echoOk} telemetryOk=${telemetryOk} omtSnapshot=${seen.omt_sources}`);
      }
    }
  }
});

ws.on('error', (e) => finish(1, 'WS ERROR: ' + e.message));
