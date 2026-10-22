import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
// End-to-end run of the Terminal's trading tools against fake Dukascopy and a made-up news calendar: rule guard,
// dollar-risk sizing, news block, break-even / trail / half close, limit orders, drawings, alerts, flatten all,
// replay and the journal with a history import. Screenshots go to test-results/terminal.
const Q = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(Q, 'test-results/terminal');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const { startFakeDukascopy } = await import(`${Q}/tests/support/fakeDukascopy.js`);
const duka = await startFakeDukascopy(); process.env.QUANTBOT_DUKASCOPY_URL = duka.url;
const { startServer } = await import(`${Q}/server/index.js`);
const { chromium } = await import('playwright-core');
const soon = new Date(Date.now() + 3 * 60000).toISOString();
const later = new Date(Date.now() + 6 * 3600000).toISOString();
const newsFetch = async (url) => new Response(JSON.stringify(String(url).includes('faireconomy') ? [{ title: 'Core CPI m/m', country: 'USD', date: soon, impact: 'High' }, { title: 'FOMC Statement', country: 'USD', date: later, impact: 'High' }] : { items: [] }));
const app = await startServer({ port: 0, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 't-')), userName: 'Tim', quiet: true, newsFetch });
const base = `http://localhost:${app.port}`;
const inv = async (...args) => (await (await fetch(`${base}/api/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'entity', args }) })).json()).result;
await fetch(`${base}/api/news/refresh`, { method: 'POST' });
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const g = await inv('CopyGroup', 'create', { name: 'FTMO 100k', enabled: true });
await inv('TradingAccount', 'create', { label: 'FTMO 1', platform: 'MT5', group_id: g.id, status: 'active', start_balance: 100000, balance: 99200, max_loss: 10000, daily_loss: 5000, day_key: day, day_start: 100000 });
await inv('TradingAccount', 'create', { label: 'FTMO 2', platform: 'MT5', group_id: g.id, status: 'active', start_balance: 100000, balance: 100400, max_loss: 10000, daily_loss: 5000, day_key: day, day_start: 100000 });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
await p.goto(`${base}/terminal`); await p.waitForTimeout(3500);
ok(/Core CPI m\/m in \d min/.test(await p.getByTestId('toasts').innerText()), 'news toast 5 minutes before');
await p.screenshot({ path: `${OUT}/a0-news-toast.png` });
await p.waitForTimeout(2500);
const tid = (t) => p.getByTestId(t);
// Ticket: $ risk with a stop
await tid('sizing-risk').click();
const last = Number((await tid('side-buy').innerText()).split('\n')[1]);
await tid('ticket-sl').fill(String((last - 10).toFixed(2)));
await p.waitForTimeout(800);
ok((await tid('guard-row').count()) === 2, 'guard lists both accounts');
const note = await tid('order-ticket').innerText();
ok(/Lowest: FTMO 1, \$4,200.00 before its daily loss limit/.test(note), 'lowest account named with its room');
ok(/= 0\.25 lots/.test(note), '$250 / 10 points = 0.25 lots');
await p.screenshot({ path: `${OUT}/a1-ticket-guard.png` });
await tid('ticket-place').click(); await p.waitForTimeout(2000);
ok(/Order not copied[\s\S]*Core CPI/.test(await tid('toasts').innerText()), 'news block shown as "Order not copied" with the reason');
await p.screenshot({ path: `${OUT}/a1b-blocked.png` });
await inv('CopyGroup', 'update', g.id, { blackout: { news: false } });
await tid('ticket-place').click(); await p.waitForTimeout(2500);
ok((await tid('entry-pill').count()) === 1, 'trade on the chart');
// Half, BE, trail
await tid('entry-trail').click(); await tid('trail-input').fill('4'); await p.screenshot({ path: `${OUT}/a2-trail.png` }); await tid('trail-set').click(); await p.waitForTimeout(800);
await tid('entry-be').click(); await p.waitForTimeout(1200);
await tid('entry-half').click(); await p.waitForTimeout(2000);
const pos = (await (await fetch(`${base}/api/terminal/positions`)).json());
ok(pos.positions.length === 2 && pos.positions.every((x) => x.qty === 0.13 && Math.abs(x.sl - x.entry) < 0.01 || x.sl > x.entry - 0.01), `half closed and stop at entry: ${pos.positions.map((x) => `${x.qty}@sl${x.sl}/e${x.entry}`).join(', ')}`);
ok(!!pos.trails[pos.positions[0].trade_id], 'trailing stop on');
// Pending: limit order via ticket
await tid('type-limit').click();
ok(/Waits for a better price/.test(await tid('type-help').innerText()), 'limit explained');
await tid('ticket-sl').fill(String((last - 20).toFixed(2)));
await p.waitForTimeout(600);
await tid('ticket-place').click(); await p.waitForTimeout(1500);
ok((await tid('pending-pill').count()) === 1, 'buy limit on the chart');
// Drawings: trendline + fib
const box = await tid('terminal-chart').boundingBox();
await tid('tool-trend').click();
await p.mouse.move(box.x + 300, box.y + 450); await p.mouse.down(); await p.mouse.move(box.x + 700, box.y + 250, { steps: 8 }); await p.mouse.up();
await tid('tool-fib').click();
await p.mouse.move(box.x + 820, box.y + 120); await p.mouse.down(); await p.mouse.move(box.x + 1000, box.y + 420, { steps: 8 }); await p.mouse.up();
ok((await tid('draw-surface').count()) === 0, 'after drawing, the tool is back to the cursor');
ok((await p.locator('[data-testid=drawings] line').count()) > 8, 'trendline and fib drawn');
// Click a drawing, Backspace deletes it
const lines0 = await p.locator('[data-testid=drawings] line').count();
await p.mouse.click(box.x + 500, box.y + 350); await p.keyboard.press('Backspace'); await p.waitForTimeout(300);
ok((await p.locator('[data-testid=drawings] line').count()) < lines0, 'clicked trendline deleted with Backspace');
// Horizontal line: a drawing too (selectable, Backspace deletes it), and the tool goes back to the cursor
await tid('tool-hline').click();
await p.mouse.click(box.x + 400, box.y + 200); await p.waitForTimeout(300);
ok((await p.locator('[data-drawing=hline]').count()) === 1, 'horizontal line placed');
await p.mouse.click(box.x + 150, box.y + 200); await p.keyboard.press('Backspace'); await p.waitForTimeout(300);
ok((await p.locator('[data-drawing=hline]').count()) === 0, 'horizontal line deleted with Backspace');
// Position tool: place, see the $ at stake at 0.01 lots, drag the target, never an order
const orders0 = await tid('pending-pill').count();
await tid('tool-position').click();
await p.mouse.click(box.x + 600, box.y + 300); await p.waitForTimeout(400);
const posTool = tid('position-tool');
ok((await posTool.count()) === 1 && (await tid('draw-surface').count()) === 0, 'position placed, tool back to the cursor');
ok((await tid('position-lots').inputValue()) === '0.01', 'position defaults to 0.01 lots');
const label0 = (await posTool.innerText()).replace(/\n/g, " | ");
ok(/TP [\d.]+ \| \+\$[\d.,]+/.test(label0) && /SL [\d.]+ \| -\$[\d.,]+/.test(label0) && /R:R 2\.00/.test(label0), `position labels: ${label0.replace(/\n/g, ' | ')}`);
const tp = await tid('position-sl').boundingBox();
await p.mouse.move(tp.x + tp.width / 2, tp.y + tp.height / 2); await p.mouse.down(); await p.mouse.move(tp.x + tp.width / 2, tp.y + 60, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
ok((await posTool.innerText()).replace(/\n/g, " | ") !== label0, 'dragging the stop changes the $ and R:R');
ok((await tid('pending-pill').count()) === orders0, 'the position tool placed no order');
await p.screenshot({ path: `${OUT}/a2b-position-tool.png` });
await p.keyboard.press('Backspace'); await p.waitForTimeout(300);
ok((await tid('position-tool').count()) === 0, 'position deleted with Backspace');
// Alert via right-click above price
await p.mouse.click(box.x + 600, box.y + 60, { button: 'right' }); await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/a3-menu.png` });
await tid('menu-alert').click(); await p.waitForTimeout(800);
await p.waitForTimeout(1500);
console.log('news lines in view:', await tid('news-marker').count(), '(the fake market is closed for the weekend, so the news sits past the last bar)');
await p.screenshot({ path: `${OUT}/a4-chart.png` });
await tid('tab-orders').click(); await p.waitForTimeout(300);
ok((await tid('order-row').count()) === 1, 'orders tab');
await tid('open-settings').click(); await p.waitForTimeout(400);
const wav = path.join(OUT, 'beep.wav');
{ const n = 4410, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); fs.writeFileSync(wav, b); }
await tid('fill-sound-file').setInputFiles(wav); await p.waitForTimeout(500);
ok(/Fill sound: beep\.wav/.test(await tid('fill-sound').innerText()), 'own fill sound picked');
fs.rmSync(wav);
await p.screenshot({ path: `${OUT}/a5-settings.png` }); await p.keyboard.press('Escape');
// One-click: size 0.5 from the top-left box, the ticket's stop goes with it
await tid('type-market').click();
await tid('oneclick-qty').fill('0.49'); await tid('oneclick-qty-up').click();
ok((await tid('oneclick-qty').inputValue()) === '0.5', 'one-click size steps by 0.01 under 1 lot');
await tid('oneclick-buy').click(); await p.waitForTimeout(2500);
let oc = (await (await fetch(`${base}/api/terminal/positions`)).json()).positions;
ok(oc.length === 2 && oc.every((x) => x.qty === 0.5 && x.sl != null), `one-click buy 0.5 on both accounts with the ticket's stop: ${oc.map((x) => x.qty).join(', ')}`);
const tbox = await tid('toasts').boundingBox();
ok(tbox && tbox.y < 120 && tbox.x > 600, 'toasts at the top right');
// Hold the mouse 1 s on a control: what it is, what it does, how to use it
await tid('flatten-all').hover(); await p.waitForTimeout(400);
ok((await tid('hover-help').count()) === 0, 'no help before 1 second');
await p.waitForTimeout(900);
ok(/Emergency exit/.test(await tid('hover-help').innerText()), 'help after 1 second');
await tid('oneclick-buy').hover(); await p.waitForTimeout(1300);
ok(/One-click buy/.test(await tid('hover-help').innerText()), 'one-click help');
await p.screenshot({ path: `${OUT}/a5b-oneclick-help.png` });
await tid('entry-trail').hover(); await p.waitForTimeout(1300);
await p.screenshot({ path: `${OUT}/a5c-trail-help.png` });
// Protection: a $500 daily profit lock blocks FTMO 2 (up $400 already; set the lock under that)
await tid('protect-open').click();
await tid('protect-lock').locator('input').fill('300'); await tid('protect-streak').locator('input').fill('3');
await tid('protect-save').click(); await p.waitForTimeout(1500);
ok(/Day \+\$400.00 of \$300 lock/.test(await tid('guard').innerText()), 'FTMO 2 shows its profit lock hit');
ok(/Rule guard: FTMO 2 would/.test(await tid('ticket-note').innerText()) || await tid('ticket-place').isDisabled(), 'ticket blocked by the lock');
await p.screenshot({ path: `${OUT}/a5d-protection.png` });
await tid('protect-open').click(); await tid('protect-lock').locator('input').fill(''); await tid('protect-save').click(); await p.waitForTimeout(1200);
// Template and auto bracket
await tid('ticket-sl').fill(String((last - 6).toFixed(2))); await tid('ticket-tp').fill(String((last + 12).toFixed(2)));
p.once('dialog', (d) => d.accept('Gold scalp'));
await tid('template-save').click(); await p.waitForTimeout(300);
await tid('ticket-sl').fill(''); await tid('ticket-tp').fill('');
await tid('template-apply').click(); await p.waitForTimeout(300);
ok((await tid('ticket-sl').inputValue()) === (last - 6).toFixed(2).replace(/\.?0+$/, '') || Number(await tid('ticket-sl').inputValue()) === Math.round((last - 6) * 100) / 100, 'template restores the stop distance');
ok((await tid('session-box').count()) > 0, 'session boxes on the chart');
// Auto bracket + hotkey: B buys at the one-click size with a 5-point stop and a 2R target
await tid('ticket-sl').fill(''); await tid('ticket-tp').fill('');
await tid('open-settings').click(); await p.waitForTimeout(300);
await tid('pref-bracket').click(); await tid('pref-hotkeys').click();
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.mouse.click(box.x + 400, box.y + 300); await p.keyboard.press('b'); await p.waitForTimeout(2000);
const hk = (await (await fetch(`${base}/api/terminal/positions`)).json()).positions.filter((x) => x.side === 'long');
ok(hk.length > 0 && hk.every((x) => Math.abs(x.sl - (x.entry - 5)) < 0.02 && Math.abs(x.tp - (x.entry + 10)) < 0.02), `hotkey B bought with the auto bracket: ${hk.map((x) => `${x.entry}/${x.sl}/${x.tp}`).join(', ')}`);
await tid('open-settings').click(); await p.waitForTimeout(300); await tid('pref-hotkeys').click(); await tid('pref-bracket').click(); await p.keyboard.press('Escape');
// Flatten all
await tid('flatten-all').click(); await p.waitForTimeout(2500);
const after = await (await fetch(`${base}/api/terminal/positions`)).json();
ok(after.positions.length === 0 && after.pending.length === 0, 'flatten all closed everything');
await p.screenshot({ path: `${OUT}/a6-flatten.png` });
// MT5 fast lane: a fake Copier EA streams ticks; the badge goes live and an order shows the app's time
{
  const net = await import('node:net');
  await inv('TradingAccount', 'update', (await inv('TradingAccount', 'filter', { label: 'FTMO 1' }))[0].id, { mt5_on: true });
  const acc = (await inv('TradingAccount', 'filter', { label: 'FTMO 1' }))[0];
  const ea = net.connect(app.lane.port(), '127.0.0.1'); ea.setEncoding('utf8');
  let buf = ''; ea.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.startsWith('O|')) ea.write(`A|${l.split('|')[1]}|1|777|${last}|\n`); } });
  ea.write(`H|${app.signals.key()}|${acc.id}\n`);
  const ticker = setInterval(() => ea.write(`T|XAUUSD.r|${(last + 0.4).toFixed(2)}|${(last + 0.7).toFixed(2)}|${Date.now()}\n`), 200);
  await p.waitForTimeout(1500);
  ok(/MT5 live/.test(await tid('latency').innerText()), `badge live: ${await tid('latency').innerText()}`);
  await tid('ticket-sl').fill(String((last - 20).toFixed(2)));
  await tid('oneclick-buy').click(); await p.waitForTimeout(1500);
  ok(/Checked and sent to MT5 in \d/.test(await tid('toasts').innerText()), 'toast shows the app time');
  ok(/app \d+\.\d+ ms/.test(await tid('latency').innerText()) && /fill \d/.test(await tid('latency').innerText()), `badge times: ${await tid('latency').innerText()}`);
  await p.screenshot({ path: `${OUT}/a6b-mt5-live.png` });
  clearInterval(ticker); ea.destroy();
  await tid('flatten-all').click(); await p.waitForTimeout(1500);
}
// Replay
await tid('open-replay').click(); await p.waitForTimeout(5000);
await tid('sizing-lots').click(); await tid('ticket-sl').fill(''); 
await tid('ticket-place').click();
for (let i = 0; i < 12; i++) await tid('replay-step').click();
await p.waitForTimeout(500);
const rb = await tid('replay-bar').innerText();
const want = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
ok(/Practice P&L/.test(rb) && rb.includes(want), `replay starts on ${want}: ${rb.split('\n').join(' | ')}`);
await p.screenshot({ path: `${OUT}/a7-replay.png` });
// Simulate a prop account in replay: FTMO $10K, judged live
await tid('sim-account-toggle').click();
await tid('sim-account-picker').locator('[data-firm="FTMO"]').click(); await p.waitForTimeout(400);
const sa = await tid('sim-account').innerText();
ok(/Floor \$9,000/.test(sa) && /daily loss left \$500/i.test(sa) && /To target \$1,000/.test(sa), `sim account: ${sa.replace(/\n/g, ' | ')}`);
await tid('ticket-place').click();
for (let i = 0; i < 6; i++) await tid('replay-step').click();
await p.waitForTimeout(400);
ok(/active|failed|passed/i.test(await tid('sim-status').innerText()), `sim status: ${await tid('sim-status').innerText()}`);
// Close all: every open practice trade closes at once
await tid('ticket-place').click(); await p.waitForTimeout(300);
const openBefore = await tid('replay-close-all').innerText();
await tid('replay-close-all').click(); await p.waitForTimeout(400);
ok(/Close all \(\d+\)/.test(openBefore) && (await tid('replay-close-all').isDisabled()), `close all: ${openBefore} -> none open`);
await p.screenshot({ path: `${OUT}/a7b-sim-account.png` });
// Overview
await p.goto(`${base}/overview`); await p.waitForTimeout(1500);
ok((await tid('overview-row').count()) === 2, 'overview lists both accounts');
await p.screenshot({ path: `${OUT}/a9-overview.png`, fullPage: true });
// Journal
await p.goto(`${base}/journal`); await p.waitForTimeout(2500);
ok((await tid('journal-row').count()) >= 4, `journal rows: ${await tid('journal-row').count()}`);
fs.writeFileSync(`${OUT}/hist.tsv`, 'Time\tPosition\tSymbol\tType\tVolume\tPrice\tS / L\tT / P\tTime\tPrice\tCommission\tSwap\tProfit\n2026.10.14 09:30:05\t5501\tXAUUSD\tbuy\t0.50\t4715.20\t4705\t4740\t2026.10.14 11:02:44\t4731.00\t-3.50\t0\t790.00\n');
await tid('journal-file').setInputFiles(`${OUT}/hist.tsv`); await p.waitForTimeout(1500);
ok(/1 trade imported/.test(await tid('journal-msg').innerText()), 'history imported');
await tid('journal-setup').first().selectOption('Breakout'); await p.waitForTimeout(600);
ok(/Weekly report/.test(await tid('week-report').innerText()) && /Model scorecard/.test(await tid('scorecard').innerText()), 'weekly report and scorecard on the journal');
await p.screenshot({ path: `${OUT}/a8-journal.png`, fullPage: true });
fs.rmSync(`${OUT}/hist.tsv`);
console.log('errors:', errs.filter((e) => !/favicon|404/.test(e)).slice(0, 8));
await b.close(); await app.close(); process.exit();
