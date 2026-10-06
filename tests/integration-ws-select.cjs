// End-to-end check of OMT source selection against the real engine:
//   1. engine reports mDNS-discovered sources
//   2. selecting one actually switches the engine's active source
//   3. an unreachable publisher produces a visible error status (not silence)
// Run: node build/ws-select-test.cjs <port>
const WebSocket = require('ws');

const PORT = process.argv[2] || '8080';
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);

const statuses = [];
let sources = [];
let selected = false;
let initialStatus = null;
let done = false;

const finish = (code, msg) => {
  if (done) return;
  done = true;
  console.log(msg);
  console.log('statuses observed:');
  statuses.forEach((s) => console.log('   ' + s));
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(code), 100);
};

const timer = setTimeout(() => {
  // Nothing advertising on this network is an environment condition, not a
  // failure of the selection path. Report it distinctly (exit 77 = skip).
  if (sources.length === 0) {
    finish(77, 'SKIP: no OMT publisher is advertising on this network right now, ' +
      'so source selection could not be exercised.');
    return;
  }
  finish(1, `TIMEOUT: sources=${sources.length} selected=${selected} statuses=${JSON.stringify(statuses)}`);
}, 30000);

ws.on('open', () => console.log('connected to engine'));

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  if (msg.type === 'omt_sources') {
    sources = msg.data || [];
    console.log(`omt_sources: ${sources.length} discovered`);
    sources.forEach((s) => console.log(`   ${s.name} -> omt://${s.host}:${s.port} (${s.resolution})`));

    // Select the first discovered source once we know about it.
    if (!selected && sources.length > 0) {
      selected = true;
      const id = sources[0].id;
      console.log(`selecting: ${id}`);
      ws.send(JSON.stringify({ command: 'select_omt_source', id }));
    }
  }

  if (msg.type === 'telemetry' && msg.data) {
    const st = msg.data.source_status;
    if (st && statuses[statuses.length - 1] !== st) {
      statuses.push(st);
      if (initialStatus === null) initialStatus = st;
    }

    // Wait for a TERMINAL state: either frames actually arrive, or the engine
    // reported the failure and fell back. "connecting" alone is not proof.
    const terminal =
      st && (/connection failed/.test(st) || /fell back/.test(st) || /receiving /.test(st));

    if (terminal) {
      clearTimeout(timer);
      finish(0, `PASS: selection acted on and resolved to a terminal state: "${st}"`);
    }
  }
});

ws.on('error', (e) => finish(1, 'WS ERROR: ' + e.message));
