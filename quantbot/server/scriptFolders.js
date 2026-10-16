// A folder per script, next to QuantBot's logs, so Claude (in the QuantBot chat, Claude Code or Claude Desktop) has
// everything about a script in one place: its code, a CLAUDE.md with the context, its copy trading activity log, its
// trades, a summary of its results and your own notes. Everything but notes.md is rewritten from QuantBot's data;
// notes.md is yours: edits there are read back into QuantBot (so they survive updates and reinstalls).
import fs from 'node:fs';
import path from 'node:path';
import { evaluate, groupScriptIds, levelFromXp, tierOf, SCRIPT_STEP, ACCOUNT_STEP } from './lib/copyRules.js';

const EXT = { Pine: 'pine', MT5: 'mq5' };
const r2 = (v) => Math.round(v * 100) / 100;
const usd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rank = (xp, step) => { const l = levelFromXp(Number(xp) || 0, step); const t = tierOf(l.level); return `${t.name}${t.division ? ` ${t.division}` : ''} (level ${l.level})`; };
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const slug = (name) => String(name || 'script').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'script';

// The newest MQL5 / Pine code block in a reply (Claude writing or changing a script)
export function codeFromReply(reply) {
  let best = null;
  for (const [, lang, code] of String(reply).matchAll(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g)) {
    const language = /pine/i.test(lang) || /\/\/\s*@version\s*=\s*\d/.test(code) ? 'Pine'
      : /mql|mq5|cpp|c\+\+/i.test(lang) || /#property|OnTick\s*\(|OnInit\s*\(/.test(code) ? 'MT5'
        : /\b(strategy|indicator)\s*\(/.test(code) ? 'Pine' : null;
    if (language && (!best || code.length >= best.code.length)) best = { code: code.trim(), language };
  }
  return best;
}

export function createScriptFolders({ root, db, log = () => {} }) {
  const run = async (...a) => db.run(...a);
  const all = async (entity, query = {}, opts = {}) => {
    const r = await run(entity, 'filter', query, { limit: 100000, ...opts });
    return Array.isArray(r) ? r : r.items;
  };
  const written = new Map(); // notes.md text QuantBot last wrote, to tell your edits apart
  let timer = null;
  let running = null;

  const dirOf = (scripts, script) => {
    const base = slug(script.name);
    const clash = scripts.some((s) => s.id !== script.id && slug(s.name) === base);
    return path.join(root, clash ? `${base}-${script.id.slice(0, 6)}` : base);
  };

  // What Claude reads first: the script, where it trades, how it is doing, what went wrong, and the files around it
  async function brief(script, { scripts, groups, accounts, trades, events } = {}) {
    scripts ||= await all('Script'); groups ||= await all('CopyGroup'); accounts ||= await all('TradingAccount');
    trades ||= await all('AccountTrade', { script_id: script.id }, { sort: 'opened_at' });
    events ||= await all('CopyEvent', { script_id: script.id }, { sort: '-created_date', limit: 2000 });
    const mine = trades.filter((t) => t.script_id === script.id);
    const e = evaluate(mine);
    const onGroups = groups.filter((g) => groupScriptIds(g).includes(script.id));
    const members = accounts.filter((a) => onGroups.some((g) => g.id === a.group_id));
    const problems = events.filter((x) => x.level !== 'info').slice(0, 15);
    const pf = e.profitFactor === Infinity ? 'no losses' : e.profitFactor.toFixed(2);
    return [
      `# ${script.name}`,
      '',
      `QuantBot script (${script.language}). Rank ${rank(script.xp, SCRIPT_STEP)}, ${script.xp || 0} XP. Folder: ${dirOf(scripts, script)}`,
      'Scripts are written and changed with Claude only. Keep the QuantBot signal messages (buy / sell / set_sl / set_tp / close JSON alerts) so copy trading keeps working.',
      '',
      '## Files here',
      `- script.${EXT[script.language] || 'txt'}: the current code (QuantBot writes it; change the script in its Claude chat in QuantBot)`,
      '- activity.log: everything copy trading did with this script, oldest first (signals, sizing, skips, fills, stop moves, closes, pass / fail, orders)',
      '- trades.csv: every copied trade, one row per account',
      '- summary.json: results overall and per account',
      '- notes.md: your own notes (QuantBot keeps them)',
      '',
      '## Where it trades',
      ...(onGroups.length ? onGroups.map((g) => `- Group ${g.name}${g.enabled === false ? ' (paused)' : ''}: ${g.trades_made || 0}/${g.max_trades || 100} trades made`) : ['- Not on a group yet']),
      ...members.map((a) => `  - ${a.display_name || a.label} (${a.label}, ${a.platform}): ${a.status || 'active'}, balance ${usd(a.balance ?? a.start_balance ?? 0)} from ${usd(a.start_balance ?? 0)}${a.target ? `, target +${usd(a.target)}` : ''}${a.max_loss ? `, max loss ${usd(a.max_loss)}${a.trailing ? ' trailing' : ''}, floor ${usd(a.floor ?? (a.start_balance - a.max_loss))}` : ''}${a.risk_usd ? `, risk ${usd(a.risk_usd)}/trade` : ''}, ${rank(a.xp, ACCOUNT_STEP)}`),
      '',
      '## Results (paper copies at the alert price)',
      e.trades ? `${e.trades} closed trades (${e.open} open): net ${usd(e.net)}, win rate ${(e.winRate * 100).toFixed(1)}%, profit factor ${pf}, ${usd(e.expectancy)} per trade, avg win ${usd(e.avgWin)}, avg loss ${usd(e.avgLoss)}, max drawdown ${usd(e.maxDrawdown)}, exits ${Object.entries(e.reasons).map(([k, v]) => `${k} ${v}`).join(', ')}`
        : 'No closed trades yet.',
      '',
      '## Latest warnings',
      ...(problems.length ? problems.map((x) => `- ${String(x.created_date).slice(0, 16).replace('T', ' ')} ${x.message}`) : ['- None']),
      ...(script.notes ? ['', '## Trader notes', script.notes] : []),
    ].join('\n');
  }

  const write = (file, text) => {
    try { if (fs.readFileSync(file, 'utf8') === text) return; } catch { /* new file */ }
    fs.writeFileSync(file, text);
  };

  async function sync() {
    const [scripts, groups, accounts] = [await all('Script'), await all('CopyGroup'), await all('TradingAccount')];
    fs.mkdirSync(root, { recursive: true });
    const keep = new Set();
    for (const script of scripts) {
      const dir = dirOf(scripts, script);
      keep.add(path.basename(dir));
      fs.mkdirSync(dir, { recursive: true });
      // Your notes come back into QuantBot first
      const notesFile = path.join(dir, 'notes.md');
      let notes = script.notes || '';
      try {
        const onDisk = fs.readFileSync(notesFile, 'utf8');
        if (onDisk !== notes && onDisk !== written.get(notesFile)) {
          notes = onDisk;
          await run('Script', 'update', script.id, { notes });
          script.notes = notes;
          log(`scripts: notes for ${script.name} read from notes.md`);
        }
      } catch { /* no notes file yet */ }
      const notesText = notes || `# Notes on ${script.name}\n\nWrite anything Claude should know about this script here (ideas, rules, what to try next).\n`;
      write(notesFile, notesText);
      written.set(notesFile, notesText);

      const trades = await all('AccountTrade', { script_id: script.id }, { sort: 'opened_at' });
      const events = await all('CopyEvent', { script_id: script.id }, { sort: 'created_date', limit: 20000 });
      const name = (id) => { const a = accounts.find((x) => x.id === id); return a ? a.display_name || a.label : 'removed'; };
      const group = (id) => groups.find((g) => g.id === id)?.name || '';
      for (const f of fs.readdirSync(dir)) if (/^script\.(pine|mq5|txt)$/.test(f) && f !== `script.${EXT[script.language] || 'txt'}`) fs.rmSync(path.join(dir, f));
      write(path.join(dir, `script.${EXT[script.language] || 'txt'}`), script.code || `// ${script.name}: no code yet. Write it in the script's Claude chat in QuantBot.\n`);
      write(path.join(dir, 'CLAUDE.md'), `${await brief(script, { scripts, groups, accounts, trades, events: [...events].reverse() })}\n`);
      write(path.join(dir, 'activity.log'), events.map((x) => `${x.created_date} ${x.kind.padEnd(6)} ${x.level === 'info' ? '' : `[${x.level}] `}${x.account_id ? `${name(x.account_id)}: ` : ''}${x.message}`).join('\n') + (events.length ? '\n' : ''));
      const cols = [['opened_at', (t) => t.opened_at], ['closed_at', (t) => t.closed_at], ['account', (t) => name(t.account_id)], ['group', (t) => group(t.group_id)],
        ['trade_id', (t) => t.trade_id], ['symbol', (t) => t.symbol], ['side', (t) => t.side], ['qty', (t) => t.qty], ['entry', (t) => t.entry], ['sl', (t) => t.sl], ['tp', (t) => t.tp],
        ['exit', (t) => t.exit], ['pnl', (t) => t.pnl], ['xp', (t) => t.xp], ['reason', (t) => t.reason], ['status', (t) => t.status], ['order', (t) => t.forwarded]];
      write(path.join(dir, 'trades.csv'), [cols.map(([h]) => h).join(','), ...trades.map((t) => cols.map(([, f]) => csvCell(f(t))).join(','))].join('\n') + '\n');
      const e = evaluate(trades);
      write(path.join(dir, 'summary.json'), `${JSON.stringify({
        script: script.name, language: script.language, xp: script.xp || 0, rank: rank(script.xp, SCRIPT_STEP),
        overall: { ...e, profitFactor: e.profitFactor === Infinity ? 'no losses' : r2(e.profitFactor), winRate: r2(e.winRate * 100) },
        accounts: [...new Set(trades.map((t) => t.account_id))].map((id) => { const x = evaluate(trades.filter((t) => t.account_id === id)); return { account: name(id), trades: x.trades, net: x.net, win_rate: r2(x.winRate * 100), max_drawdown: x.maxDrawdown }; }),
        updated: new Date().toISOString(),
      }, null, 2)}\n`);
    }
    // Folders of deleted scripts go (only folders QuantBot made: they have a CLAUDE.md)
    for (const f of fs.readdirSync(root, { withFileTypes: true })) {
      if (f.isDirectory() && !keep.has(f.name) && fs.existsSync(path.join(root, f.name, 'CLAUDE.md'))) fs.rmSync(path.join(root, f.name), { recursive: true, force: true });
    }
    write(path.join(root, 'CLAUDE.md'), [
      '# QuantBot scripts',
      '',
      'One folder per copy trading script. Each has CLAUDE.md (start there), the script code, activity.log, trades.csv, summary.json and notes.md.',
      'QuantBot rewrites everything except notes.md whenever something happens, so these files are always current.',
      `QuantBot's own log (quantbot.log) is in the logs folder next to this one.`,
      '',
      ...scripts.map((s) => `- ${path.basename(dirOf(scripts, s))}/: ${s.name} (${s.language}, ${s.trades || 0} trades, ${usd(s.pnl || 0)})`),
    ].join('\n') + '\n');
    return { root, scripts: scripts.map((s) => ({ id: s.id, name: s.name, dir: dirOf(scripts, s) })) };
  }

  // Many changes in a burst (a signal touches every account) write the folders once
  function syncSoon(ms = 1500) {
    clearTimeout(timer);
    timer = setTimeout(() => { running = sync().catch((e) => log(`scripts: folder update failed: ${e.message}`)); }, ms);
    timer.unref?.();
  }

  return { root, sync, syncSoon, brief, dirOf, done: () => running };
}
