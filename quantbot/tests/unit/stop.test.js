import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { callOllama } from '../../server/lib/ollama.js';
import { withSignal } from '../../server/lib/abort.js';

test('Stop cancels a local-model reply that is still being written', async () => {
  // A model server that never finishes answering
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.write(`${JSON.stringify({ message: { content: 'Hel' } })}\n`); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const ctl = new AbortController();
  let live = '';
  const t0 = Date.now();
  const p = withSignal(ctl.signal, () => callOllama(url, 'm', 'sys', [{ role: 'user', content: 'hi' }], 100, null, (txt) => { live = txt; }));
  setTimeout(() => ctl.abort(), 300);
  await assert.rejects(p, /Stopped|abort/i);
  assert.ok(Date.now() - t0 < 5000, 'stops right away, not at the timeout');
  assert.equal(live, 'Hel');
  server.closeAllConnections(); server.close();
});
