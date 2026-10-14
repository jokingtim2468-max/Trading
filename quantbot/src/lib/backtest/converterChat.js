import { client } from '@/api/client';

const { ChatSession, ChatMessage } = client.entities;
const money = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`);
const pct = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(1)}%`);

// The code block the chat and the Strategy Tester read: named after the bot so every version stays together
export function namedScript(code, botName) {
  const body = String(code || '').replace(/^[ \t]*\/\/[ \t]*Script:.*\r?\n?/m, '');
  return `// Script: ${botName}\n${body.trimStart()}`;
}

function resultsMessage(runs, intro) {
  const latest = runs[runs.length - 1];
  const lang = latest.target === 'Pine' ? 'pine' : 'mql5';
  const rows = runs.map((r) => `| ${r.ds.symbol} ${r.ds.timeframe} | v${r.version} | ${money(r.metrics.net)} | ${r.metrics.trades} | ${pct(r.metrics.winRate)} | ${Number.isFinite(r.metrics.profitFactor) ? r.metrics.profitFactor.toFixed(2) : 'n/a'} | ${pct(r.metrics.maxDDPct)} | ${r.mc ? `${r.mc.score} ${r.mc.grade}` : 'n/a'} |`);
  const failed = latest.results.filter((x) => x.status !== 'pass');
  return [
    intro,
    '',
    '| Market | Version | Net | Trades | Win rate | Profit factor | Max DD | Monte Carlo |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `Test window: ${latest.windowText}.`,
    failed.length ? `\nRule checks not passed:\n${failed.map((x) => `- **${x.rule}**: ${x.status}. ${x.detail || ''}`).join('\n')}` : '\nEvery rule check passed.',
    '',
    `\`\`\`${lang}\n${namedScript(latest.code, latest.botName)}\n\`\`\``,
    '',
    'Tell me what to fine-tune. I can read every test, trade and candle behind these numbers.',
  ].join('\n');
}

// After a conversion: a chat linked to the bot, holding the strategy, the results on every market and the code
export async function openConverterChat(cfg, runs) {
  const first = runs[0];
  const session = await ChatSession.create({
    title: cfg.botName, group: first.target, bot_name: cfg.botName, last_message_at: new Date().toISOString(),
  });
  await ChatMessage.create({
    session_id: session.id, role: 'user',
    content: `Convert this strategy to ${first.target} and test it.\n\nStrategy:\n${cfg.strategy}${cfg.rules.trim() ? `\n\nRules:\n${cfg.rules}` : ''}`,
  });
  const markets = runs.map((r) => r.ds.symbol).join(', ');
  await ChatMessage.create({
    session_id: session.id, role: 'assistant',
    content: resultsMessage(runs.map((r) => ({ ...r, botName: cfg.botName })), `Converted **${cfg.botName}** to ${first.target} and tested it on ${markets} on data it had never seen. ${first.summary || ''}`.trim()),
  });
  return session.id;
}

// After Fix & retest: the new version's results and code go into the same chat, so it stays current
export async function addVersionToChat(chatId, cfg, run) {
  await ChatMessage.create({
    session_id: chatId, role: 'assistant',
    content: resultsMessage([{ ...run, botName: cfg.botName }], `Fixed and retested: **${cfg.botName} v${run.version}** on ${run.ds.symbol}.`),
  });
  await ChatSession.update(chatId, { last_message_at: new Date().toISOString() });
}
