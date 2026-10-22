// End-to-end run: starts QuantBot with fake Ollama and Dukascopy servers, then clicks through every feature
// in a real Chromium window and takes screenshots into test-results/e2e/.
//   npm run test:e2e              (CHROME_PATH=... to use an installed Chrome / Edge)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startFakeDukascopy } from '../support/fakeDukascopy.js';
import { startFakeModels } from '../support/fakeModels.js';
process.env.QUANTBOT_NO_AUTOSTART = '1'; // never install or launch Ollama/Docker from the tests

const OUT = path.resolve('test-results/e2e');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const duka = await startFakeDukascopy();
const models = await startFakeModels();
process.env.QUANTBOT_DUKASCOPY_URL = duka.url;
process.env.QUANTBOT_ANTHROPIC_URL = models.url;
const { startServer } = await import('../../server/index.js');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-e2e-'));
// A made-up economic calendar: a high-impact USD event 30 minutes from now (Forex Factory) that FTMO restricts
const inHalfHour = new Date(Date.now() + 30 * 60000);
const newsFetch = async (url) => new Response(JSON.stringify(String(url).includes('faireconomy')
  ? [{ title: 'Non-Farm Employment Change', country: 'USD', date: inHalfHour.toISOString(), impact: 'High' }]
  : { items: [{ title: 'Non-Farm Employment Change', instrument: 'USD + US INDICES + XAUUSD', impact: 'high', restriction: true, date: inHalfHour.toISOString() }] }));
let app = await startServer({ port: 0, dataDir, userName: 'Tim', quiet: true, newsFetch });
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
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
// The arrow back to the chat (Settings has a text link instead of a header)
const back = () => page.getByRole('link', { name: 'Back to chat' }).or(page.locator('header a').first()).first().click();

console.log(`QuantBot e2e on ${base()} (data in ${dataDir})`);

await step('App launches on the chat page', async () => {
  await page.goto(base());
  await text(/Good (morning|afternoon|evening), Tim/).waitFor();
  await page.getByPlaceholder('Reply to QuantBot...').waitFor();
  expect(await sidebarLink('Strategy Lab').isVisible(), 'sidebar links missing');
  await snap('home');
});

await step('Chat without a local model explains what to do', async () => {
  await page.getByPlaceholder('Reply to QuantBot...').fill('hello');
  await page.getByPlaceholder('Reply to QuantBot...').press('Enter');
  await text(/Set up your local model/).first().waitFor();
  await snap('no-model-toast');
});

await step('Settings: pages fade and slide', async () => {
  const btn = page.getByTitle('Settings');
  await btn.click();
  // The chat page fades out, then Settings fades in sliding up a little
  await page.waitForTimeout(60);
  const fading = await page.evaluate(() => [...document.querySelectorAll('[data-page]')].some((d) => Number(getComputedStyle(d).opacity) < 1));
  expect(fading, 'no page fading during the change');
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await page.waitForTimeout(450);
  const settled = await page.locator('[data-page]').evaluate((d) => ({ o: getComputedStyle(d).opacity, t: getComputedStyle(d).transform }));
  expect(settled.o === '1' && /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(settled.t), `page did not settle: ${JSON.stringify(settled)}`);
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

await step('Chat: the local model writes an EA after confirming the system prompt, chat is named after the script, queue works', async () => {
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
  // The chat's name is its workspace folder, and the EA it wrote is saved there
  await page.getByTestId('chat-workspace').filter({ hasText: 'gold-breakout' }).waitFor();
  expect(fs.existsSync(path.join(dataDir, 'workspaces', 'gold-breakout', 'scripts', 'gold-breakout.mq5')), 'the EA was saved in the chat workspace');
  await text('Queued (1)').waitFor({ state: 'detached' });
  await expectCount(page.locator('pre'), 2);
  const chats = models.calls.filter((c) => c.kind === 'ollama' && /THE TRADER'S SYSTEM PROMPT/.test(c.system));
  expect(chats.length && chats.every((c) => c.model === 'qwen2.5-coder:7b'), 'chat did not use the local model');
  expect(chats.some((c) => c.stream && /reply with exactly: OK/.test(c.messages[1]?.content || '')), 'replies stream, after the system-prompt handshake');
  await text('System prompt loaded').first().waitFor();
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

await step('Chat: the model menu names each installed Ollama model', async () => {
  const combo = page.getByRole('combobox').filter({ hasText: /Qwen2\.5 Coder 7B/ });
  await combo.waitFor();
  expect((await combo.textContent()).includes('coding'), 'model shown with what it is for');
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

await step('Chat: delete confirmation fades in, then deletes', async () => {
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByPlaceholder('Reply to QuantBot...').fill('temporary question');
  await page.getByPlaceholder('Reply to QuantBot...').press('Enter');
  // The reply carries a script, so the chat is renamed after it ("Gold Breakout")
  await expectCount(page.locator('pre'), 1);
  const item = page.locator('aside .group').filter({ has: page.getByText('Gold Breakout', { exact: true }) });
  await item.waitFor();
  await item.hover();
  const trash = item.getByLabel('Delete chat');
  await trash.click();
  const dlg = page.getByRole('alertdialog');
  await dlg.waitFor();
  await page.waitForTimeout(300);
  await snap('delete-confirm');
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await item.waitFor({ state: 'detached' });
});

await step('Market Lab: the quant feature pack and charts for a market', async () => {
  await sidebarLink('Strategy Lab').click();
  await page.getByTestId('lab-tab-market').click();
  await page.getByRole('heading', { name: 'Market Lab' }).waitFor();
  await page.getByTestId('lab-symbol').selectOption('XAUUSD');
  await page.getByTestId('lab-tf').selectOption('M5');
  await page.getByTestId('lab-range').selectOption('90');
  await page.getByTestId('lab-run').click();
  await page.getByTestId('lab-results').waitFor({ timeout: 90000 });
  await page.getByTestId('lab-hist').waitFor();
  await page.getByTestId('lab-atr').waitFor();
  await page.getByTestId('lab-vector').waitFor();
  await snap('market-lab');
  await page.goto(`${base()}/`); // back to the page that has the sidebar for the next step
  await sidebarLink('Strategy Lab').waitFor();
});

await step('Strategy Tester: 3 built-in markets (XAUUSD, US100, NQ) on M15 / last 120 days', async () => {
  await page.goto(`${base()}/strategy-tester`); // a fresh Lab with only the Test tab mounted
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

await step('Strategy Tester: $10K default, firm rules by size (unavailable firms slide off), FTMO verdict, chart replay', async () => {
  const chips = page.getByTestId('firm-chips');
  // $10K by default: only FTMO offers that size
  await chips.locator('[data-firm="FTMO"]').waitFor();
  expect(/border-dashed/.test(await chips.locator('[data-firm="Lucid Trading"]').getAttribute('class')), 'Lucid has no $10K account: listed dimmed');
  await pick(page.getByLabel('Account size'), '$25K');
  await chips.locator('[data-firm="Lucid Trading"]').waitFor();
  await chips.locator('[data-firm="Lucid Trading"]').click();
  await pick(page.getByLabel('Account type'), 'LucidPro');
  await text(/LucidPro: target \$1,250/).waitFor();
  // Back to $10K: Lucid slides off to the right and the choice falls back to no firm
  await pick(page.getByLabel('Account size'), '$10K');
  await chips.locator('[data-firm="Lucid Trading"]').waitFor({ state: 'detached' });
  expect(await chips.locator('[data-firm="none"]').getAttribute('aria-pressed') === 'true', 'falls back to no firm');
  await chips.locator('[data-firm="FTMO"]').click();
  await text(/FTMO Evaluation \(2-Step\): target \$1,000/).waitFor();
  await snap('tester-account-picker');
  await page.getByRole('button', { name: 'Run test' }).click();
  await page.getByTestId('prop-result').first().waitFor({ timeout: 180000 });
  expect(/passed|failed|in progress/i.test(await page.getByTestId('prop-result').first().innerText()), 'prop verdict shown');
  // The replay opens first and plays the chart
  const replay = page.getByTestId('trade-replay').first();
  await replay.waitFor();
  const before = await replay.getByTestId('replay-status').innerText();
  await replay.getByTestId('replay-play').click();
  await page.waitForTimeout(1500);
  await replay.getByTestId('replay-play').click();
  expect(before !== await replay.getByTestId('replay-status').innerText(), 'replay moved the chart forward');
  if (!(await replay.getByTestId('replay-next').isDisabled())) await replay.getByTestId('replay-next').click();
  await snap('tester-replay');
  // All accounts: every firm / type / size, ranked, the best one named
  await chips.locator('[data-firm="all"]').click();
  const pre = await (await fetch(`${base()}/api/presets`)).json();
  const nTypes = pre.presets.length, nSizes = new Set(pre.presets.map((x) => x.size)).size;
  await text(`Testing every account the firms offer: ${nTypes} account types across ${nSizes} sizes`).waitFor();
  await page.getByRole('button', { name: 'Run test' }).click();
  await page.getByTestId('all-accounts').first().waitFor({ timeout: 240000 });
  const allBox = page.getByTestId('all-accounts').first();
  expect((await allBox.locator('[data-account-row]').count()) === 15, 'the top 15 shown first');
  await allBox.getByTestId('all-accounts-more').click();
  expect((await allBox.locator('[data-account-row]').count()) === nTypes, `all ${nTypes} account types ranked`);
  expect(/Best account:|No account passed. Lasted longest:/.test(await allBox.getByTestId('best-account').innerText()), 'best account named');
  await allBox.scrollIntoViewIfNeeded();
  await snap('tester-all-accounts');
  await chips.locator('[data-firm="none"]').click();
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
  await page.goto(`${base()}/strategy-tester`); // a fresh Lab with only the Test tab mounted
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
  await page.goto(`${base()}/strategy-tester`); // a fresh Lab with only the Test tab mounted
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
  // The simplified accounts table: four numbers on top, one row per account
  expect((await page.locator('[data-account]').count()) === 3, 'three account rows');
  expect((await page.getByTestId('fleet-kpi').first().innerText()).includes('3'), 'three active accounts');
  // Groups: a futures group with its Group Trade guide, rename, pause, delete
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByPlaceholder('e.g. Lucid 50K accounts').fill('Lucid group');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('group-panel').getByText(/Drag accounts onto this group/).waitFor();
  await page.getByTestId('group-panel').getByText('Switch copying on in Tradovate (Group Trade)').waitFor();
  const menu = () => page.locator('button[aria-haspopup=menu]').first().click();
  await menu();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await page.getByPlaceholder('e.g. Lucid 50K accounts').fill('Lucid copies');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('group-title').filter({ hasText: 'Lucid copies' }).waitFor();
  await menu();
  await page.getByRole('menuitem', { name: 'Pause copying' }).click();
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await menu();
  await page.getByRole('menuitem', { name: 'Resume copying' }).waitFor();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  await page.getByTestId('groups-overview').waitFor();
  await page.locator('[data-group-card="Lucid copies"]').waitFor({ state: 'detached' });
  await snap('accounts');
  await card('FTMO 100K').getByRole('button', { name: 'Edit FTMO 100K' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await card('FTMO 100K').waitFor({ state: 'detached' });
});

// Dragging with the mouse the way a person does: press, move in small steps, let go
const drag = async (from, to) => {
  // a dialog that just closed hands the page back to the mouse a moment later
  await page.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== 'none', null, { timeout: 5000 });
  // the target in the middle of the window (clear of the sticky header and the drag auto-scroll edges)
  await to.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
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

await step('Copy trading: add a script, drag accounts and the script onto a group, its alerts trade every account', async () => {
  await page.setViewportSize({ width: 1360, height: 2200 }); // the open group and the accounts fit on one screen
  await page.goto(`${base()}/accounts`);
  await page.getByRole('heading', { name: 'Accounts' }).waitFor();
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
  await page.locator('[data-account="Lucid 50K #3"]').waitFor();
  // A script, with its own webhook address
  await page.getByRole('button', { name: 'Add script' }).click();
  await page.getByRole('dialog').getByPlaceholder('e.g. Gold London-NY breakout').fill('Gold Breakout');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').getByText("This script's webhook").waitFor();
  const local = (await page.getByRole('dialog').getByLabel('MT5 / this PC', { exact: true }).textContent()).trim();
  expect(/\/hook\/[0-9a-f]{32}\/s\/[A-Za-z0-9]+$/.test(local), `script webhook: ${local}`);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.locator('[data-script="Gold Breakout"]').waitFor();
  // A group; drag two accounts and the script onto it
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByPlaceholder('e.g. Lucid 50K accounts').fill('Lucid squad');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  // The new group opens; accounts dropped anywhere on it join it
  const panel = page.getByTestId('group-panel');
  await panel.getByTestId('group-title').filter({ hasText: 'Lucid squad' }).waitFor();
  // Accounts join a group from the Group column of the accounts table
  await page.locator('[data-account="Lucid 50K #2"]').getByTestId('fleet-group').selectOption({ label: 'Lucid squad' });
  await page.locator('[data-account="Lucid 50K #3"]').getByTestId('fleet-group').selectOption({ label: 'Lucid squad' });
  await page.locator('[data-member]').nth(1).waitFor();
  await drag(page.locator('[data-script="Gold Breakout"]'), page.getByTestId('script-slot'));
  await panel.locator('[data-group-script="Gold Breakout"]').waitFor();
  await page.locator('[data-account="Lucid 50K #3"]').getByTestId('account-script').getByText('Gold Breakout').waitFor();
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
  await page.locator('[data-script="Gold Breakout"]').getByText(/^2 trades ·/).waitFor();
  await snap('copy-trading');
  // The activity log has every step: setup, the signal, each account's sizing and fill, the close and the pass
  const log = page.getByTestId('activity-log');
  await log.locator('li[data-event="setup"]').filter({ hasText: 'Lucid squad now trades Gold Breakout' }).waitFor();
  await log.locator('li[data-event="signal"]').filter({ hasText: 'Gold Breakout: buy MGC1! @ 2400 SL 2396 TP 2450' }).waitFor();
  await log.locator('li[data-event="open"]').filter({ hasText: /bought 7 MGC1! @ 2400 .*risk \$300 \/ \(4 stop x \$10\) = 7/ }).first().waitFor();
  await log.locator('li[data-event="status"]').filter({ hasText: /PASSED: balance \$53,500\.00 reached the target/ }).first().waitFor();
  await page.getByRole('tab', { name: /^Pass \/ fail/ }).click();
  await expectCount(log.locator('li[data-event]'), 2);
  await log.locator('li[data-event="status"]').first().click();
  await log.locator('pre').filter({ hasText: '"status": "passed"' }).waitFor();
  await page.getByRole('tablist', { name: 'Activity filter' }).getByRole('tab', { name: /^All/ }).click();
  await log.scrollIntoViewIfNeeded();
  await snap('copy-activity');
  // Evaluate: totals and a row per script and account
  await page.getByRole('tab', { name: 'Evaluate' }).click();
  const ev = page.getByTestId('evaluate');
  await ev.locator('[data-eval-row="Gold Breakout"]').getByText('+$7,000.00').waitFor();
  await ev.locator('tr[data-eval-row]').filter({ hasText: 'Lucid 50K #3' }).getByText('+$3,500.00').first().waitFor();
  await ev.locator('[data-eval-row="tp"]').waitFor();
  const download = page.waitForEvent('download');
  await ev.getByRole('button', { name: 'Export trades CSV' }).click();
  const csv = fs.readFileSync(await (await download).path(), 'utf8');
  expect(csv.split('\n').length === 3 && /,Gold Breakout,G-1,MGC1!,long,7,2400,2396,2450,2450,50,10,3500,50,tp,closed/.test(csv), `trades CSV:\n${csv}`);
  await ev.scrollIntoViewIfNeeded();
  await snap('copy-evaluate');
  await page.getByRole('tab', { name: 'Activity log' }).click();
  // Max trades: at the max the group stops copying
  const max = page.getByLabel('Max trades');
  await max.fill('1');
  await max.blur();
  await page.getByTestId('group-trades').getByText('1/1').waitFor();
  // One script per account: dropping another asks first; Keep leaves it, Yes replaces it
  await page.getByRole('button', { name: 'Add script' }).click();
  await page.getByRole('dialog').getByPlaceholder('e.g. Gold London-NY breakout').fill('Silver Scalper');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').getByText("This script's webhook").waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await drag(page.locator('[data-script="Silver Scalper"]'), page.getByTestId('script-slot'));
  const ask = page.getByTestId('replace-dialog');
  await ask.getByText('There is already one on this account').waitFor();
  await snap('copy-replace');
  await ask.getByRole('button', { name: 'Keep Gold Breakout' }).click();
  await ask.waitFor({ state: 'detached' });
  await panel.locator('[data-group-script="Gold Breakout"]').waitFor();
  await drag(page.locator('[data-script="Silver Scalper"]'), page.getByTestId('script-slot'));
  await ask.getByRole('button', { name: 'Yes, replace it' }).click();
  await panel.locator('[data-group-script="Silver Scalper"]').waitFor();
  expect(!(await panel.locator('[data-group-script="Gold Breakout"]').count()), 'old script still on the group');
  // Back to the overview: the group shrinks back into its card, which shows its script and numbers
  await panel.getByRole('button', { name: 'All groups' }).click();
  const card = page.locator('[data-group-card="Lucid squad"]');
  await card.getByTestId('card-scripts').getByText('Silver Scalper').waitFor();
  await card.getByTestId('card-pnl').locator('p.text-lg').getByText('+$7,000.00').waitFor();
  await page.waitForTimeout(500);
  await snap('copy-overview');
  await card.click();
  await panel.getByTestId('group-title').filter({ hasText: 'Lucid squad' }).waitFor();
  // Each script has a folder (code, CLAUDE.md, logs, trades) and its own chat on the local model
  await page.locator('[data-script="Silver Scalper"]').getByRole('button', { name: 'Edit Silver Scalper' }).click();
  const sd = page.getByRole('dialog');
  await sd.getByTestId('script-folder').getByLabel('Folder').filter({ hasText: /silver-scalper$/ }).waitFor();
  const folder = path.join(dataDir, 'scripts', 'silver-scalper');
  expect(fs.existsSync(path.join(folder, 'CLAUDE.md')) && fs.existsSync(path.join(folder, 'activity.log')), `no script folder at ${folder}`);
  expect(/Lucid squad now trades Silver Scalper/.test(fs.readFileSync(path.join(folder, 'activity.log'), 'utf8')), 'activity.log missing the setup');
  await snap('copy-script-dialog');
  await sd.getByRole('button', { name: 'Open its chat' }).click();
  await page.getByPlaceholder('Reply to QuantBot...').waitFor();
  await page.getByRole('combobox').filter({ hasText: /Qwen2\.5 Coder 7B/ }).waitFor();
});

await step('FTMO and MT5: stages, firm limits, auto-withdraw, the MT5 copier, news and trading-hour blocks', async () => {
  await page.setViewportSize({ width: 1360, height: 2200 }); // the open group and the accounts fit on one screen
  await page.goto(`${base()}/accounts`);
  await page.getByTestId('groups-overview').waitFor();
  const addFtmo = async (name, login, size, stage) => {
    await page.getByRole('button', { name: 'Add account' }).click();
    const d = page.getByRole('dialog');
    await d.getByPlaceholder('e.g. Lucid 50K #1').fill(name);
    await d.getByPlaceholder('e.g. LTT04821 or 5100123').fill(login);
    await d.getByPlaceholder('e.g. FTMO-Demo').fill('FTMO-Server');
    await pick(d.getByRole('combobox', { name: 'Account rules' }), `FTMO ${size}K`);
    await pick(d.getByRole('combobox', { name: 'Stage' }), stage);
    return d;
  };
  // Funded FTMO accounts: auto-withdraw is on by default, the risk is 15% of the 5% daily loss
  let d = await addFtmo('FTMO 100K #1', '5100901', 100, 'Funded');
  expect(await d.getByRole('switch', { name: 'Withdraw automatically' }).getAttribute('aria-checked') === 'true', 'auto-withdraw should default on for funded FTMO');
  expect((await d.getByLabel('Risk per trade').inputValue()) === '750', 'FTMO 100K risk should default to $750');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  d = await addFtmo('FTMO 200K #1', '5100902', 200, 'Funded');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await page.getByTestId('firm-usage').getByText('FTMO funded $300K / $400K').waitFor();
  // A third funded account would pass FTMO's $400K: refused until it is a Challenge
  d = await addFtmo('FTMO 200K #2', '5100903', 200, 'Funded');
  await d.getByTestId('firm-limit').getByText(/\$400,000 of funded capital/).waitFor();
  expect(await d.getByRole('button', { name: 'Save', exact: true }).isDisabled(), 'save should be blocked over the FTMO limit');
  await pick(d.getByRole('combobox', { name: 'Stage' }), 'Challenge');
  await d.getByTestId('firm-limit').waitFor({ state: 'detached' });
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await page.locator('[data-account="FTMO 200K #2"]').getByText('FTMO Challenge').waitFor();
  // The MT5 copier: on, symbol map, the EA's address once saved
  await page.locator('[data-account="FTMO 100K #1"]').getByRole('button', { name: 'Edit FTMO 100K #1' }).click();
  d = page.getByRole('dialog');
  await d.getByRole('switch', { name: 'Place trades on MT5' }).click();
  await d.getByLabel('Symbol map').fill('MGC1!=XAUUSD');
  await d.getByRole('switch', { name: 'Place trades on MT5', checked: true }).waitFor();
  await page.waitForTimeout(300);
  await d.getByTestId('mt5-copier').getByLabel('Copier address', { exact: true }).filter({ hasText: /\/mt5\/[0-9a-f]{32}\/[A-Za-z0-9]+$/ }).waitFor();
  await snap('ftmo-mt5-account');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  // An MT5 group trading the script, with its news and trading-hour blocks in this PC's time zone
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByPlaceholder('e.g. Lucid 50K accounts').fill('FTMO squad');
  await page.getByRole('dialog').getByRole('radio', { name: 'MetaTrader 5' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const panel = page.getByTestId('group-panel');
  await panel.getByTestId('group-title').filter({ hasText: 'FTMO squad' }).waitFor();
  await page.locator('[data-account="FTMO 100K #1"]').getByTestId('fleet-group').selectOption({ label: 'FTMO squad' });
  await panel.locator('[data-member="FTMO 100K #1"]').waitFor();
  await drag(page.locator('[data-script="Silver Scalper"]'), page.getByTestId('script-slot'));
  await panel.locator('[data-group-script="Silver Scalper"]').waitFor();
  const bp = page.getByTestId('blackout-panel');
  const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await bp.getByTestId('blackout-tz').getByText(`Times in ${tz} (this PC)`).waitFor();
  await bp.getByTestId('news-upcoming').getByText(/FTMO restricted news: USD \+ US INDICES \+ XAUUSD Non-Farm Employment Change/).waitFor();
  await bp.getByTestId('news-upcoming').getByText(/News: USD Non-Farm Employment Change \(Forex Factory, high\)/).waitFor();
  // Block a weekday other than today (today is checked with the time window below)
  const otherDay = await page.evaluate(() => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(new Date().getDay() + 3) % 7]);
  await bp.getByRole('group', { name: 'Blocked days' }).getByRole('button', { name: otherDay }).click();
  await bp.getByRole('group', { name: 'Blocked days' }).getByRole('button', { name: otherDay, pressed: true }).waitFor();
  // Block the next few minutes, then send a buy: it is not copied, and the log says why
  const [from, to] = await page.evaluate(() => [-1, 5].map((m) => new Date(Date.now() + m * 60000).toTimeString().slice(0, 5)));
  await bp.getByLabel('Block from', { exact: true }).fill(from);
  await bp.getByLabel('Block to', { exact: true }).fill(to);
  await bp.getByRole('button', { name: 'Add blocked hours' }).click();
  await bp.locator(`[data-window="${from}-${to}"]`).waitFor();
  await bp.getByTestId('blackout-now').getByText('No new trades now').waitFor();
  await page.waitForTimeout(800); // saved a moment after the change
  await snap('ftmo-blackouts');
  const key = (await (await fetch(`${base()}/api/signals/config`)).json()).key;
  const inv = async (...args) => (await (await fetch(`${base()}/api/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'entity', args }) })).json()).result;
  const silver = (await inv('Script', 'filter', { name: 'Silver Scalper' }))[0];
  const res = await fetch(`${base()}/hook/${key}/s/${silver.id}`, { method: 'POST', body: JSON.stringify({ qb: 1, event: 'buy', symbol: 'MGC1!', price: 2400, sl: 2396, strategy: 'Silver Scalper', trade_id: 'S-1' }) });
  expect(res.status === 200, 'buy refused');
  await page.getByRole('tablist', { name: 'Activity filter' }).getByRole('tab', { name: /^News & hours/ }).click();
  await page.getByTestId('activity-log').locator('li[data-event="block"]').filter({ hasText: new RegExp(`FTMO squad: buy MGC1! not copied\\. ${from}-${to} is blocked`) }).waitFor();
  // Unblocked: the buy goes to the FTMO account in lots on XAUUSD and is queued for its MT5 terminal
  await bp.getByRole('button', { name: `Unblock ${from}-${to}` }).click();
  await page.waitForTimeout(800);
  await fetch(`${base()}/hook/${key}/s/${silver.id}`, { method: 'POST', body: JSON.stringify({ qb: 1, event: 'buy', symbol: 'MGC1!', price: 2400, sl: 2396, strategy: 'Silver Scalper', trade_id: 'S-2' }) });
  await page.getByRole('tablist', { name: 'Activity filter' }).getByRole('tab', { name: /^Orders/ }).click();
  await page.getByTestId('activity-log').locator('li[data-event="order"]').filter({ hasText: /buy 1\.87 lots XAUUSD queued for MT5/ }).waitFor();
  const acct = (await inv('TradingAccount', 'filter', { label: 'FTMO 100K #1' }))[0];
  const { url } = await (await fetch(`${base()}/api/mt5/url?account=${acct.id}`)).json();
  const poll = await (await fetch(`${url.replace('127.0.0.1', new URL(base()).hostname)}/poll`)).text();
  expect(/^[a-z0-9]+\|open\|XAUUSD\|long\|1\.87\|2396\|0\|QB[a-z0-9]+\|0$/.test(poll), `EA poll: ${poll}`);
  await snap('ftmo-orders');
  await page.getByRole('tablist', { name: 'Activity filter' }).getByRole('tab', { name: /^All/ }).click();
});

await page.setViewportSize({ width: 1360, height: 900 });

await step('MT5 & deployment: add broker accounts one by one and in bulk, the daemon logs them in and reports back', async () => {
  await page.setViewportSize({ width: 1360, height: 2400 });
  await page.goto(`${base()}/settings`);
  await page.getByRole('tab', { name: 'MT5 & deployment' }).click();
  const card = page.getByTestId('mt5-accounts');
  await card.getByLabel('Broker', { exact: true }).fill('FundedNext');
  await card.getByLabel('Account number', { exact: true }).fill('7001234');
  await card.getByLabel('Password', { exact: true }).fill('Fn-Secret-1');
  await card.getByLabel('MT5 server', { exact: true }).fill('FundedNext-Server');
  await card.getByLabel('Capital', { exact: true }).fill('50000');
  await card.getByLabel('Terminal path', { exact: true }).fill('C:\\MT5\\FN1\\terminal64.exe');
  await card.getByRole('button', { name: 'Add account to daemon' }).click();
  await card.getByTestId('mt5-add-results').getByText('added FundedNext 7001234').waitFor();
  await card.getByRole('button', { name: 'Add many at once' }).click();
  await card.getByLabel('Accounts, one per line').fill([
    'broker, account number, password, server, capital, terminal path',
    'FOREX.com, 22334455, Fx-Secret-2, FOREX.com-Live, 10000, C:\\MT5\\FX1\\terminal64.exe',
    'FTMO, 5100777, Ftmo-Bad-3, FTMO-Server, 100000, C:\\MT5\\FTMO7\\terminal64.exe',
    'FTMO, 51x, nope, FTMO-Server',
  ].join('\n'));
  await card.getByRole('button', { name: 'Add these accounts' }).click();
  const results = card.getByTestId('mt5-add-results');
  await results.getByText('Line 2: added FOREX.com 22334455').waitFor();
  await results.getByText(/Line 4: Account number must be digits/).waitFor();
  await card.locator('tr[data-mt5="22334455"]').getByText('Waiting for the daemon').waitFor();
  // The real daemon script, with a stand-in for the Windows-only MetaTrader5 package
  const command = (await page.getByTestId('daemon-card').getByLabel('Daemon command', { exact: true }).textContent()).trim();
  const token = command.match(/--token ([0-9a-f]{40})/)[1];
  const calls = path.join(dataDir, 'fake-mt5-calls.jsonl');
  fs.writeFileSync(calls, '');
  const daemon = await new Promise((resolve) => {
    const p = spawn('python3', ['mt5/mt5_manager.py', '--url', base(), '--token', token, '--once', '--log', ''], {
      env: { ...process.env, PYTHONPATH: path.resolve('tests/support/fake_mt5'), FAKE_MT5_CALLS: calls, FAKE_MT5_FAIL: '5100777' },
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (status) => resolve({ status, out }));
  });
  expect(daemon.status === 0, `daemon failed:\n${daemon.out}`);
  expect(/logged in to FundedNext-Server/.test(daemon.out), `daemon output:\n${daemon.out}`);
  await card.locator('tr[data-mt5="7001234"]').getByTestId('daemon-state').getByText('Connected').waitFor();
  await card.locator('tr[data-mt5="7001234"]').getByText(/100,234 \/ 100,050 USD/).waitFor();
  await card.locator('tr[data-mt5="5100777"]').getByText(/login failed: -6 Terminal: Authorization failed/).waitFor();
  await page.getByTestId('daemon-card').getByTestId('daemon-status').getByText(/Running: 2\/\d+ accounts connected/).waitFor();
  const logged = fs.readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(logged.some((c) => c.login === 22334455 && c.password === 'Fx-Secret-2' && c.path === 'C:\\MT5\\FX1\\terminal64.exe'), 'daemon did not log in FOREX.com with its own terminal');
  const stored = fs.readdirSync(path.join(dataDir, 'entities')).map((f) => fs.readFileSync(path.join(dataDir, 'entities', f), 'utf8')).join('');
  expect(!stored.includes('Fx-Secret-2') && !stored.includes('Fn-Secret-1'), 'MT5 password stored in plain text');
  await page.getByTestId('vps-guide').getByText('24/7 VPS deployment').waitFor();
  await snap('mt5-deployment');
  await page.setViewportSize({ width: 1360, height: 900 });
});

await step('Unknown page shows 404', async () => {
  await page.goto(`${base()}/nope`);
  await text('Page Not Found').waitFor();
});

await step('Phone layout: sidebar slides in from the left and back out', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base());
  await page.waitForTimeout(500); // let the page finish fading in
  const aside = page.locator('aside');
  expect((await aside.evaluate((el) => getComputedStyle(el).opacity)) === '0', 'sidebar visible before tap');
  const menu = page.locator('header button').first();
  await menu.click();
  await page.waitForTimeout(450);
  const style = await aside.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, left: el.getBoundingClientRect().left }));
  expect(style.opacity === '1' && Math.abs(style.left) < 1, `sidebar did not slide in: ${JSON.stringify(style)}`);
  await snap('mobile-sidebar');
  await page.mouse.click(370, 400);
  await page.waitForTimeout(450); // the 200 ms close animation, plus a margin
  expect((await aside.evaluate((el) => getComputedStyle(el).opacity)) === '0', 'sidebar did not close');
  await page.setViewportSize({ width: 1360, height: 900 });
});

await step('Everything is still there after restarting QuantBot', async () => {
  await app.close();
  app = await startServer({ port: 0, dataDir, userName: 'Tim', quiet: true, newsFetch });
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
