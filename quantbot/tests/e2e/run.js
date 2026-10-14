// End-to-end run: starts QuantBot with fake Claude, Ollama and Dukascopy servers, then clicks through every feature
// in a real Chromium window and takes screenshots into test-results/e2e/.
//   npm run test:e2e              (CHROME_PATH=... to use an installed Chrome / Edge)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startFakeDukascopy } from '../support/fakeDukascopy.js';
import { startFakeModels } from '../support/fakeModels.js';

const OUT = path.resolve('test-results/e2e');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const duka = await startFakeDukascopy();
const models = await startFakeModels();
process.env.QUANTBOT_DUKASCOPY_URL = duka.url;
process.env.QUANTBOT_ANTHROPIC_URL = models.url;
const { startServer } = await import('../../server/index.js');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-e2e-'));
let app = await startServer({ port: 0, dataDir, userName: 'Tim', quiet: true });
const base = () => `http://localhost:${app.port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on('dialog', (d) => d.accept());

const results = [];
let shot = 0;
const snap = (name) => page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`) });
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split('\n')[0] });
    console.log(`  ✗ ${name}\n      ${e.message.split('\n').slice(0, 4).join('\n      ')}`);
    await snap(`FAILED-${name.replace(/\W+/g, '-')}`).catch(() => {});
    // Close anything left open so one failure doesn't block the next steps
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const text = (t, opts) => page.getByText(t, opts);
const sidebarLink = (name) => page.locator('aside').getByRole('link', { name });
const pick = async (combo, option) => { await combo.click(); await page.getByRole('option', { name: option, exact: true }).click(); };
// Where a centered dialog grows from, in page coordinates ("calc(50% ± Xpx) calc(50% ± Ypx)")
function centeredPoint(origin) {
  const m = [...origin.matchAll(/calc\(50% ([+-]) ([\d.]+)px\)/g)].map(([, sign, v]) => (sign === '-' ? -1 : 1) * parseFloat(v));
  if (m.length !== 2) throw new Error(`not a click origin: ${origin}`);
  const { width, height } = page.viewportSize();
  return { x: width / 2 + m[0], y: height / 2 + m[1] };
}
const near = (p, box) => Math.abs(p.x - (box.x + box.width / 2)) < 20 && Math.abs(p.y - (box.y + box.height / 2)) < 20;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
// The arrow back to the chat (Settings has a text link instead of a header)
const back = () => page.getByRole('link', { name: 'Back to chat' }).or(page.locator('header a').first()).first().click();

// A TradingView-style CSV for the "your own file" path: 60 days of H1 bars
function writeCsv() {
  const file = path.join(dataDir, 'GER40_H1.csv');
  const rows = ['time,open,high,low,close,Volume'];
  const t0 = Date.UTC(2026, 6, 1);
  for (let k = 0; k < 60 * 24; k++) {
    const t = t0 + k * 3600000;
    const p = 18000 + 200 * Math.sin(k / 30), q = 18000 + 200 * Math.sin((k + 1) / 30);
    rows.push(`${new Date(t).toISOString()},${p.toFixed(1)},${(Math.max(p, q) + 5).toFixed(1)},${(Math.min(p, q) - 5).toFixed(1)},${q.toFixed(1)},100`);
  }
  fs.writeFileSync(file, rows.join('\n'));
  return file;
}

console.log(`QuantBot e2e on ${base()} (data in ${dataDir})`);

await step('App launches on the chat page', async () => {
  await page.goto(base());
  await text(/Good (morning|afternoon|evening), Tim/).waitFor();
  await page.getByPlaceholder('Reply to QuantBot...').waitFor();
  expect(await sidebarLink('Strategy Tester').isVisible(), 'sidebar links missing');
  await snap('home');
});

await step('Chat without a key explains what to do', async () => {
  await page.getByPlaceholder('Reply to QuantBot...').fill('hello');
  await page.getByPlaceholder('Reply to QuantBot...').press('Enter');
  await text('Message failed').first().waitFor();
  await text(/Add a Claude or Gemini API key/).first().waitFor();
  await snap('no-key-toast');
});

await step('Settings: page grows from the clicked settings button', async () => {
  const btn = page.getByTitle('Settings');
  const box = await btn.boundingBox();
  await btn.click();
  // The chat page shrinks away first (300 ms), then Settings grows out of the clicked button
  await page.waitForTimeout(420);
  await snap('page-transition-mid');
  const origin = await page.evaluate(() => [...document.querySelectorAll('div[style]')].map((d) => d.style.transformOrigin).find((o) => o && o.endsWith('px')));
  expect(origin, 'no page origin set');
  const [x, y] = origin.split(' ').map(parseFloat);
  expect(Math.abs(x - (box.x + box.width / 2)) < 20 && Math.abs(y - (box.y + box.height / 2)) < 20, `page origin ${origin} not at the click`);
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
});

await step('Settings: Anthropic key is validated, saved encrypted, shown as last 4', async () => {
  const card = page.locator('div.bg-card', { has: page.getByRole('heading', { name: 'Anthropic (Claude)' }) });
  await card.getByPlaceholder('sk-ant-...').fill('abc');
  await card.getByRole('button', { name: 'Save key' }).click();
  await card.getByText('Anthropic keys start with "sk-ant-".').waitFor();
  await card.getByPlaceholder('sk-ant-...').fill('sk-ant-e2etest1234');
  await card.getByRole('button', { name: 'Save key' }).click();
  await card.getByText('Linked ···· 1234').waitFor();
  const keys = fs.readFileSync(path.join(dataDir, 'keys.json'), 'utf8');
  expect(!keys.includes('sk-ant-e2etest1234'), 'key stored in plain text');
});

await step('Settings: Gemini key can be added and removed', async () => {
  const card = page.locator('div.bg-card', { has: page.getByRole('heading', { name: 'Google (Gemini)' }) });
  await card.getByPlaceholder('AIza...').fill('AIzaE2E5678');
  await card.getByRole('button', { name: 'Save key' }).click();
  await card.getByText('Linked ···· 5678').waitFor();
  await card.getByRole('button', { name: 'Remove key' }).click();
  await card.getByText('Not linked').waitFor();
});

await step('Settings: default Claude model offers the 5.5 family', async () => {
  const card = page.locator('div.bg-card', { has: page.getByText('Tester & converter default model') });
  const combo = card.getByRole('combobox').first();
  expect((await combo.textContent()).includes('Claude Opus 5.5'), 'default is not Opus 5.5');
  await combo.click();
  for (const m of ['Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Haiku 5.5']) await page.getByRole('option', { name: m }).waitFor();
  await page.waitForTimeout(120);
  await snap('select-open');
  const origin = await page.locator('[role=listbox]').evaluate((el) => getComputedStyle(el).transformOrigin);
  expect(origin && origin !== '50% 50%', `select origin ${origin}`);
  await page.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
  await card.getByText('Saved').waitFor();
});

await step('Settings: local model (Ollama) connects and saves', async () => {
  const card = page.locator('div.bg-card', { has: page.getByRole('heading', { name: /Local model \(Ollama\)/ }) });
  await card.getByLabel('Ollama address').fill(models.url);
  await card.getByRole('button', { name: 'Test connection' }).click();
  await card.getByText('Connected. Installed: qwen2.5-coder:7b').waitFor();
  await card.getByRole('button', { name: 'Save' }).click();
  await card.getByText('On · qwen2.5-coder:7b').waitFor();
});

await step('Settings: built-in US100 hourly + daily history downloads with progress', async () => {
  const row = page.locator('div.py-3', { has: page.getByText('US 100 Tech Index') });
  await row.getByRole('button', { name: 'Download' }).click();
  await row.getByText(/hourly 2011 to 20\d\d/).waitFor({ timeout: 120000 });
  await row.getByText(/daily 1990 to /).waitFor();
  await snap('built-in-markets');
});

await step('Settings: own CSV upload in a dialog that grows from the click', async () => {
  const add = page.getByRole('button', { name: 'Add file' });
  await add.scrollIntoViewIfNeeded();
  const box = await add.boundingBox();
  await add.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const origin = await dialog.evaluate((el) => el.style.transformOrigin);
  expect(near(centeredPoint(origin), box), `dialog grows from ${origin}, not the Add file button`);
  await dialog.locator('input[type=file][accept]').setInputFiles(writeCsv());
  await dialog.getByText('TradingView · 1,440 bars').waitFor();
  await dialog.getByPlaceholder('Timeframe, e.g. M15').fill('H1');
  await snap('upload-dialog');
  await dialog.getByRole('button', { name: /Save 1 file/ }).click();
  await page.getByText('GER40 H1').waitFor();
});

await step('Chat: Claude writes an EA, chat is named after the script, queue works', async () => {
  await back();
  await page.getByRole('button', { name: 'New chat' }).click();
  const box = page.getByPlaceholder('Reply to QuantBot...');
  await box.fill('Write a gold breakout EA');
  await box.press('Enter');
  await box.fill('Add a trailing stop');
  await box.press('Enter');
  await text(/Queued \(1\)/).waitFor();
  await snap('chat-queue');
  await page.locator('aside').getByText('Gold Breakout', { exact: true }).waitFor();
  await text('Queued (1)').waitFor({ state: 'detached' });
  await expectCount(page.locator('pre'), 2);
  const last = models.calls.at(-1);
  expect(last.model === 'claude-sonnet-5-5', `chat used ${last.model}`);
  expect(last.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' && last.fallbacks === 'default', 'fallback not requested');
  await snap('chat-reply');
});

async function expectCount(loc, n) {
  for (let k = 0; k < 100; k++) { if ((await loc.count()) >= n) return; await page.waitForTimeout(100); }
  throw new Error(`expected ${n}, found ${await loc.count()}`);
}

await step('Chat: local model answers when picked', async () => {
  const before = models.calls.length;
  await pick(page.getByRole('combobox').filter({ hasText: 'Auto (your default model)' }), 'Local model (Ollama)');
  await page.getByPlaceholder('Reply to QuantBot...').fill('Same EA, but explain the risk settings');
  await page.getByPlaceholder('Reply to QuantBot...').press('Enter');
  await text('(local) Here is the EA.').waitFor();
  expect(models.calls.slice(before).some((c) => c.kind === 'ollama' && c.model === 'qwen2.5-coder:7b'), 'Ollama not called');
  await pick(page.getByRole('combobox').filter({ hasText: 'Local model (Ollama)' }), 'Auto (your default model)');
});

await step('Chat: rename, move to Pine, filter by project, export .md', async () => {
  const item = page.locator('aside .group', { hasText: 'Gold Breakout' });
  await item.hover();
  await item.getByLabel('Chat settings').click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.locator('aside input').fill('Gold Breakout v2');
  await page.locator('aside input').press('Enter');
  await page.locator('aside').getByText('Gold Breakout v2').waitFor();
  await item.hover();
  await item.getByLabel('Chat settings').click();
  await page.waitForTimeout(120);
  await snap('dropdown-open');
  await page.getByRole('menuitem', { name: 'Move to Pine' }).click();
  await page.locator('aside').getByRole('button', { name: 'MT5', exact: true }).click();
  await page.locator('aside').getByText('hello', { exact: true }).waitFor();
  await page.locator('aside').getByText('Gold Breakout v2').waitFor({ state: 'detached' });
  await page.locator('aside').getByRole('button', { name: 'Pine', exact: true }).click();
  await page.locator('aside').getByText('Gold Breakout v2').waitFor();
  await page.locator('aside').getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('aside').getByText('Gold Breakout v2').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export .md/ }).click()]);
  expect(download.suggestedFilename() === 'Gold Breakout v2.md', download.suggestedFilename());
  const md = fs.readFileSync(await download.path(), 'utf8');
  expect(md.includes('// Script: Gold Breakout'), 'export missing the script');
});

await step('Chat: delete confirmation grows from the trash icon, then deletes', async () => {
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByPlaceholder('Reply to QuantBot...').fill('temporary question');
  await page.getByPlaceholder('Reply to QuantBot...').press('Enter');
  // The reply carries a script, so the chat is renamed after it ("Gold Breakout")
  await expectCount(page.locator('pre'), 1);
  const item = page.locator('aside .group').filter({ has: page.getByText('Gold Breakout', { exact: true }) });
  await item.waitFor();
  await item.hover();
  const trash = item.getByLabel('Delete chat');
  const box = await trash.boundingBox();
  await trash.click();
  const dlg = page.getByRole('alertdialog');
  await dlg.waitFor();
  const origin = await dlg.evaluate((el) => el.style.transformOrigin);
  expect(near(centeredPoint(origin), box), `confirmation grows from ${origin}, not the trash icon`);
  await page.waitForTimeout(100);
  await snap('delete-confirm');
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await item.waitFor({ state: 'detached' });
});

await step('Strategy Tester: 3 markets (XAUUSD, US100, own file) on M15 / last 120 days', async () => {
  await sidebarLink('Strategy Tester').click();
  await page.getByRole('heading', { name: 'Strategy Tester' }).waitFor();
  const chat = page.getByRole('combobox').first();
  await chat.filter({ hasText: /Gold Breakout|hello/ }).waitFor();
  await pick(chat, 'Gold Breakout v2');
  await page.getByRole('button', { name: /Markets: XAUUSD, US100, NQ/ }).click();
  await page.getByRole('dialog').getByText('GER40 H1').click();
  await page.keyboard.press('Escape');
  await page.getByLabel('From date').fill(daysAgo(120));
  await page.getByRole('button', { name: 'Run test' }).click();
  await text(/downloading M15 history|Reading the script|Simulating/).first().waitFor();
  await snap('tester-progress');
  for (const h of ['XAUUSD M15', 'US100 M15', 'NQ M15', 'GER40 H1']) await page.getByRole('heading', { name: h }).waitFor({ timeout: 180000 });
  const board = page.getByRole('region', { name: /Leaderboard: every market in this test/ });
  await board.waitFor();
  expect((await board.locator('tbody tr').count()) === 4, 'leaderboard should rank all 4 markets');
  await page.getByRole('tab', { name: /Trades \(/ }).first().click();
  await page.getByRole('tab', { name: 'Signals' }).first().click();
  await text('Signal test: BUY').first().waitFor();
  await page.getByRole('tab', { name: /Log \(/ }).first().click();
  await text(/Backtest: \d+ trades/).first().waitFor();
  await page.getByRole('tab', { name: 'Script' }).first().click();
  await text('// Script: Gold Breakout').first().waitFor();
  await page.getByRole('tab', { name: 'Equity' }).first().click();
  await page.getByRole('button', { name: 'Replay Equity & balance' }).first().click();
  await page.waitForTimeout(400);
  await snap('chart-replay-mid');
  await snap('tester-results');
});

await step('Strategy Tester: 20+ years of XAUUSD on H4', async () => {
  await page.getByRole('button', { name: /Markets: XAUUSD, US100, NQ, GER40/ }).click();
  await page.getByRole('dialog').getByText('US100', { exact: true }).click();
  await page.getByRole('dialog').getByText('NQ', { exact: true }).click();
  await page.getByRole('dialog').getByText('GER40 H1').click();
  await page.keyboard.press('Escape');
  await pick(page.getByLabel('Timeframe'), 'H4');
  await page.getByLabel('From date').fill('2004-01-01');
  await page.getByRole('button', { name: 'Run test' }).click();
  await page.getByRole('heading', { name: 'XAUUSD H4' }).waitFor({ timeout: 300000 });
  // The first 300 bars warm the indicators up, so trading starts a few weeks into 2004
  await text(/XAUUSD H4 · 2004-\d\d-\d\d to 20\d\d-\d\d-\d\d/).first().waitFor();
  await snap('tester-20-years');
});

await step('Strategy Tester: M1 over a year is refused with a clear message', async () => {
  await pick(page.getByLabel('Timeframe'), 'M1');
  await page.getByLabel('From date').fill(daysAgo(500));
  await page.getByRole('button', { name: 'Run test' }).click();
  await text(/M1 tests can cover at most 370 days/).waitFor();
});

await step('Strategy Converter: converts, tests on unseen M15 week, all report tabs', async () => {
  await page.goto(`${base()}/strategy-converter`);
  await page.getByPlaceholder('e.g. Gold EMA Scalper').fill('E2E Bot');
  await page.getByRole('button', { name: 'Markets: XAUUSD, US100, NQ' }).waitFor();
  await page.getByPlaceholder(/Paste your strategy here/).fill('Buy breakouts of the Asian range on gold with a 1.5 ATR stop.');
  await page.getByPlaceholder(/One rule per line/).fill('Max risk 1% per trade\nEvery trade has a stop loss');
  const callsBefore = models.calls.length;
  await page.getByRole('button', { name: 'Convert & test' }).click();
  // One conversion, tested on all three markets, ranked in the leaderboard
  const board = page.getByRole('region', { name: /Leaderboard: every market and version/ });
  await board.locator('tbody tr').nth(2).waitFor({ timeout: 180000 });
  for (const m of ['XAUUSD M15', 'US100 M15', 'NQ M15']) await board.getByText(m).waitFor();
  expect(models.calls.length - callsBefore === 1, `${models.calls.length - callsBefore} AI calls for one conversion`);
  await snap('converter-leaderboard');
  await board.getByText('XAUUSD M15').click();
  await text(/^v1 · 1 week unseen/).waitFor();
  for (const tab of ['Liquidity', /Monte Carlo/, 'Lucid Pro', /Trades \(/, /Log \(/, 'Code', 'Overview']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(150);
  }
  await text('Rule test').first().waitFor();
  await snap('converter-v1');
});

await step('Strategy Converter: fix & retest uses a different unseen week', async () => {
  const v1 = await text(/^v1 · 1 week unseen/).textContent();
  await page.getByRole('button', { name: 'Fix & retest' }).click();
  await text(/^v4 · 1 week unseen/).waitFor({ timeout: 180000 });
  const v2 = await text(/^v4 · 1 week unseen/).textContent();
  expect(v1.replace('v1', '') !== v2.replace('v4', ''), 'the fix reused the v1 window');
});

await step('Strategy Converter: custom range back in 2008', async () => {
  await pick(page.getByRole('combobox').filter({ hasText: '1 week unseen' }), 'Custom range');
  await page.getByLabel('From date').fill('2008-01-01');
  await page.getByLabel('To date').fill('2008-03-31');
  // US100 / NQ minute data starts in 2011, so only gold can run 2008
  await page.getByRole('button', { name: /Markets: / }).click();
  await page.getByRole('dialog').getByText('US100', { exact: true }).click();
  await page.getByRole('dialog').getByText('NQ', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Convert & test' }).click();
  await text(/^v5 · Custom range: 2008-01-0\d to 2008-03-31/).waitFor({ timeout: 180000 });
  await snap('converter-2008');
});

// Value of a metric tile ("Net P&L", "Trades") in the first report on the page
// (numbers count up for 0.6 s when a report opens, so wait for them to settle)
const metric = async (label) => {
  await page.waitForTimeout(800);
  return page.locator('div.bg-card', { has: page.getByText(label, { exact: true }) }).first().locator('div').nth(1).textContent();
};

await step('Same script, same week: Strategy Tester and Converter agree exactly', async () => {
  const week = { from: '2024-03-04', to: '2024-03-08' };
  await page.goto(`${base()}/strategy-tester`);
  await pick(page.getByRole('combobox').first(), 'Gold Breakout v2');
  await page.getByRole('button', { name: /Markets: / }).click();
  for (const d of ['US100', 'NQ', 'GER40 H1']) {
    const box = page.getByRole('dialog').locator('label', { hasText: d }).getByRole('checkbox');
    if ((await box.getAttribute('data-state')) === 'checked') await box.click();
  }
  await page.keyboard.press('Escape');
  await page.getByLabel('From date').fill(week.from);
  await page.getByLabel('To date').fill(week.to);
  await page.getByRole('button', { name: 'Run test' }).click();
  await page.getByRole('heading', { name: 'XAUUSD M15' }).waitFor({ timeout: 120000 });
  await text(/XAUUSD M15 · 2024-03-04 to 2024-03-08/).waitFor();
  const tester = { net: await metric('Net P&L'), trades: await metric('Trades') };

  await page.goto(`${base()}/strategy-converter`);
  await page.getByPlaceholder('e.g. Gold EMA Scalper').fill('Same Week Bot');
  await page.getByRole('button', { name: /Markets: / }).click();
  await page.getByRole('dialog').getByText('US100', { exact: true }).click();
  await page.getByRole('dialog').getByText('NQ', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByPlaceholder(/Paste your strategy here/).fill('Same strategy as the tester run.');
  await pick(page.getByRole('combobox').filter({ hasText: '1 week unseen' }), 'Custom range');
  await page.getByLabel('From date').fill(week.from);
  await page.getByLabel('To date').fill(week.to);
  await page.getByRole('button', { name: 'Convert & test' }).click();
  await text(/^v1 · Custom range: 2024-03-04 to 2024-03-08/).waitFor({ timeout: 120000 });
  const converter = { net: await metric('Net P&L'), trades: await metric('Trades') };
  console.log(`      Tester ${tester.trades} trades, net ${tester.net} | Converter ${converter.trades} trades, net ${converter.net}`);
  expect(tester.net === converter.net && tester.trades === converter.trades, `tester ${JSON.stringify(tester)} vs converter ${JSON.stringify(converter)}`);
  expect(Number(tester.trades) > 0, 'no trades in the week');
  await snap('same-week-converter');
});

await step('Test history: search, open a bot, switch versions and tabs', async () => {
  await page.goto(`${base()}/test-history`);
  await page.getByRole('button', { name: /Gold Breakout v2/ }).first().waitFor();
  await page.getByPlaceholder('Search bots').fill('E2E');
  // Each Convert & test starts a session per market and fixes add versions to it
  await page.getByRole('button', { name: /E2E Bot.*2 versions/ }).click();
  await page.getByRole('heading', { name: 'E2E Bot' }).waitFor();
  await page.getByRole('button', { name: /^v1/ }).click();
  await text(/^v1 · 1 week unseen/).waitFor();
  await page.getByRole('region', { name: /Leaderboard: every version/ }).locator('tbody tr').nth(1).waitFor();
  await page.getByRole('tab', { name: /Trades/ }).click();
  await snap('history');
});

await step('PnL calendar: days, weeks, months, bot filter, day drill-down', async () => {
  await page.goto(`${base()}/pnl`);
  await page.getByRole('button', { name: 'Days' }).waitFor();
  await pick(page.getByRole('combobox'), 'E2E Bot');
  const cell = page.locator('button:not([disabled])', { hasText: /trades?$/ }).first();
  await cell.waitFor();
  await cell.click();
  await text(/Trades closed /).waitFor();
  await page.getByRole('button', { name: 'Weeks' }).click();
  await page.getByRole('button', { name: 'Months' }).click();
  await page.getByLabel('Previous').click();
  await page.getByLabel('Next').click();
  await snap('pnl');
});

await step('Accounts: MT5 + Tradovate accounts, copy group rename / pause / delete, remove', async () => {
  await page.goto(`${base()}/accounts`);
  await text(/copy-trading engine .* isn't part of this app yet/).waitFor();
  const mt5 = page.locator('section', { hasText: 'MetaTrader 5' });
  await mt5.getByRole('button', { name: 'Add account' }).click();
  await page.getByPlaceholder('e.g. FTMO 100K').fill('FTMO 100K');
  await page.getByPlaceholder('12345678').fill('5100123');
  await page.getByPlaceholder('e.g. FTMO-Demo').fill('FTMO-Demo');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await mt5.getByText('FTMO 100K').waitFor();
  const tv = page.locator('section', { hasText: 'TradingView · Tradovate' });
  await tv.getByRole('button', { name: 'Add account' }).click();
  await page.getByPlaceholder('e.g. Lucid 50K #1').fill('Lucid 50K #1');
  await page.getByRole('dialog').locator('input').nth(1).fill('tim_lucid');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await tv.getByText('Lucid 50K #1').waitFor();
  await mt5.getByRole('button', { name: 'New group' }).click();
  await page.getByPlaceholder('e.g. Lucid 50K accounts').fill('Group A');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await mt5.getByRole('button', { name: /Group A/ }).waitFor();
  await mt5.locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await page.getByPlaceholder('e.g. Lucid 50K accounts').fill('Group B');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await mt5.getByRole('button', { name: /Group B/ }).waitFor();
  await mt5.locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'Pause copying' }).click();
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await mt5.locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'Resume copying' }).waitFor();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  await mt5.getByRole('button', { name: /Group B/ }).waitFor({ state: 'detached' });
  await snap('accounts');
  await mt5.getByRole('button', { name: 'Not copying 1' }).click();
  await mt5.locator('.rounded-xl', { hasText: 'FTMO 100K' }).getByRole('button').last().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await mt5.getByText('FTMO 100K').waitFor({ state: 'detached' });
});

await step('Unknown page shows 404', async () => {
  await page.goto(`${base()}/nope`);
  await text('Page Not Found').waitFor();
});

await step('Phone layout: sidebar grows from the menu tap and shrinks back', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base());
  await page.waitForTimeout(500); // let the page finish growing in before measuring the button
  const aside = page.locator('aside');
  expect((await aside.evaluate((el) => getComputedStyle(el).opacity)) === '0', 'sidebar visible before tap');
  const menu = page.locator('header button').first();
  const box = await menu.boundingBox();
  await menu.click();
  await page.waitForTimeout(650);
  const style = await aside.evaluate((el) => ({ origin: el.style.transformOrigin, opacity: getComputedStyle(el).opacity }));
  expect(style.opacity === '1', 'sidebar did not open');
  const [x] = style.origin.split(' ').map(parseFloat);
  expect(Math.abs(x - (box.x + box.width / 2)) < 20, `sidebar origin ${style.origin}`);
  await snap('mobile-sidebar');
  await page.mouse.click(370, 400);
  await page.waitForTimeout(650); // the 400 ms close animation, plus a margin
  expect((await aside.evaluate((el) => getComputedStyle(el).opacity)) === '0', 'sidebar did not close');
  await page.setViewportSize({ width: 1360, height: 900 });
});

await step('Everything is still there after restarting QuantBot', async () => {
  await app.close();
  app = await startServer({ port: 0, dataDir, userName: 'Tim', quiet: true });
  await page.goto(base());
  await page.locator('aside').getByText('Gold Breakout v2').waitFor();
  await page.goto(`${base()}/settings`);
  await text('Linked ···· 1234').waitFor();
  await text('GER40 H1').waitFor();
});

await step('No JavaScript errors in the page', async () => {
  expect(!pageErrors.length, `page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
  expect(!consoleErrors.length, `console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
});

await browser.close();
await app.close();
await duka.close();
await models.close();

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} steps passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
