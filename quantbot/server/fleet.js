// Fleet: account profiles from the presets, the simplified accounts list, deploying a profile to an account,
// pausing, the payout audit, and the trader's notification webhook (Discord or Telegram).
import fs from 'node:fs';
import path from 'node:path';
import { loadPresets, findPreset, presetFields, accountId } from './lib/fleetRules.js';
import { planFirm, STAGE_LABELS } from './lib/copyRules.js';

const PROFILE_ENUM = { 'Lucid Trading|LucidFlex': 0, 'Lucid Trading|LucidPro': 1, 'FTMO|Evaluation (2-Step)': 2, 'FTMO|Funded Account': 3, The5ers: 4, 'Alpha Capital': 5, FundedNext: 6 };
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const r2 = (v) => Math.round(v * 100) / 100;

// The MT5 EA's inputs for a profile (QB_ExhaustionEngine.mq5), as a .set file MT5 loads in the EA's Inputs tab
export function setFile(p) {
  const profile = PROFILE_ENUM[`${p.firm}|${p.model}`] ?? PROFILE_ENUM[p.firm] ?? 0;
  return [
    `; QuantBot profile ${p.id}: ${p.firm} ${p.model} $${p.size.toLocaleString('en-US')}`,
    `Profile=${profile}`, `RiskUsd=${p.risk_usd}`, `TpRatio=${p.tp_ratio}`,
    `DailyProfitCap=${p.daily_profit_cap ?? 1000000}`, `DailyLossFloor=${p.daily_loss_floor ?? -1000000}`,
    `MaxLosses=${p.kill_switch_losses ?? 2}`, `StopFloor=${p.stop_floor_pts}`, 'MaxLots=10', 'Magic=26101901', 'SlippagePts=30', '',
  ].join('\r\n');
}

export function createFleet({ dataDir, db, payouts, log = () => {} }) {
  const run = async (...a) => db.run(...a);
  const dir = path.join(dataDir, 'fleet');
  fs.mkdirSync(dir, { recursive: true });
  const cfgFile = path.join(dir, 'settings.json');
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { cfg = {}; }

  async function notify(text) {
    if (!/^https:\/\//.test(cfg.notify_url || '')) return;
    try {
      // Discord takes { content }, a Telegram sendMessage URL (with ?chat_id=) takes { text }
      await fetch(cfg.notify_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, text }), signal: AbortSignal.timeout(5000) });
    } catch (e) { log(`fleet notify failed: ${e.message}`); }
  }

  async function view() {
    const accounts = await run('TradingAccount', 'filter', {});
    const groups = await run('CopyGroup', 'filter', {});
    const scripts = await run('Script', 'filter', {});
    const rows = accounts.map((a) => {
      const start = Number(a.start_balance) || 0, balance = a.balance != null ? Number(a.balance) : start;
      const g = groups.find((x) => x.id === a.group_id);
      const groupScripts = g ? (g.script_ids || [g.script_id]).filter(Boolean).map((id) => scripts.find((s) => s.id === id)?.name).filter(Boolean).join(', ') : '';
      const script = a.profile_name ? `${a.profile_name}${groupScripts ? ` · ${groupScripts}` : ''}` : groupScripts;
      return {
        id: a.id, account: a.label, name: a.display_name || a.label, display_name: a.display_name || '', login: a.login || '', where: a.platform === 'MT5' ? a.server || '' : a.environment === 'live' ? 'Live' : 'Demo', firm: a.firm || '', model: a.model || '', platform: a.platform, group: g?.name || '',
        plan: a.plan && a.plan !== 'none' ? [planFirm(a.plan), STAGE_LABELS[a.stage]].filter(Boolean).join(' ') : '', profile: script, preset_id: a.preset_id || '', balance: r2(balance), pnl: r2(balance - start), start: r2(start),
        status: (a.status || 'active'), paused: !!a.paused, stage: a.stage || '', auto_withdraw: !!a.auto_withdraw,
      };
    });
    const kpis = {
      active: rows.filter((x) => x.status === 'active' && !x.paused).length,
      passed: rows.filter((x) => x.status === 'passed').length,
      failed: rows.filter((x) => x.status === 'failed').length,
      net: r2(rows.reduce((s, x) => s + x.pnl, 0)),
    };
    return { rows, kpis, presets: loadPresets(), notify_url: cfg.notify_url ? `${cfg.notify_url.slice(0, 30)}…` : '' };
  }

  return {
    view,
    notify,
    // Create an account from a profile, or apply a profile to an existing one (its balance and trades stay)
    async deploy(b) {
      const p = findPreset(b?.preset_id);
      if (!p) throw bad('Pick a firm, model and size that has a profile');
      const platform = String(b.platform || 'MT5');
      const info = loadPresets();
      if (info.platforms.find((x) => x.id === platform)?.unsupported) throw bad(info.platforms.find((x) => x.id === platform).unsupported);
      const fields = presetFields(p, info.firms[p.firm]);
      let acc;
      if (b.account_id) {
        acc = await run('TradingAccount', 'get', String(b.account_id));
        const { start_balance: _s, ...keep } = fields;
        acc = await run('TradingAccount', 'update', acc.id, { ...keep, ...(acc.start_balance ? {} : { start_balance: p.size, balance: p.size }) });
      } else {
        const taken = (await run('TradingAccount', 'filter', {})).map((a) => a.label);
        const label = String(b.label || '').trim() || accountId(p, taken);
        acc = await run('TradingAccount', 'create', {
          ...fields, label, platform, status: 'active', balance: p.size, peak_eod: p.size,
          ...(b.login ? { login: String(b.login) } : {}), ...(b.server ? { server: String(b.server) } : {}),
          ...(b.group_id ? { group_id: String(b.group_id) } : {}), auto_withdraw: p.stage === 'funded',
        });
      }
      fs.writeFileSync(path.join(dir, `${acc.label}.set`), setFile(p));
      log(`fleet: ${acc.label} set to ${p.id} on ${platform}`);
      return { account: acc, preset: p, set_file: `/api/fleet/set/${encodeURIComponent(acc.label)}` };
    },
    setPath: (label) => path.join(dir, `${path.basename(String(label))}.set`),
    async pause(id, paused) {
      return run('TradingAccount', 'update', String(id), { paused: !!paused });
    },
    audit: (id) => payouts.audit(id),
    settings(b) {
      const url = String(b?.notify_url ?? '').trim();
      if (url && !/^https:\/\/(discord(app)?\.com\/api\/webhooks\/|api\.telegram\.org\/bot)/.test(url)) throw bad('Paste a Discord webhook URL or a Telegram sendMessage URL');
      cfg = { ...cfg, notify_url: url };
      fs.writeFileSync(cfgFile, JSON.stringify(cfg));
      return { ok: true };
    },
  };
}
