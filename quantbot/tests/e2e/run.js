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
    console.log(`  ✗ ${name}\n      ${e.message.split('\n').slice(0, process.env.E2E_LOG_LINES ? Number(process.env.E2E_LOG_LINES) : 4).join('\n      ')}`);
    await snap(`FAILED-${name.replace(/\W+/g, '-')}`).catch(() => {});
    // Close anything left open so one failure doesn't block the next steps
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const text = (t, opts) => page.getByText(t, opts);
const sidebarLink = (name) => page.locator('aside').getByRole('link', { name });
// A fact in a MetaRow ("Version", "Tested on", "Dates"...)
const meta = (label, value) => page.locator(`[data-meta="${label}"]`).filter({ hasText: value });
// The "Tested on" fact of a report version ("v1")
const testedOn = (version) => page.locator('dl', { has: page.locator('[data-meta="Version"]', { hasText: new RegExp(`^${version}$`) }) }).locator('[data-meta="Tested on"]');
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

await step('Settings: page grows from the middle of the window', async () => {
  const btn = page.getByTitle('Settings');
  await btn.click();
  // The chat page shrinks away first, then Settings grows out of the middle of the window
  await page.waitForTimeout(420);
  await snap('page-transition-mid');
  const origin = await page.evaluate(() => [...document.querySelectorAll('div[style]')].map((d) => d.style.transformOrigin).find((o) => o && o.endsWith('px')));
  expect(origin, 'no page origin set');
  const [x, y] = origin.split(' ').map(parseFloat);
  const mid = await page.evaluate(() => [window.innerWidth / 2, window.innerHeight / 2]);
  expect(Math.abs(x - mid[0]) < 2 && Math.abs(y - mid[1]) < 2, `page origin ${origin} is not the middle of the window`);
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
  await card.getByText('Using qwen2.5-coder:7b').waitFor();
});

await step('Settings: built-in US100 hourly + daily history downloads with progress', async () => {
  const row = page.locator('div.py-3', { has: page.getByText('US 100 Tech Index') });
  await row.getByRole('button', { name: 'Download' }).click();
  await row.getByText(/hourly 2011 to 20\d\d/).waitFor({ timeout: 120000 });
  await row.getByText(/daily 1990 to /).waitFor();
  await snap('built-in-markets');
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

await step('Chat: code over 25 lines collapses and expands with a button', async () => {
  await page.getByPlaceholder('Reply to QuantBot...').fill('Send the long EA');
  await page.keyboard.press('Enter');
  const block = page.locator('[data-code-block]').last();
  await block.getByRole('button', { name: 'Show all 60 lines' }).waitFor({ timeout: 30000 });
  const shownText = () => block.locator('pre').textContent();
  const collapsed = await shownText();
  expect(collapsed.split('\n').length === 25 && collapsed.includes('// filler line 18') && !collapsed.includes('// filler line 19'), 'collapsed block should show exactly the first 25 lines');
  await block.getByRole('button', { name: 'Show all 60 lines' }).click();
  expect((await shownText()).includes('// filler line 53'), 'expanded block is missing the last line');
  await block.getByRole('button', { name: 'Collapse' }).click();
  await block.getByRole('button', { name: 'Show all 60 lines' }).waitFor();
});

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

await step('Strategy Tester: 3 built-in markets (XAUUSD, US100, NQ) on M15 / last 120 days', async () => {
  await sidebarLink('Strategy Tester').click();
  await page.getByRole('heading', { name: 'Strategy Tester' }).waitFor();
  const chat = page.getByRole('combobox').first();
  await chat.filter({ hasText: /Gold Breakout|hello/ }).waitFor();
  await pick(chat, 'Gold Breakout v2');
  // Only the built-in markets are offered (no uploaded files)
  await page.getByRole('button', { name: /Markets: XAUUSD, US100, NQ$/ }).click();
  expect((await page.getByRole('dialog').getByRole('checkbox').count()) === 3, 'market list should hold exactly XAUUSD, US100 and NQ');
  await page.keyboard.press('Escape');
  await page.getByLabel('From date').fill(daysAgo(120));
  await page.getByRole('button', { name: 'Run test' }).click();
  await text(/downloading M15 history|reading the script|simulating/i).first().waitFor();
  await snap('tester-progress');
  for (const h of ['XAUUSD M15', 'US100 M15', 'NQ M15']) await page.getByRole('heading', { name: h }).waitFor({ timeout: 180000 });
  const board = page.getByRole('region', { name: /Leaderboard: every market in this test/ });
  await board.waitFor();
  expect((await board.locator('tbody tr').count()) === 3, 'leaderboard should rank all 3 markets');
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
  await page.getByRole('button', { name: /Markets: XAUUSD, US100, NQ/ }).click();
  await page.getByRole('dialog').getByText('US100', { exact: true }).click();
  await page.getByRole('dialog').getByText('NQ', { exact: true }).click();
  await page.keyboard.press('Escape');
  await pick(page.getByLabel('Timeframe'), 'H4');
  await page.getByLabel('From date').fill('2004-01-01');
  await page.getByRole('button', { name: 'Run test' }).click();
  await page.getByRole('heading', { name: 'XAUUSD H4' }).waitFor({ timeout: 300000 });
  // The first 300 bars warm the indicators up, so trading starts a few weeks into 2004
  await meta('Market', 'XAUUSD H4').first().waitFor();
  await meta('Dates', /^2004-\d\d-\d\d to 20\d\d-\d\d-\d\d$/).first().waitFor();
  await snap('tester-20-years');
});

await step('Strategy Tester: M1 over a year is refused with a clear message', async () => {
  await pick(page.getByLabel('Timeframe'), 'M1');
  await page.getByLabel('From date').fill(daysAgo(500));
  await page.getByRole('button', { name: 'Run test' }).click();
  await text(/M1 tests can cover at most 370 days/).waitFor();
});

await step('Strategy Tester: a script whose test code is too slow is rewritten for speed; Stop stops at once', async () => {
  // A chat whose script the fake model first translates into code that rescans the whole chart every bar
  await back();
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByPlaceholder('Reply to QuantBot...').fill('write my slow ict strategy');
  await page.getByPlaceholder('Reply to QuantBot...').press('Enter');
  await page.locator('aside').getByText('Slow ICT', { exact: true }).waitFor();
  await sidebarLink('Strategy Tester').click();
  await page.getByRole('heading', { name: 'Strategy Tester' }).waitFor();
  await pick(page.getByRole('combobox').first(), 'Slow ICT');
  await pick(page.getByLabel('Timeframe'), 'M15');
  await page.getByLabel('From date').fill(daysAgo(120));
  await page.getByRole('button', { name: 'Run test' }).click();
  await text(/simulating trades\.\.\. \d+% of/).first().waitFor();
  await page.getByRole('heading', { name: 'XAUUSD M15' }).waitFor({ timeout: 120000 });
  await page.getByRole('tab', { name: /Log \(/ }).first().click();
  await text(/Simulation was too slow: \d+% of [\d,]+ bars|Simulation stopped: one bar took more than/).first().waitFor();
  await text(/Rewrote the test code for speed/).first().waitFor();
  expect(!(await page.getByTestId('tester-error').count()), 'the rewrite should leave no error');
  // Stop during the slow simulation ends the run straight away, with no error
  await page.getByRole('button', { name: 'Run test' }).click();
  await text(/simulating trades\.\.\. \d+% of/).first().waitFor();
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Run test' }).waitFor({ timeout: 2000 });
  expect(Date.now() - t0 < 2000, 'Stop took too long');
  expect(!(await page.getByTestId('tester-error').count()), 'Stop should not show an error');
});

await step('Strategy Tester: test code that takes no trades is checked once, with condition counts in the log', async () => {
  await back();
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByPlaceholder('Reply to QuantBot...').fill('write my quiet ict strategy');
  await page.getByPlaceholder('Reply to QuantBot...').press('Enter');
  await page.locator('aside').getByText('Quiet ICT', { exact: true }).waitFor();
  await sidebarLink('Strategy Tester').click();
  await page.getByRole('heading', { name: 'Strategy Tester' }).waitFor();
  await pick(page.getByRole('combobox').first(), 'Quiet ICT');
  await pick(page.getByLabel('Timeframe'), 'M15');
  await page.getByLabel('From date').fill(daysAgo(120));
  const before = models.calls.length;
  await page.getByRole('button', { name: 'Run test' }).click();
  await page.getByRole('heading', { name: 'XAUUSD M15' }).waitFor({ timeout: 120000 });
  await page.getByRole('tab', { name: /Log \(/ }).first().click();
  await text(/Condition counts over [\d,]+ bars: in session [\d,]+/).first().waitFor();
  await text(/took no trades, so it was sent back to be checked/).first().waitFor();
  await text(/Backtest: [1-9]\d* trades/).first().waitFor();
  const testerCalls = models.calls.slice(before).filter((c) => c.system?.startsWith("You are QuantBot's strategy tester"));
  expect(testerCalls.length === 2, `${testerCalls.length} tester calls: one translation and one check`);
  await page.getByRole('tab', { name: 'Script' }).first().click();
  await text('Test code the simulator ran').first().waitFor();
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
  await testedOn('v1').filter({ hasText: /^1 week unseen/ }).waitFor();
  for (const tab of ['Liquidity', /Monte Carlo/, 'Lucid Pro', /Trades \(/, /Log \(/, 'Code', 'Overview']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(150);
  }
  await text('Rule test').first().waitFor();
  await snap('converter-v1');
});

await step('Strategy Converter: fix & retest uses a different unseen week', async () => {
  const v1 = await testedOn('v1').textContent();
  await page.getByRole('button', { name: 'Fix & retest' }).click();
  await testedOn('v4').filter({ hasText: /^1 week unseen/ }).waitFor({ timeout: 180000 });
  const v2 = await testedOn('v4').textContent();
  expect(v1 !== v2, 'the fix reused the v1 window');
});

await step('Converter opens a chat to fine-tune; the AI reads the tests and market data', async () => {
  // In a second window, so the Converter keeps its state for the next steps
  const href = await page.getByRole('link', { name: 'Fine-tune in chat' }).getAttribute('href');
  const chatPage = await context.newPage();
  try {
    await chatPage.goto(`${base()}${href}`);
    await chatPage.locator('header').getByText('E2E Bot', { exact: true }).waitFor();
    await chatPage.getByText(/Converted E2E Bot to MT5 and tested it on XAUUSD, US100, NQ/).waitFor();
    await chatPage.getByText(/Fixed and retested: E2E Bot v4/).waitFor();
    const before = models.calls.length;
    await chatPage.getByPlaceholder('Reply to QuantBot...').fill('Check my tests and the gold volatility');
    await chatPage.keyboard.press('Enter');
    await chatPage.getByText(/I read 4 tests of E2E Bot \(best net -?\d+\.\d\d\)\. XAUUSD M15 median ATR\(14\) that week: \d/).waitFor({ timeout: 60000 });
    const chat = models.calls.slice(before);
    expect(chat.length === 2, `${chat.length} model calls for one tool round`);
    expect(chat[0].tools.includes('get_bars') && chat[0].tools.includes('get_trades'), `tools offered: ${chat[0].tools}`);
    expect(chat[0].system.includes('LINKED BOT: "E2E Bot"') && /get_test_run/.test(chat[0].system), 'system prompt lacks the linked bot or the tool guide');
    await chatPage.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-fine-tune-chat.png`) });
  } finally {
    await chatPage.close();
  }
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
  await testedOn('v5').filter({ hasText: /^Custom range: 2008-01-0\d to 2008-03-31/ }).waitFor({ timeout: 180000 });
  await snap('converter-2008');
});

await step('Strategy Converter: Stop cancels at once', async () => {
  const pills = page.locator('button', { hasText: /^v\d+/ });
  const before = await pills.count();
  await page.getByRole('button', { name: 'Convert & test' }).click();
  await page.getByRole('button', { name: 'Stop' }).waitFor();
  await page.waitForTimeout(200);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Convert & test' }).waitFor({ timeout: 1000 });
  const ms = Date.now() - t0;
  // The cancelled run's AI answer arrives later and must not add a version or bring the progress back
  await page.waitForTimeout(2500);
  expect((await pills.count()) === before, 'a stopped run still added a version');
  expect(await page.getByRole('button', { name: 'Convert & test' }).isVisible(), 'progress came back after Stop');
  console.log(`      stopped in ${ms} ms`);
});

// Value of a metric tile ("Net P&L", "Trades") in the first report on the page
// (numbers count up for 0.6 s when a report opens, so wait for them to settle)
const metric = async (label) => {
  await page.waitForTimeout(800);
  return page.locator(`[data-metric="${label}"]`).first().textContent();
};

await step('Same script, same week: Strategy Tester and Converter agree exactly', async () => {
  const week = { from: '2024-03-04', to: '2024-03-08' };
  await page.goto(`${base()}/strategy-tester`);
  await pick(page.getByRole('combobox').first(), 'Gold Breakout v2');
  await page.getByRole('button', { name: /Markets: / }).click();
  for (const d of ['US100', 'NQ']) {
    const box = page.getByRole('dialog').locator('label', { hasText: d }).getByRole('checkbox');
    if ((await box.getAttribute('data-state')) === 'checked') await box.click();
  }
  await page.keyboard.press('Escape');
  await page.getByLabel('From date').fill(week.from);
  await page.getByLabel('To date').fill(week.to);
  await page.getByRole('button', { name: 'Run test' }).click();
  await page.getByRole('heading', { name: 'XAUUSD M15' }).waitFor({ timeout: 120000 });
  await meta('Market', 'XAUUSD M15').first().waitFor();
  await meta('Dates', '2024-03-04 to 2024-03-08').first().waitFor();
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
  await testedOn('v1').filter({ hasText: /^Custom range: 2024-03-04 to 2024-03-08/ }).waitFor({ timeout: 120000 });
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
  await testedOn('v1').filter({ hasText: /^1 week unseen/ }).waitFor();
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

await step('Signals: a script\'s buy, SL move and TP close show up live; test signal; secret key', async () => {
  await page.goto(`${base()}/`);
  await sidebarLink('Signals').click();
  await page.getByRole('heading', { name: 'Signals', exact: true }).waitFor();
  const local = page.getByLabel('MT5 / this PC', { exact: true });
  await local.filter({ hasText: /\/hook\/[0-9a-f]{32}$/ }).waitFor();
  const url = (await local.textContent()).trim().replace('127.0.0.1', new URL(base()).hostname);
  // The browser version has no public link (that's the desktop app)
  expect(!(await page.getByText('TradingView public link').count()), 'public link shown outside the desktop app');
  await page.getByRole('button', { name: 'Send test signal' }).click();
  await page.locator('tr[data-signal="buy"]').filter({ hasText: 'QuantBot test' }).waitFor();
  // What a TradingView alert sends: a buy, the stop moved to breakeven, then the take profit
  const send = (m) => fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ qb: 1, symbol: 'MNQ1!', tf: '5', strategy: 'QuantBot DOL', trade_id: 'DOL-1', source: 'tradingview', time: Date.now(), ...m }) });
  expect((await send({ event: 'buy', price: 21450.25, sl: 21430, tp: 21490.5, qty: 3 })).ok, 'buy refused');
  const pos = page.locator('[data-position="MNQ1!"]').filter({ hasText: 'QuantBot DOL' });
  await pos.filter({ hasText: 'LONG' }).filter({ hasText: '21,430' }).waitFor({ timeout: 6000 });
  await send({ event: 'set_sl', sl: 21450.25 });
  await pos.filter({ hasText: /SL21,450\.25/ }).waitFor({ timeout: 6000 });
  await snap('signals-open');
  await send({ event: 'close', price: 21490.5, reason: 'tp' });
  await pos.waitFor({ state: 'detached', timeout: 6000 });
  await page.locator('tr[data-signal="close"]').filter({ hasText: 'tp' }).waitFor();
  await page.getByRole('tab', { name: 'SL / TP moves' }).click();
  await expectCount(page.locator('tr[data-signal]'), 1);
  await page.getByRole('tab', { name: 'All' }).click();
  // A new secret key: the old address stops answering
  await page.getByRole('button', { name: 'New secret key' }).click();
  await local.filter({ hasNotText: url.split('/hook/')[1] }).waitFor();
  expect((await send({ event: 'cancel' })).status === 404, 'old key still accepted');
  await snap('signals-log');
});

await step('Accounts: platform detected from the account, TradingView by hand, filters, groups, remove', async () => {
  await page.goto(`${base()}/accounts`);
  await text(/No accounts yet/).waitFor();
  const add = async ({ name, login, server, pick }) => {
    await page.getByRole('button', { name: 'Add account' }).click();
    const d = page.getByRole('dialog');
    await d.getByPlaceholder('e.g. Lucid 50K #1').fill(name);
    await d.getByPlaceholder('e.g. LTT04821 or 5100123').fill(login);
    const hint = await d.getByTestId('platform-hint').textContent();
    if (pick) await d.getByRole('radio', { name: pick }).click();
    if (server) await d.getByPlaceholder('e.g. FTMO-Demo').fill(server);
    await d.getByRole('button', { name: 'Save' }).click();
    await d.waitFor({ state: 'detached' });
    return hint;
  };
  const h1 = await add({ name: 'FTMO 100K', login: '5100123', server: 'FTMO-Demo' });
  expect(/Detected MetaTrader 5/.test(h1), `MT5 not detected: ${h1}`);
  const h2 = await add({ name: 'Lucid 50K #1', login: 'LTT04821' });
  expect(/Detected Tradovate.*Lucid Trading/.test(h2), `Tradovate / Lucid not detected: ${h2}`);
  await add({ name: 'Lucid 50K #2', login: 'LTT04822', pick: 'TradingView' });
  const card = (n) => page.locator(`[data-account="${n}"]`);
  await card('Lucid 50K #1').getByText('Tradovate', { exact: true }).waitFor();
  await card('Lucid 50K #1').getByText(/LTT04821 on Demo, Lucid Trading/).waitFor();
  await card('Lucid 50K #2').getByText('TradingView', { exact: true }).waitFor();
  await card('FTMO 100K').getByText('MetaTrader 5', { exact: true }).waitFor();
  // Platform filter
  await page.getByRole('tab', { name: /^TradingView 1/ }).click();
  expect((await page.locator('[data-account]').count()) === 1, 'TradingView filter should show one account');
  await page.getByRole('tab', { name: /^All platforms 3/ }).click();
  expect((await page.locator('[data-account]').count()) === 3, 'All platforms should show three accounts');
  // Groups: a futures group with its Group Trade guide, rename, pause, delete
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByPlaceholder('e.g. Lucid 50K accounts').fill('Lucid group');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByTestId('group-panel').getByText(/Drag accounts onto this group/).waitFor();
  await page.getByTestId('group-panel').getByText('Switch copying on in Tradovate (Group Trade)').waitFor();
  const menu = () => page.locator('button[aria-haspopup=menu]').first().click();
  await menu();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await page.getByPlaceholder('e.g. Lucid 50K accounts').fill('Lucid copies');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: /Lucid copies/ }).waitFor();
  await menu();
  await page.getByRole('menuitem', { name: 'Pause copying' }).click();
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await menu();
  await page.getByRole('menuitem', { name: 'Resume copying' }).waitFor();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  await page.getByRole('button', { name: /Lucid copies/ }).waitFor({ state: 'detached' });
  await snap('accounts');
  // Sorting by platform puts MT5 first
  await page.getByRole('combobox', { name: 'Sort accounts' }).click();
  await page.getByRole('option', { name: 'Sort: Platform' }).click();
  expect((await page.locator('[data-account]').first().getAttribute('data-account')) === 'FTMO 100K', 'platform sort');
  await card('FTMO 100K').getByRole('button', { name: 'Edit FTMO 100K' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await card('FTMO 100K').waitFor({ state: 'detached' });
});

await step('Copy trading: add a script, drag accounts and the script onto a group, its alerts trade every account', async () => {
  await page.goto(`${base()}/accounts`);
  await page.getByRole('heading', { name: 'Copy trading' }).waitFor();
  // Dragging with the mouse the way a person does: press, move in small steps, let go
  const drag = async (from, to) => {
    const a = await from.boundingBox(), b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 5 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await page.waitForTimeout(250);
    await page.mouse.up();
    // the card settles back before the next drag can start
    await page.waitForFunction(() => !document.querySelector('[data-rfd-draggable-id][style*="position: fixed"]'));
    await page.waitForTimeout(150);
  };
  // A new account gets a random trader name, a ranked picture and Lucid 50K rules with $300 risk
  await page.getByRole('button', { name: 'Add account' }).click();
  const d = page.getByRole('dialog');
  const first = await d.getByLabel('Trader name').inputValue();
  expect(/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(first), `random name: ${first}`);
  await d.getByRole('button', { name: 'New random name' }).click();
  await d.getByPlaceholder('e.g. Lucid 50K #1').fill('Lucid 50K #3');
  await d.getByRole('radio', { name: 'TradingView' }).click();
  expect((await d.getByLabel('Risk per trade').inputValue()) === '300', 'Lucid 50K risk should default to $300');
  await d.getByRole('button', { name: 'Save' }).click();
  await d.waitFor({ state: 'detached' });
  await page.locator('[data-account="Lucid 50K #3"] [data-tier="Unranked"]').waitFor();
  // A script, with its own webhook address
  await page.getByRole('button', { name: 'Add script' }).click();
  await page.getByRole('dialog').getByPlaceholder('e.g. Gold London-NY breakout').fill('Gold Breakout');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').getByText("This script's webhook").waitFor();
  const local = (await page.getByRole('dialog').getByLabel('MT5 / this PC', { exact: true }).textContent()).trim();
  expect(/\/hook\/[0-9a-f]{32}\/s\/[A-Za-z0-9]+$/.test(local), `script webhook: ${local}`);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.locator('[data-script="Gold Breakout"]').waitFor();
  // A group; drag two accounts and the script onto it
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByPlaceholder('e.g. Lucid 50K accounts').fill('Lucid squad');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const tab = page.locator('[data-drop^="tab:"]').filter({ hasText: 'Lucid squad' }).getByRole('button').first();
  await page.getByRole('button', { name: /^All accounts/ }).click();
  await drag(page.locator('[data-account="Lucid 50K #2"]'), tab);
  await drag(page.locator('[data-account="Lucid 50K #3"]'), tab);
  await tab.click();
  await page.locator('[data-member]').nth(1).waitFor();
  await drag(page.locator('[data-script="Gold Breakout"]'), page.getByTestId('script-slot'));
  await page.getByTestId('script-slot').getByText('Gold Breakout').waitFor();
  await page.locator('[data-script="Gold Breakout"]').getByText('Trading Lucid squad').waitFor();
  // The script's alerts: a buy on micro gold sized to $300 risk (7 contracts), then a close that passes both accounts
  const send = (m) => fetch(local.replace('127.0.0.1', new URL(base()).hostname), { method: 'POST', body: JSON.stringify({ qb: 1, symbol: 'MGC1!', strategy: 'Gold Breakout', trade_id: 'G-1', ...m }) });
  expect((await send({ event: 'buy', price: 2400, sl: 2396, tp: 2450 })).status === 200, 'buy refused');
  await page.getByTestId('group-trades').getByText('1/100').waitFor();
  await page.locator('tr[data-trade="open"]').nth(1).waitFor();
  await page.locator('tr[data-trade="open"]').first().getByText('Buy 7 MGC1!').waitFor();
  expect((await send({ event: 'close', price: 2450, reason: 'tp' })).status === 200, 'close refused');
  await page.getByTestId('group-pnl').locator('p.text-2xl').getByText('+$7,000.00').waitFor(); // 2 accounts x 50 points x 7 x $10
  await page.getByTestId('group-pnl').getByTitle('2 winning trades').waitFor();
  await page.getByTestId('group-accounts').locator('p.text-emerald-400', { hasText: /^2$/ }).waitFor(); // both passed the $3,000 target
  await page.locator('tr[data-trade="closed"]').first().getByText('+50 XP').waitFor();
  await page.locator('[data-script="Gold Breakout"]').getByText(/100 XP · 2 trades/).waitFor();
  await snap('copy-trading');
  // Max trades: at the max the group stops copying
  const max = page.getByLabel('Max trades');
  await max.fill('1');
  await max.blur();
  await page.getByTestId('group-trades').getByText('1/1').waitFor();
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
  await page.getByRole('radio', { name: /Full animations/ }).waitFor();
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
