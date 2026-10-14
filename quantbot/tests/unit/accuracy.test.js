// Accuracy check for the Strategy Tester: one ultra-basic script on the same week for every market, compared with
// (1) bars rebuilt by hand from the raw minute prices and (2) a separate, plain re-implementation of the fill rules.
// Every number must match exactly. Uses the fake Dukascopy feed (deterministic prices), never the network.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { createMarketStore } from '../../server/market/store.js';
import { INSTRUMENTS } from '../../server/market/instruments.js';
import { brokerOffsetHours } from '../../server/market/brokerTime.js';
import { startFakeDukascopy, open as marketOpen } from '../support/fakeDukascopy.js';

const MIN = 60000, DAY = 86400000;
const WEEK = { from: '2024-03-04', to: '2024-03-08' };
// Fake feed spreads (ask - bid) and the stop / target distance used per market
const MARKETS = {
  XAUUSD: { code: 'XAU-USD', spread: 0.3, stop: 3, side: 'buy' },
  US100: { code: 'USATECH.IDX-USD', spread: 1.5, stop: 30, side: 'sell' },
};

// The ultra-basic script: at the close of the 08:00 server-time M15 bar open one trade with a fixed stop and target,
// close it at the close of the 16:00 bar if it is still open
const simCode = (side, stop) => `
if (ctx.position) return ctx.hour === 16 && ctx.minute === 0 ? { action: 'close' } : null;
if (ctx.hour !== 8 || ctx.minute !== 0) return null;
const c = ctx.close[ctx.i];
return ${side === 'buy'
    ? `{ action: 'buy', lots: 1, sl: c - ${stop}, tp: c + ${stop} }`
    : `{ action: 'sell', lots: 1, sl: c + ${stop}, tp: c - ${stop} }`};`;

// The same rules written out by hand: orders fill at the next bar's open (buys and short exits pay the spread),
// stops are checked before targets inside each bar, a gap through a level fills at the open, and a trade still
// open at the end closes at the last bar's close
function reference(bars, start, { side, stop }, point, contractSize) {
  const t = (k) => new Date(bars.time[k]);
  const ask = (k, p) => p + bars.spread[k] * point;
  const trades = [];
  let pos = null, pending = null;
  const close = (k, price, reason) => {
    const dir = pos.side === 'long' ? 1 : -1;
    trades.push({ side: pos.side, entry: pos.entry, exit: price, reason, pnl: (price - pos.entry) * dir * contractSize });
    pos = null;
  };
  for (let k = start; k < bars.time.length; k++) {
    if (pending === 'close' && pos) close(k, pos.side === 'long' ? bars.open[k] : ask(k, bars.open[k]), 'signal');
    else if (pending && pending !== 'close' && !pos) {
      const long = pending.side === 'buy';
      pos = { side: long ? 'long' : 'short', entry: long ? ask(k, bars.open[k]) : bars.open[k], sl: pending.sl, tp: pending.tp };
    }
    pending = null;
    if (pos) {
      const o = bars.open[k], h = bars.high[k], l = bars.low[k];
      if (pos.side === 'long') {
        if (l <= pos.sl) close(k, Math.min(o, pos.sl), 'sl');
        else if (h >= pos.tp) close(k, Math.max(o, pos.tp), 'tp');
      } else if (ask(k, h) >= pos.sl) close(k, Math.max(ask(k, o), pos.sl), 'sl');
      else if (ask(k, l) <= pos.tp) close(k, Math.min(ask(k, o), pos.tp), 'tp');
    }
    const hh = t(k).getUTCHours(), mm = t(k).getUTCMinutes(), c = bars.close[k];
    if (pos && hh === 16 && mm === 0) pending = 'close';
    if (!pos && hh === 8 && mm === 0) pending = side === 'buy' ? { side, sl: c - stop, tp: c + stop } : { side, sl: c + stop, tp: c - stop };
  }
  if (pos) { const k = bars.time.length - 1; close(k, pos.side === 'long' ? bars.close[k] : ask(k, bars.close[k]), 'end'); }
  return trades;
}

let fake, vite, store;
before(async () => {
  fake = await startFakeDukascopy();
  process.env.QUANTBOT_DUKASCOPY_URL = fake.url;
  store = createMarketStore(fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-acc-')));
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
});
after(async () => { delete process.env.QUANTBOT_DUKASCOPY_URL; await vite.close(); await fake.close(); });

// The Tester's loader, fed by the local store instead of HTTP
async function testBars(symbol, tf, from, to) {
  const { loadTestBars } = await vite.ssrLoadModule('/src/lib/backtest/data.js');
  const inst = INSTRUMENTS[symbol];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url, 'http://local');
    if (u.pathname === '/api/market/prepare') return new Response(JSON.stringify({ id: '1', state: 'done', done: 0, total: 0 }));
    if (u.pathname === '/api/market/bars') {
      const q = u.searchParams;
      const { encodeBars } = await import('../../server/market/resample.js');
      return new Response(encodeBars(await store.bars(q.get('symbol'), q.get('tf'), q.get('from'), q.get('to'))));
    }
    return realFetch(url, init);
  };
  try {
    const ds = { id: `market-${symbol}`, market: true, symbol, timeframe: tf, minuteStart: inst.minuteStart, hourStart: inst.hourStart, dayStart: inst.dayStart };
    return await loadTestBars(ds, { tf, from, to });
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe('Strategy Tester accuracy, same week on every market', () => {
  const summary = [];
  after(() => console.log(`\n  Accuracy report (week ${WEEK.from} to ${WEEK.to}, M15):\n${summary.map((s) => `    ${s}`).join('\n')}\n`));

  for (const [symbol, m] of Object.entries(MARKETS)) {
    test(`${symbol}: bars match the raw minute prices exactly`, async () => {
      const inst = INSTRUMENTS[symbol];
      const { bars, start } = await testBars(symbol, 'M15', WEEK.from, WEEK.to);
      // Dukascopy quotes to 0.001; QuantBot rounds to the MT5 point (0.01), half a point up, like the broker's prices
      const round = (v) => Number((Math.round(Math.round(v / 0.001) / 10) * inst.point).toFixed(2));
      let worst = 0, checked = 0;
      for (let k = start; k < bars.time.length; k++) {
        // The 15 UTC minutes behind this server-time bar
        const brokerStart = bars.time[k];
        const utcStart = brokerStart - brokerOffsetHours(brokerStart - 3 * 3600000) * 3600000;
        const mins = Array.from({ length: 15 }, (_, j) => utcStart + j * MIN).map((t) => fake.price(m.code, t));
        const want = { open: round(mins[0]), close: round(mins[14]), high: round(Math.max(...mins) + 0.5), low: round(Math.min(...mins) - 0.5) };
        for (const f of ['open', 'high', 'low', 'close']) worst = Math.max(worst, Math.abs(bars[f][k] - want[f]));
        assert.equal(bars.spread[k], Math.round(m.spread / inst.point), 'spread in points');
        checked++;
      }
      // Every M15 slot of the week that has at least one traded minute (the feed closes Friday 21:00 UTC)
      let slots = 0;
      for (let t = Date.parse(`${WEEK.from}T00:00:00Z`); t < Date.parse(`${WEEK.to}T00:00:00Z`) + DAY; t += 15 * MIN) {
        const utc = t - 2 * 3600000;
        if (Array.from({ length: 15 }, (_, j) => utc + j * MIN).some(marketOpen)) slots++;
      }
      assert.equal(checked, slots, 'every M15 bar of the week, none missing');
      assert.ok(slots >= 470);
      assert.ok(worst < 1e-9, `largest price difference ${worst}`);
      summary.push(`${symbol}: ${checked} bars, largest price difference vs raw minutes ${worst.toExponential(1)}`);
    });

    test(`${symbol}: trades match the hand-written rules exactly, every run`, async () => {
      const { runBacktest } = await vite.ssrLoadModule('/src/lib/backtest/engine.js');
      const { computeMetrics } = await vite.ssrLoadModule('/src/lib/backtest/metrics.js');
      const inst = INSTRUMENTS[symbol];
      const { bars, start } = await testBars(symbol, 'M15', WEEK.from, WEEK.to);
      assert.equal(new Date(bars.time[start]).toISOString(), `${WEEK.from}T00:00:00.000Z`, 'test starts on the first bar of the week');
      assert.ok(start >= 400, `warm-up bars come from before the week (${start})`);
      const args = { bars, startIndex: start, simCode: simCode(m.side, m.stop), balance: 10000, contractSize: inst.contract_size, point: inst.point };
      const run = runBacktest(args);
      assert.equal(run.errors, 0);
      const want = reference(bars, start, m, inst.point, inst.contract_size);
      assert.equal(run.trades.length, want.length, 'same number of trades');
      let worst = 0;
      run.trades.forEach((tr, k) => {
        assert.equal(tr.reason, want[k].reason, `trade ${k + 1} exit reason`);
        worst = Math.max(worst, Math.abs(tr.entry - want[k].entry), Math.abs(tr.exit - want[k].exit), Math.abs(tr.pnl - want[k].pnl));
      });
      assert.ok(worst < 1e-9, `largest difference ${worst}`);
      assert.ok(want.length >= 4, 'a trade on most days');
      const again = runBacktest(args);
      assert.deepEqual(again.trades.map((x) => x.pnl), run.trades.map((x) => x.pnl), 'same result every run');
      const net = computeMetrics(run.trades, run.equity, 10000, inst.contract_size).net;
      const refNet = want.reduce((a, x) => a + x.pnl, 0);
      assert.ok(Math.abs(net - refNet) < 1e-9);
      const reasons = want.reduce((a, x) => ({ ...a, [x.reason]: (a[x.reason] || 0) + 1 }), {});
      summary.push(`${symbol}: ${want.length} trades (${Object.entries(reasons).map(([r, n]) => `${n} ${r}`).join(', ')}), net ${net.toFixed(2)} vs hand-written ${refNet.toFixed(2)}, largest difference ${worst.toExponential(1)}`);
    });
  }

  test('a trade still open when the test ends closes at the last bar\'s close', async () => {
    const { runBacktest } = await vite.ssrLoadModule('/src/lib/backtest/engine.js');
    const { sliceBars } = await vite.ssrLoadModule('/src/lib/backtest/data.js');
    const inst = INSTRUMENTS.XAUUSD;
    const week = await testBars('XAUUSD', 'M15', WEEK.from, WEEK.to);
    // End the test at 10:00 on the first day, two hours into the 08:00 trade
    const end = week.bars.time.findIndex((t) => t === Date.parse(`${WEEK.from}T10:00:00Z`));
    const bars = sliceBars(week.bars, 0, end);
    const m = { side: 'buy', stop: 50 };
    const run = runBacktest({ bars, startIndex: week.start, simCode: simCode(m.side, m.stop), balance: 10000, contractSize: inst.contract_size, point: inst.point });
    const want = reference(bars, week.start, m, inst.point, inst.contract_size);
    assert.equal(run.trades.length, 1);
    assert.equal(run.trades[0].reason, 'end');
    assert.equal(run.trades[0].exit, want[0].exit, 'exit at the close of the last bar');
    assert.ok(Math.abs(run.trades[0].pnl - want[0].pnl) < 1e-9);
    const last = run.equity.at(-1);
    assert.ok(Math.abs(last.equity - last.balance) < 1e-9, 'final equity equals final balance');
  });

  test('XAUUSD as an uploaded MT5 export gives the same trades as the built-in market', async () => {
    const { runBacktest } = await vite.ssrLoadModule('/src/lib/backtest/engine.js');
    const { parseCandles, sliceBars } = await vite.ssrLoadModule('/src/lib/backtest/data.js');
    const inst = INSTRUMENTS.XAUUSD;
    const { bars, start } = await testBars('XAUUSD', 'M15', WEEK.from, WEEK.to);
    // Write the same bars the way MT5's "Export bars" does (2 decimals for gold, spread in points)
    const pad = (n) => String(n).padStart(2, '0');
    const lines = ['<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>'];
    for (let k = 0; k < bars.time.length; k++) {
      const d = new Date(bars.time[k]);
      lines.push(`${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}\t${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00\t${['open', 'high', 'low', 'close'].map((f) => bars[f][k].toFixed(2)).join('\t')}\t${Math.round(bars.volume[k])}\t0\t${bars.spread[k]}`);
    }
    const file = parseCandles(lines.join('\n'));
    const args = (b) => ({ bars: b, startIndex: start, simCode: simCode('buy', 3), balance: 10000, contractSize: inst.contract_size, point: inst.point });
    const builtIn = runBacktest(args(bars)).trades;
    const uploaded = runBacktest(args(sliceBars(file, 0, file.time.length - 1))).trades;
    assert.deepEqual(uploaded.map((t) => [t.entry, t.exit, t.reason]), builtIn.map((t) => [t.entry, t.exit, t.reason]));
    const worst = Math.max(...builtIn.map((t, k) => Math.abs(t.pnl - uploaded[k].pnl)));
    assert.ok(worst < 1e-9, `largest P&L difference ${worst}`);
    summary.push(`XAUUSD uploaded as an MT5 export: ${uploaded.length} identical trades, largest P&L difference ${worst.toExponential(1)}`);
  });
});
