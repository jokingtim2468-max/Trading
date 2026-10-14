// Strategy Converter prompt, task and result shaping.
import { SIGNAL_SPEC, SIGNAL_RULE } from './signals.js';
import { SIM_CONTRACT, marketText, clip } from './simContract.js';
import { QUANT_PLAYBOOK } from './quantKnowledge.js';

const TARGETS = {
  MT5: 'a complete, compilable MetaTrader 5 Expert Advisor in strict MQL5 (#include <Trade\\Trade.mqh>, CTrade, unique magic number, SL and TP on every order, CopyBuffer for indicators, new-bar guard, no MQL4 functions)',
  Pine: 'a complete TradingView Pine Script v5 strategy (//@version=5, strategy() declaration, explicit entries/exits with stop loss and take profit, alert() calls)',
};

export const CONVERTER_SYSTEM = `You are QuantBot's strategy converter and rule auditor. Convert the trader's strategy into the requested platform, write a matching simulation for QuantBot's backtester, and audit the code against every rule the trader gave.
- Output the FULL code file, never truncated, no placeholders.
- ${SIM_CONTRACT}
- The code must follow the DISTINCT SIGNALS standard given in the task, and the mandatory signal rule is always audited.
- Test each rule strictly against the converted code: "pass" if enforced, "fail" if violated or ignored, "warn" if partly enforced or not verifiable from code alone.
- Never invent profit, win rate or drawdown numbers: the simulator measures those.
- If no rules are given, audit general robustness (stop loss present, position sizing, no martingale/grid, no repainting, correct order handling).
- When a previous version and its test log are given, fix every listed issue, keep the core idea, and return the full improved version.
- Use the QUANT PLAYBOOK below: build its best-fit methods into conversions and fixes (ICT confluence entries, ATR-calibrated stops and targets, 3-stage management, prop guards) and use the MARKET STATS to size stops, targets and session filters to the trader's real data.
Respond with ONLY a JSON object, no Markdown fences, shaped exactly:
{"code": string, "sim_code": string, "summary": string, "results": [{"rule": string, "status": "pass"|"fail"|"warn", "detail": string}]}

${QUANT_PLAYBOOK}`;

export const CONVERTER_SCHEMA = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    sim_code: { type: 'string' },
    summary: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { rule: { type: 'string' }, status: { type: 'string', enum: ['pass', 'fail', 'warn'] }, detail: { type: 'string' } },
      },
    },
  },
};

// Why the request can't be converted, or null
export function converterInputError({ strategy, rules, target }) {
  if (!strategy?.trim()) return 'Paste a strategy first';
  if (strategy.length > 40000 || (rules || '').length > 10000) return 'Strategy or rules too long';
  if (!TARGETS[target]) return 'Target must be MT5 or Pine';
  return null;
}

export function converterTask({ strategy, rules, target, market, previous }) {
  let task = `Convert this strategy into ${TARGETS[target]}.\n${SIGNAL_SPEC[target]}\n${marketText(market)}\n\nSTRATEGY:\n${strategy}\n\nRULES TO TEST AGAINST:\n1. (mandatory) ${SIGNAL_RULE}\n${rules?.trim() || '(no other rules given)'}`;
  if (previous) {
    task += `\n\nPREVIOUS VERSION CODE:\n${clip(previous.code, 60000)}\n\nPREVIOUS SIM CODE:\n${clip(previous.sim_code, 20000)}\n\nTEST LOG AND ISSUES TO FIX:\n${clip(previous.fix_prompt, 15000)}`;
  }
  return task;
}

export const converterResult = (report) => ({
  code: String(report.code || ''),
  sim_code: String(report.sim_code || ''),
  summary: String(report.summary || ''),
  results: Array.isArray(report.results) ? report.results : [],
});