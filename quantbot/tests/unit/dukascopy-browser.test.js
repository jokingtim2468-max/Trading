// Dukascopy's bot check (AWS WAF): the downloader passes the check once before its first request, every request
// waits while a check runs, and an expired check is passed again. (Its own file: useBrowser changes module state.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCandles, useBrowser } from '../../server/market/dukascopy.js';

const candles = { timestamp: Date.UTC(2024, 2, 4), multiplier: 0.001, open: 2083, high: 2084, low: 2082, close: 2083.5, shift: 3600000, times: [0], opens: [0], highs: [0], lows: [0], closes: [0], volumes: [1] };
const answer = (status, body = '', waf = null) => new Response(body, { status, headers: waf ? { 'x-amzn-waf-action': waf } : {} });

test('passes the bot check first, then downloads; an expired check is passed again', async () => {
  process.env.QUANTBOT_DUKASCOPY_URL = 'http://fake'; // no pacing gap
  const log = [];
  let cookie = false;
  useBrowser({
    fetch: async (url) => { log.push(`get ${cookie}`); return cookie ? answer(200, JSON.stringify(candles)) : answer(202, '', 'challenge'); },
    solve: async () => { log.push('solve'); await new Promise((r) => setTimeout(r, 20)); cookie = true; return true; },
  });
  const [a, b] = await Promise.all([fetchCandles('http://fake/candles/hour/XAU-USD/BID/2024/3'), fetchCandles('http://fake/candles/hour/XAU-USD/ASK/2024/3')]);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.deepEqual(log, ['solve', 'get true', 'get true'], 'one check, before any request');

  cookie = false; // the check's cookie expired
  const c = await fetchCandles('http://fake/candles/hour/XAU-USD/BID/2024/4');
  assert.equal(c.length, 1);
  assert.deepEqual(log.slice(3), ['get false', 'solve', 'get true']);
});

test('a check that keeps failing gives a clear message', async () => {
  useBrowser({ fetch: async () => answer(202, '', 'challenge'), solve: async () => false });
  await assert.rejects(fetchCandles('http://fake/candles/hour/XAU-USD/BID/2024/5', { retries: 1 }), /bot check did not clear/);
});
