// Market data: broker time, Dukascopy decoding, the download cache and resampling (against a fake Dukascopy)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newYorkDst, toBroker } from '../../server/market/brokerTime.js';
import { decodeCandles, candlesUrl } from '../../server/market/dukascopy.js';
import { resample, encodeBars } from '../../server/market/resample.js';
import { createMarketStore } from '../../server/market/store.js';
import { startFakeDukascopy } from '../support/fakeDukascopy.js';

const H = 3600000, DAY = 86400000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-market-'));

describe('broker time', () => {
  test('UTC+3 during New York daylight saving, UTC+2 otherwise', () => {
    assert.equal(newYorkDst(Date.UTC(2026, 6, 1)), true);
    assert.equal(newYorkDst(Date.UTC(2026, 0, 15)), false);
    // 2026: DST from 8 March 07:00 UTC to 1 November 06:00 UTC
    assert.equal(newYorkDst(Date.UTC(2026, 2, 8, 6, 59)), false);
    assert.equal(newYorkDst(Date.UTC(2026, 2, 8, 7)), true);
    assert.equal(newYorkDst(Date.UTC(2026, 10, 1, 5, 59)), true);
    assert.equal(newYorkDst(Date.UTC(2026, 10, 1, 6)), false);
    // 2005 used the old rule: first Sunday of April (3rd) to last Sunday of October (30th)
    assert.equal(newYorkDst(Date.UTC(2005, 3, 2)), false);
    assert.equal(newYorkDst(Date.UTC(2005, 3, 4)), true);
    assert.equal(newYorkDst(Date.UTC(2005, 9, 31)), false);
    // 21:00 UTC on a winter Friday is 23:00 server time; 21:00 UTC in summer is 00:00 the next day
    assert.equal(new Date(toBroker(Date.UTC(2026, 0, 16, 21))).getUTCHours(), 23);
    assert.equal(new Date(toBroker(Date.UTC(2026, 6, 16, 21))).getUTCDate(), 17);
  });
});

describe('Dukascopy format', () => {
  test('decodes delta-encoded candles', () => {
    const c = decodeCandles({
      timestamp: 1000, multiplier: 0.001, shift: 60000, open: 2000, high: 2001, low: 1999, close: 2000.5,
      times: [0, 3], opens: [0, 500], highs: [0, 250], lows: [0, -100], closes: [0, 1000], volumes: [1.5, 2],
    });
    assert.equal(c.length, 2);
    assert.equal(c[0].time, 1000);
    assert.equal(c[1].time, 1000 + 3 * 60000, 'gaps are skipped, not filled');
    assert.ok(Math.abs(c[1].open - 2000.5) < 1e-9);
    assert.ok(Math.abs(c[1].close - 2001.5) < 1e-9);
    assert.deepEqual(decodeCandles({ timestamp: 0, times: [] }), []);
    assert.throws(() => decodeCandles({}), /Unexpected data/);
  });

  test('URLs for finished and running periods', () => {
    process.env.QUANTBOT_DUKASCOPY_URL = 'https://x/v1';
    const now = Date.UTC(2026, 9, 14, 12);
    assert.equal(candlesUrl('XAU-USD', 'BID', 'minute', Date.UTC(2024, 0, 3), now), 'https://x/v1/candles/minute/XAU-USD/BID/2024/1/3');
    assert.equal(candlesUrl('XAU-USD', 'ASK', 'hour', Date.UTC(2024, 4, 1), now), 'https://x/v1/candles/hour/XAU-USD/ASK/2024/5');
    assert.equal(candlesUrl('XAU-USD', 'BID', 'day', Date.UTC(1999, 0, 1), now), 'https://x/v1/candles/day/XAU-USD/BID/1999');
    assert.equal(candlesUrl('XAU-USD', 'BID', 'minute', Date.UTC(2026, 9, 14), now), `https://x/v1/candles/minute/XAU-USD/BID?from=${Date.UTC(2026, 9, 14)}`);
    delete process.env.QUANTBOT_DUKASCOPY_URL;
  });
});

describe('resampling', () => {
  test('H4 buckets on server-time boundaries, spread from the opening bar', () => {
    const t0 = Date.UTC(2026, 0, 5);
    const bars = { time: [], open: [], high: [], low: [], close: [], volume: [], spread: [] };
    for (let k = 0; k < 8; k++) {
      bars.time.push(t0 + k * H); bars.open.push(k); bars.high.push(k + 1); bars.low.push(k - 1); bars.close.push(k + 0.5);
      bars.volume.push(1); bars.spread.push(10 + k);
    }
    const r = resample(bars, 240);
    assert.deepEqual([...r.time], [t0, t0 + 4 * H]);
    assert.deepEqual([...r.open], [0, 4]);
    assert.deepEqual([...r.high], [4, 8]);
    assert.deepEqual([...r.low], [-1, 3]);
    assert.deepEqual([...r.close], [3.5, 7.5]);
    assert.deepEqual([...r.volume], [4, 4]);
    assert.deepEqual([...r.spread], [10, 14]);
    const buf = encodeBars(r);
    assert.equal(new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8)[0], 2);
  });
});

describe('download store', () => {
  let fake, store;
  before(async () => {
    fake = await startFakeDukascopy();
    process.env.QUANTBOT_DUKASCOPY_URL = fake.url;
    store = createMarketStore(tmp());
  });
  after(async () => { delete process.env.QUANTBOT_DUKASCOPY_URL; await fake.close(); });

  test('M15 bars in broker time with spread, then served from disk', async () => {
    let progress = [];
    const bars = await store.bars('XAUUSD', 'M15', '2024-01-08', '2024-01-09', (d, t) => progress.push([d, t]));
    assert.equal(bars.time.length, 2 * 96, 'two full weekdays of M15 bars');
    assert.equal(bars.time[0], Date.UTC(2024, 0, 8), 'starts at 00:00 server time');
    assert.equal(bars.spread[0], 30, '0.30 spread = 30 points');
    assert.ok(progress.at(-1)[0] === progress.at(-1)[1] && progress.at(-1)[1] > 0);
    // Server time 00:00 Jan 8 is 22:00 UTC Jan 7 in winter
    assert.ok(Math.abs(bars.open[0] - Math.round(fake.price('XAU-USD', Date.UTC(2024, 0, 7, 22)) * 100) / 100) < 0.011);

    const before = fake.requests.length;
    const again = await store.bars('XAUUSD', 'M15', '2024-01-08', '2024-01-09');
    assert.equal(fake.requests.length, before, 'second read comes from disk');
    assert.deepEqual([...again.close], [...bars.close]);
  });

  test('weekend has no bars; H4 and D1 from hourly data', async () => {
    const h4 = await store.bars('XAUUSD', 'H4', '2024-03-04', '2024-03-10');
    const days = new Set([...h4.time].map((t) => new Date(t).getUTCDay()));
    assert.ok(!days.has(6), 'no Saturday bars');
    assert.ok([...h4.time].every((t) => new Date(t).getUTCHours() % 4 === 0));
    const d1 = await store.bars('XAUUSD', 'D1', '2024-03-04', '2024-03-08');
    assert.equal(d1.time.length, 5);
    assert.ok(fake.requests.some((r) => r.includes('/hour/XAU-USD/BID/2024/3')));
  });

  test('US100 daily history from 1990 through the hourly era', async () => {
    const d1 = await store.bars('US100', 'D1', '1995-01-01', '2012-12-31');
    assert.equal(new Date(d1.time[0]).getUTCFullYear(), 1995);
    assert.equal(new Date(d1.time.at(-1)).getUTCFullYear(), 2012);
    assert.ok(fake.requests.some((r) => r.includes('/day/USATECH.IDX-USD/BID/1995')));
    assert.ok(fake.requests.some((r) => r.includes('/hour/USATECH.IDX-USD/BID/2012/6')));
    for (let i = 1; i < d1.time.length; i++) assert.ok(d1.time[i] > d1.time[i - 1], 'strictly increasing');
  });

  test('NQ reuses the US100 download, on a 0.25 tick with a 1-tick spread', async () => {
    const us100 = await store.bars('US100', 'H1', '2013-03-04', '2013-03-08');
    const before = fake.requests.length;
    const nq = await store.bars('NQ', 'H1', '2013-03-04', '2013-03-08');
    assert.equal(fake.requests.length, before, 'no extra downloads');
    assert.equal(nq.time.length, us100.time.length);
    for (let i = 0; i < nq.time.length; i++) {
      for (const f of ['open', 'high', 'low', 'close']) {
        assert.equal(nq[f][i] % 0.25, 0, `${f} on the tick grid`);
        assert.ok(Math.abs(nq[f][i] - us100[f][i]) <= 0.125 + 1e-9, 'same prices, rounded to the tick');
      }
      assert.equal(nq.spread[i], 1);
    }
  });

  test('limits and errors', async () => {
    await assert.rejects(store.bars('XAUUSD', 'M1', '2023-01-01', '2024-06-01'), /at most 370 days/);
    await assert.rejects(store.bars('US100', 'M15', '2005-01-01', '2005-02-01'), /No US100 data/);
    await assert.rejects(store.bars('EURUSD', 'M15', '2024-01-01', '2024-01-02'), /Unknown market/);
    await assert.rejects(store.bars('XAUUSD', 'M2', '2024-01-01', '2024-01-02'), /Unknown timeframe/);
  });

  test('background job reports progress', async () => {
    const job = store.prepare('US100', 'H1', '2015-01-01', '2015-12-31');
    let state = job;
    while (state.state === 'running') { await new Promise((r) => setTimeout(r, 20)); state = store.job(job.id); }
    assert.equal(state.state, 'done', state.error);
    assert.equal(state.done, state.total);
    assert.equal(state.total, 48, '2015 plus 2014 (server time starts before UTC midnight): 12 months, bid and ask, each');
    const info = store.info().find((m) => m.symbol === 'US100');
    assert.ok(info.stored.hour.files >= 1);
  });
});
