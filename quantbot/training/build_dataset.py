"""Build the fine-tuning dataset for QuantBot's local model (Qwen2.5-Coder 7B).

Every example is one full chat in the exact shape the app sends to Ollama: the app's system prompt, the app's tool
list, a user request, the model's tool calls, the real tool results and the final answer.

Backtest examples are REAL: each script is run on the MT5 data and the tool result is its actual output, so the
final answer only quotes measured numbers. Some examples start with a buggy script, show the real traceback, then
fix it (teaches the run-and-fix loop). Port examples (Pine v6, MQL5, NinjaScript) are templates: they are marked
meta.verified = false because no compiler runs here.

Usage:
  node training/export_prompt.mjs > training/dataset/prompt.json
  python3 training/build_dataset.py --data <folder with XAUUSD_H1*.csv> [--out training/dataset/quantbot-sft.jsonl]
"""
import argparse, glob, gzip, json, os, random, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.join(HERE, '..', 'server', 'skills')
random.seed(7)
DATA_SHOWN = 'C:/QuantBot/data'   # the path the model sees in tool results (the real one is machine specific)


def skill(name):
    text = open(os.path.join(SKILLS, f'{name}.md'), encoding='utf8').read()
    m = re.match(r'^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$', text)
    return (m.group(1) if m else text).strip()


def call(name, args):
    return {'role': 'assistant', 'content': '', 'tool_calls': [{'type': 'function', 'function': {'name': name, 'arguments': args}}]}


def result(name, content):
    return {'role': 'tool', 'name': name, 'content': content if isinstance(content, str) else json.dumps(content)}


# ---------- the backtest script the model writes ----------
HEAD = '''import os, sys, glob, json, numpy as np, pandas as pd
SLIP, COMM, PV = 0.20, 1.50, 10.0   # MGC: $/oz slippage per side, $ commission per round trip, $ per $1 move
path = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob(os.path.join(os.environ.get('QB_DATA', '.'), '*XAUUSD*H1*.csv')))[0]
df = pd.read_csv(path, sep='\\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)  # broker -> New York
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
b = b[b.index.weekday < 5]
pc = b.c.shift(1)
b['atr'] = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs())).rolling(14).mean()
'''

TAIL = '''
def backtest(b, side, k, flat_min=16*60+40):
    """side decided on each bar's close; entry next bar's open; trailing stop k*ATR; stop checked first; flat 16:40 ET; one trade a day"""
    o, h, l, c, a = (b[x].values for x in ('o', 'h', 'l', 'c', 'atr'))
    mins = (b.index.hour * 60 + b.index.minute).values; day = b.index.normalize().values
    out, i, n, last = [], 0, len(c), None
    while i < n - 1:
        s = side[i]
        if s == 0 or not a[i] > 0 or day[i] == last or day[i + 1] != day[i] or mins[i + 1] > flat_min: i += 1; continue
        e = o[i + 1] + s * SLIP; stop = e - s * k * a[i]; best = e; j = i + 1; ex = None
        while j < n and day[j] == day[i] and mins[j] <= flat_min:
            if (s > 0 and l[j] <= stop) or (s < 0 and h[j] >= stop): ex = stop - s * SLIP; break
            best = max(best, h[j]) if s > 0 else min(best, l[j])
            stop = max(stop, best - k * a[j]) if s > 0 else min(stop, best + k * a[j])
            j += 1
        if ex is None: ex = c[j - 1] - s * SLIP
        out.append((b.index[i], (ex - e) * s * PV - COMM)); last = day[i]; i = j + 1
    return pd.DataFrame(out, columns=['t', 'usd']).set_index('t').usd

assert side.shape[0] == len(b)
r = backtest(b, side, K)
def part(x):
    return {'trades': int(len(x)), 'win_pct': round(100 * float((x > 0).mean()), 1) if len(x) else 0.0, 'usd': round(float(x.sum()), 0),
            'avg_trade': round(float(x.mean()), 2) if len(x) else 0.0}
y = r.index.year
res = {'strategy': NAME, 'bars': len(b), 'from': str(b.index[0].date()), 'to': str(b.index[-1].date()),
       'choose_2004_2011': part(r[(y >= 2004) & (y <= 2011)]), 'choose_2012_2018': part(r[(y >= 2012) & (y <= 2018)]),
       'check_2019_2025': part(r[(y >= 2019) & (y <= 2025)]), 'grade_2026': part(r[y == 2026]),
       'all': part(r), 'losing_years': int((r.groupby(y).sum() < 0).sum()), 'years': int(len(set(y)))}
print(json.dumps(res, indent=1))
'''

FAMILIES = {
    'ema_cross': {
        'grid': [(f, s) for f, s in [(9, 21), (13, 55), (20, 50), (21, 89), (50, 200), (8, 34)]],
        'name': lambda p: f'EMA {p[0]}/{p[1]} cross',
        'code': lambda p: f'''f = b.c.ewm(span={p[0]}, adjust=False).mean(); s = b.c.ewm(span={p[1]}, adjust=False).mean()
up = (f > s) & (f.shift(1) <= s.shift(1)); dn = (f < s) & (f.shift(1) >= s.shift(1))
side = np.where(up, 1, np.where(dn, -1, 0)) * LONG_SHORT''',
        'ask': ['an EMA {0}/{1} crossover', 'a {0} and {1} EMA cross', 'fast EMA {0} crossing slow EMA {1}'],
    },
    'donchian': {
        'grid': [(n,) for n in (10, 20, 24, 48, 55)],
        'name': lambda p: f'Donchian {p[0]}-bar breakout',
        'code': lambda p: f'''hi = b.h.rolling({p[0]}).max().shift(1); lo = b.l.rolling({p[0]}).min().shift(1)   # previous {p[0]} bars only
side = np.where(b.c > hi, 1, np.where(b.c < lo, -1, 0)) * LONG_SHORT''',
        'ask': ['a {0}-bar Donchian channel breakout', 'a breakout of the last {0} hours high/low', 'a {0}-period channel break'],
    },
    'rsi_revert': {
        'grid': [(n, lo) for n in (2, 7, 14) for lo in (10, 20, 30)],
        'name': lambda p: f'RSI({p[0]}) reversion {p[1]}/{100 - p[1]}',
        'code': lambda p: f'''d = b.c.diff(); g = d.clip(lower=0).ewm(alpha=1/{p[0]}, adjust=False).mean(); ls = (-d.clip(upper=0)).ewm(alpha=1/{p[0]}, adjust=False).mean()
rsi = 100 - 100 / (1 + g / ls.replace(0, np.nan))
side = np.where(rsi < {p[1]}, 1, np.where(rsi > {100 - p[1]}, -1, 0)) * LONG_SHORT''',
        'ask': ['an RSI {0} mean reversion (buy under {1}, sell over 100-{1})', 'RSI({0}) oversold {1} / overbought fade', 'a {0}-period RSI reversal at {1}'],
    },
    'bollinger': {
        'grid': [(n, k) for n in (20, 50) for k in (2.0, 2.5, 3.0)],
        'name': lambda p: f'Bollinger {p[0]},{p[1]} fade',
        'code': lambda p: f'''m = b.c.rolling({p[0]}).mean(); sd = b.c.rolling({p[0]}).std()
side = np.where(b.c < m - {p[1]} * sd, 1, np.where(b.c > m + {p[1]} * sd, -1, 0)) * LONG_SHORT''',
        'ask': ['a Bollinger band ({0}, {1}) fade', 'fading closes outside {1} standard deviations of the {0}-bar mean', 'a {0}/{1} Bollinger reversal'],
    },
    'session_break': {
        'grid': [(h,) for h in (3, 8, 9, 10)],
        'name': lambda p: f'break of the overnight range at {p[0]}:00 ET',
        'code': lambda p: f'''day = b.index.normalize(); hr = b.index.hour
pre = b[hr < {p[0]}]; rh = pre.h.groupby(pre.index.normalize()).max(); rl = pre.l.groupby(pre.index.normalize()).min()
rh = pd.Series(day.map(rh), index=b.index); rl = pd.Series(day.map(rl), index=b.index)
ok = hr >= {p[0]}   # range is finished before these bars
side = np.where(ok & (b.c > rh), 1, np.where(ok & (b.c < rl), -1, 0)) * LONG_SHORT''',
        'ask': ['a breakout of the range from midnight to {0}:00 New York', 'an overnight-range break after {0}am ET', 'trading the break of the pre-{0}:00 range'],
    },
}

ASKS = [
    'Backtest {what} on gold H1 with a {k} ATR trailing stop.',
    'Can you test {what} on XAUUSD 1-hour bars? Use a {k}x ATR trail.',
    'Write and run a Python backtest for {what} on gold, {k} ATR trailing stop, MGC costs.',
    'Does {what} make money on gold after costs? Hourly bars, trail {k} ATR.',
    'I want to know if {what} works on XAUUSD. Test it properly with a {k} ATR stop.',
]


def script(fam, p, k, long_only, bug=None):
    f = FAMILIES[fam]
    sig = f['code'](p).replace('LONG_SHORT', '1')
    if long_only: sig += '\nside = np.where(side > 0, 1, 0)   # long only'
    code = HEAD + '\n' + sig + f"\nside = np.nan_to_num(np.asarray(side, dtype=float))\nNAME, K = {json.dumps(f['name'](p) + (' long only' if long_only else ''))}, {k}\n" + TAIL
    if bug == 'column': code = code.replace("b.c", "b.close", 2)
    if bug == 'lookahead': code = code.replace("side = np.nan_to_num", "side = np.roll(np.nan_to_num(np.asarray(side, dtype=float)), -1)   # BUG\nside = np.nan_to_num", 1)
    return code


def run(code, data_dir):
    with tempfile.TemporaryDirectory() as ws:
        os.makedirs(os.path.join(ws, 'scripts'))
        fp = os.path.join(ws, 'scripts', 'backtest.py')
        open(fp, 'w').write(code)
        p = subprocess.run([sys.executable, fp], cwd=ws, capture_output=True, text=True, timeout=600,
                           env={**os.environ, 'QB_DATA': data_dir, 'PYTHONIOENCODING': 'utf-8'})
        out = (p.stdout + p.stderr)[-12000:]
        out = out.replace(ws, '.').replace(data_dir, DATA_SHOWN)
        return {'exit_code': p.returncode, 'file': 'scripts/backtest.py', 'data_dir': DATA_SHOWN, 'output': out}


def verdict(res):
    a, b, c = res['choose_2004_2011'], res['choose_2012_2018'], res['check_2019_2025']
    held = a['usd'] > 0 and b['usd'] > 0 and c['usd'] > 0
    lines = [f"**{res['strategy']}** on gold H1, {res['from']} to {res['to']}, 1 MGC, $0.20/oz slippage each side and $1.50 commission:",
             '', '| Period | Trades | Win % | Net $ | Avg trade $ |', '|---|---|---|---|---|']
    for lab, key in (('2004-2011 (choose)', 'choose_2004_2011'), ('2012-2018 (choose)', 'choose_2012_2018'),
                     ('2019-2025 (check)', 'check_2019_2025'), ('2026 (grade)', 'grade_2026'), ('All', 'all')):
        x = res[key]; lines.append(f"| {lab} | {x['trades']} | {x['win_pct']} | {x['usd']:,.0f} | {x['avg_trade']} |")
    lines.append('')
    lines.append(f"Losing years: {res['losing_years']} of {res['years']}.")
    if held:
        lines.append('It made money in both choose halves and in the check years. That is one test of one setting: before trusting it, '
                     'check the neighbouring settings also hold, and run the prop-account simulation on the daily sums.')
    else:
        bad = [n for n, x in (('2004-2011', a), ('2012-2018', b), ('2019-2025', c)) if x['usd'] <= 0]
        lines.append(f"It does **not** pass: it lost money in {', '.join(bad)} after costs. I would not trade it. "
                     'Changing settings until it looks good would be curve fitting.')
    return '\n'.join(lines), held


def backtest_examples(data_dir, limit):
    jobs = []
    for fam, f in FAMILIES.items():
        for p in f['grid']:
            for k in (1.0, 1.5, 2.5):
                for lo in (0, 1):
                    jobs.append((fam, p, k, lo))
    random.shuffle(jobs)
    out = []
    for n, (fam, p, k, lo) in enumerate(jobs[:limit]):
        f = FAMILIES[fam]
        what = random.choice(f['ask']).format(*p) + (', long only' if lo else '')
        user = random.choice(ASKS).format(what=what, k=k)
        bug = random.choice(['column', 'lookahead']) if random.random() < 0.15 else None
        msgs = [{'role': 'user', 'content': user},
                call('load_skill', {'name': 'python-backtest'}), result('load_skill', skill('python-backtest'))]
        if bug:
            bad = script(fam, p, k, lo, bug)
            r = run(bad, data_dir)
            msgs += [call('run_python', {'file': 'backtest', 'code': bad}), result('run_python', r)]
            if bug == 'column':
                if r['exit_code'] == 0: continue
                msgs.append({'role': 'assistant', 'content': 'The script failed: the close column is `c`, not `close`. Fixing and running again.'})
            else:
                msgs.append({'role': 'assistant', 'content': 'Before reporting I checked the signal line: `np.roll(..., -1)` shifts every signal one bar earlier, '
                                                              'so each trade uses the next bar\'s close. That is look-ahead and the numbers above are fake. Removing it and running again.'})
        code = script(fam, p, k, lo)
        r = run(code, data_dir)
        if r['exit_code'] != 0: print('FAILED', fam, p, k, lo, r['output'][-400:], file=sys.stderr); continue
        res = json.loads(r['output'][r['output'].index('{'):])
        text, held = verdict(res)
        msgs += [call('run_python', {'file': 'backtest', 'code': code}), result('run_python', r), {'role': 'assistant', 'content': text}]
        out.append({'messages': msgs, 'meta': {'kind': 'backtest', 'verified': True, 'strategy': res['strategy'], 'k': k, 'bug': bug, 'held': held}})
        if n % 20 == 0: print(f'backtest {n}/{min(limit, len(jobs))}', file=sys.stderr)
    return out


# ---------- sizing / prop maths (exact) ----------
CONTRACTS = {'MGC': 10, 'GC': 100, 'MNQ': 2, 'NQ': 20, 'MES': 5, 'ES': 50}
ACCOUNTS = {'25K': (1000, 600, 20), '50K': (2000, 1200, 40), '100K': (3000, 1800, 60), '150K': (4500, 2700, 100)}


def sizing_examples(n):
    out = []
    for _ in range(n):
        sym = random.choice(list(CONTRACTS)); pv = CONTRACTS[sym]
        risk = random.choice([100, 150, 200, 250, 300, 400, 500, 600])
        stop = random.choice([2, 3, 4.5, 5, 6, 8, 10, 12.5, 15, 20, 25, 40]) if sym.endswith(('GC',)) else random.choice([5, 8, 10, 12, 15, 20, 25, 30, 40, 50])
        acct = random.choice(list(ACCOUNTS)); maxl, dll, cap = ACCOUNTS[acct]
        per = stop * pv
        qty = int(risk // per)
        cap_n = cap if sym.startswith('M') else cap // 10
        q = min(qty, cap_n)
        lines = [f'One {sym} moves ${pv} per 1.00 point, so a {stop}-point stop risks {stop} x ${pv} = **${per:,.2f} per contract**.',
                 f'${risk} / ${per:,.2f} = {risk / per:.2f}, rounded down: **{qty} contract{"s" if qty != 1 else ""}**.']
        if qty == 0: lines.append(f'Even 1 contract risks more than ${risk}. Use a tighter stop or a smaller contract, or skip the trade.')
        if qty > cap_n: lines.append(f'The Lucid {acct} cap is {cap_n} {sym}, so trade {q}.')
        if q:
            lines.append(f'Full stop-out costs ${q * per:,.0f} plus slippage and commission: {q * per / dll * 100:.0f}% of the ${dll:,} daily loss limit '
                         f'and {q * per / maxl * 100:.0f}% of the ${maxl:,} max loss. '
                         + ('That is too much for one trade; size down.' if q * per > dll / 2 else 'That leaves room for more losers that day.'))
        out.append({'messages': [{'role': 'user', 'content': f'How many {sym} can I trade on a Lucid {acct} with a {stop} point stop if I want to risk ${risk}?'},
                                 {'role': 'assistant', 'content': '\n'.join(lines)}],
                    'meta': {'kind': 'sizing', 'verified': True}})
    for _ in range(max(4, n // 4)):
        t, l = random.choice([(3000, 2000), (1250, 1000), (6000, 3000), (9000, 4500)])
        p = l / (t + l)
        out.append({'messages': [{'role': 'user', 'content': f'With no edge, what are the odds I hit +${t:,} before -${l:,}?'},
                                 {'role': 'assistant', 'content': f'With no edge (a fair random walk) the chance of reaching +T before -L is L / (T + L) = {l:,} / {t + l:,} = **{p * 100:.0f}%**. '
                                                                  f'Costs push it lower. A bigger size does not change this; only a real edge does.'}]},)
        out[-1]['meta'] = {'kind': 'prop-math', 'verified': True}
    return out


# ---------- ports (templates, not compiled here) ----------
def pine(f, s, k):
    return f'''//@version=6
indicator("EMA {f}/{s} trend + {k} ATR trail", overlay = true)
fastLen = input.int({f}, "Fast EMA")
slowLen = input.int({s}, "Slow EMA")
atrMult = input.float({k}, "ATR trail", step = 0.1)
riskUsd = input.float(200, "Risk $")
pointValue = input.float(10, "$ per point (MGC 10, GC 100)")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
atr = ta.atr(14)
longSig = ta.crossover(fast, slow) and barstate.isconfirmed
var float stopLine = na
if longSig
    stopLine := close - atrMult * atr
else if not na(stopLine)
    stopLine := math.max(stopLine, close - atrMult * atr)
    if close < stopLine
        stopLine := na
qty = math.floor(riskUsd / (atrMult * atr * pointValue))
plot(fast, "Fast", color.new(color.teal, 0))
plot(slow, "Slow", color.new(color.orange, 0))
plot(stopLine, "Trail", color.red, style = plot.style_linebr)
plotshape(longSig, "Long", shape.triangleup, location.belowbar, color.teal, text = "L")
if longSig
    label.new(bar_index, low, "Buy " + str.tostring(qty) + " | stop " + str.tostring(close - atrMult * atr, format.mintick), style = label.style_label_up)
alertcondition(longSig, "Long signal", "EMA {f}/{s} long: enter next bar open")
'''


def mql5(f, s, k):
    return f'''#property strict
#include <Trade/Trade.mqh>
input int    FastLen = {f};
input int    SlowLen = {s};
input double AtrMult = {k};
input double Lots    = 0.01;
CTrade trade;
int hFast, hSlow, hAtr;
int OnInit() {{
   hFast = iMA(_Symbol, PERIOD_CURRENT, FastLen, 0, MODE_EMA, PRICE_CLOSE);
   hSlow = iMA(_Symbol, PERIOD_CURRENT, SlowLen, 0, MODE_EMA, PRICE_CLOSE);
   hAtr  = iATR(_Symbol, PERIOD_CURRENT, 14);
   return (hFast == INVALID_HANDLE || hSlow == INVALID_HANDLE || hAtr == INVALID_HANDLE) ? INIT_FAILED : INIT_SUCCEEDED;
}}
void OnTick() {{
   static datetime lastBar = 0;
   datetime t = iTime(_Symbol, PERIOD_CURRENT, 0);
   if (t == lastBar) return;               // act once per new bar, on closed bars only
   lastBar = t;
   double f[2], s[2], a[1];
   if (CopyBuffer(hFast, 0, 1, 2, f) < 2 || CopyBuffer(hSlow, 0, 1, 2, s) < 2 || CopyBuffer(hAtr, 0, 1, 1, a) < 1) return;
   // f[1], s[1] = last closed bar; f[0], s[0] = the bar before it
   bool crossUp = f[0] <= s[0] && f[1] > s[1];
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if (!PositionSelect(_Symbol)) {{
      if (crossUp) trade.Buy(Lots, _Symbol, ask, ask - AtrMult * a[0], 0.0, "EMA cross");
      return;
   }}
   double newSl = NormalizeDouble(bid - AtrMult * a[0], _Digits);
   if (newSl > PositionGetDouble(POSITION_SL)) trade.PositionModify(_Symbol, newSl, 0.0);
}}
'''


def ninja(f, s, k):
    return f'''// NinjaScript strategy (NinjaTrader 8). Tradovate has no scripting language for strategies; NinjaTrader can route to it.
namespace NinjaTrader.NinjaScript.Strategies
{{
    public class EmaTrail{f}x{s} : Strategy
    {{
        private EMA fast, slow;
        private ATR atr;
        protected override void OnStateChange()
        {{
            if (State == State.SetDefaults)
            {{
                Name = "EmaTrail{f}x{s}";
                Calculate = Calculate.OnBarClose;    // decisions on closed bars only
                IsExitOnSessionCloseStrategy = true;
                ExitOnSessionCloseSeconds = 900;      // flat before the 4:45 PM ET cutoff if the session ends at 5 PM
            }}
            else if (State == State.DataLoaded)
            {{
                fast = EMA({f}); slow = EMA({s}); atr = ATR(14);
            }}
        }}
        protected override void OnBarUpdate()
        {{
            if (CurrentBar < {s}) return;
            if (Position.MarketPosition == MarketPosition.Flat && CrossAbove(fast, slow, 1))
            {{
                SetTrailStop(CalculationMode.Price, Close[0] - {k} * atr[0]);
                EnterLong(1, "L");
            }}
        }}
    }}
}}
'''


def port_examples(prompt_tools):
    out = []
    for f, s in [(13, 55), (9, 21), (20, 50), (21, 89), (50, 200)]:
        for k in (1.5, 2.0):
            for lang, fn, ext, note in (('Pine Script v6 indicator', pine, 'pine', 'Signals only: no strategy() calls, no auto trading. Entries are on confirmed bars, so it does not repaint.'),
                                        ('MQL5 expert advisor', mql5, 'mq5', 'It reads closed bars only (shift 1), so signals do not repaint. Test it in the MT5 strategy tester with "Every tick based on real ticks" before using it.'),
                                        ('NinjaTrader 8 strategy', ninja, 'cs', 'Tradovate itself has no strategy scripting; this runs in NinjaTrader, which can connect to a Tradovate account. Compile it in the NinjaScript editor first.')):
                code = fn(f, s, k)
                user = random.choice([f'Write a {lang} for the EMA {f}/{s} long-only trend with a {k} ATR trailing stop.',
                                      f'Port the EMA {f}/{s} + {k} ATR trail strategy to a {lang}.'])
                path = f'scripts/ema_{f}_{s}.{ext}'
                msgs = [{'role': 'user', 'content': user}]
                if ext == 'pine': msgs += [call('load_skill', {'name': 'pine-v6'}), result('load_skill', skill('pine-v6'))]
                if ext == 'mq5': msgs += [call('load_skill', {'name': 'mql5-ea'}), result('load_skill', skill('mql5-ea'))]
                msgs += [call('workspace_write', {'path': path, 'content': code}), result('workspace_write', {'ok': True, 'path': path}),
                         {'role': 'assistant', 'content': f'Saved `{path}`.\n\n```{ext}\n{code}```\n\n{note} I could not compile it here, so check it compiles before you rely on it.'}]
                out.append({'messages': msgs, 'meta': {'kind': f'port-{ext}', 'verified': False}})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, help='folder holding XAUUSD_H1*.csv')
    ap.add_argument('--prompt', default=os.path.join(HERE, 'dataset', 'prompt.json'))
    ap.add_argument('--out', default=os.path.join(HERE, 'dataset', 'quantbot-sft.jsonl.gz'))
    ap.add_argument('--backtests', type=int, default=400)
    a = ap.parse_args()
    pr = json.load(open(a.prompt, encoding='utf8'))
    names = {t['function']['name'] for t in pr['tools']}
    rows = backtest_examples(os.path.abspath(a.data), a.backtests) + sizing_examples(80) + port_examples(pr['tools'])
    for r in rows:
        for m in r['messages']:
            for tc in m.get('tool_calls', []): assert tc['function']['name'] in names, tc['function']['name']
        r['messages'] = [{'role': 'system', 'content': pr['system']}] + r['messages']
        r['tools'] = pr['tools']
    random.shuffle(rows)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    op = gzip.open if a.out.endswith('.gz') else open
    with op(a.out, 'wt', encoding='utf8') as fh:
        for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    kinds = {}
    for r in rows: kinds[r['meta']['kind']] = kinds.get(r['meta']['kind'], 0) + 1
    print(json.dumps({'rows': len(rows), 'kinds': kinds, 'held': sum(1 for r in rows if r['meta'].get('held')), 'out': a.out}, indent=1))


if __name__ == '__main__':
    main()
