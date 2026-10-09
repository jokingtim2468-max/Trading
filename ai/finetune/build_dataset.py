"""Build a Llama fine-tuning dataset (chat JSONL) for the Day Range Predictor.

Three kinds of examples, all in the exact prompt format the AI service uses, so the trained model
drops straight into Ollama:

1. news   Real past headlines from Google News (one search per trading day) labelled with what
          Nasdaq e-mini and gold futures actually did that day (open to close, in daily ATRs,
          bucketed to -2..+2). End-of-day recap headlines ("stocks close higher"...) are removed
          because they would give away the answer.
2. range  10 years of 6 PM-open snapshots (open, previous day, ATR, the fixed-line model's call) with
          the day's actual high and low as the answer.
3. system Questions and answers about how this system works and how well it has tested.

The most recent 20% of days go to val.jsonl and are never trained on, so ai/finetune/eval_news.py
can compare the base and the fine-tuned model fairly.

    python ai/finetune/build_dataset.py            # 2500 trading days (~10 years) of headlines
Writes ai/finetune/data/train.jsonl, val.jsonl and stats.json.
"""

import argparse
import concurrent.futures as cf
import datetime as dt
import email.utils
import json
import random
import re
import sys
import time
import urllib.parse
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
import train_drp as T  # noqa: E402
from ai import llm, news  # noqa: E402

OUT = ROOT / "ai/finetune/data"
QUERIES = {
    "NQ": "Nasdaq OR stocks OR \"Federal Reserve\" OR inflation OR \"Treasury yields\" OR earnings",
    "GC": "gold price OR \"gold futures\" OR \"Federal Reserve\" OR dollar OR inflation",
}
RECAP = re.compile(r"stock market today|stocks? (close|closed|end|ended|finish|finished|settle)|"
                   r"\b(closes?|closed|ends?|ended|finish(es|ed)?|settles?|settled)\b.*\b(higher|lower|up|down|gains?|loss(es)?)\b|"
                   r"(wrap|recap|week in review|weekly)|how (major )?(us )?stock indexes fared|"
                   r"\btoday'?s\b.*\b(rally|selloff|sell-off|drop)\b|midday|sector update|"
                   r"(morning|afternoon|monday|tuesday|wednesday|thursday|friday) (update|trading|session)|"
                   r"pre-?market|pre-bell|futures (rise|fall|climb|slip|edge|gain|drop|jump|sink|tumble|rally|point)|"
                   r"(stocks|nasdaq|s&p|dow|gold)( \d+)? (rise|rises|fall|falls|jump|jumps|slip|slips|drop|drops|rally|rallies|"
                   r"sink|sinks|tumble|tumbles|surge|surges|climb|climbs|gain|gains|retreat|retreats|edge|edges)", re.I)
PRESS = re.compile(r"rings the nasdaq|announces|appoints|names .* (director|ceo|cfo)|to present at|"
                   r"conference call|webcast|declares (quarterly )?dividend|files (form|8-k)|joins .* index", re.I)
MACRO = re.compile(r"\bfed\b|federal reserve|powell|rate (cut|hike)|inflation|\bcpi\b|\bpce\b|payrolls|jobs report|"
                   r"unemployment|yields?|treasur|tariff|war\b|sanction|recession|gdp|nvidia|apple|microsoft|"
                   r"amazon|alphabet|meta\b|tesla|dollar|geopolit|iran|china|opec", re.I)
# a headline must talk about markets or the economy to be a useful example (drops "Gold medal..." etc.)
MARKET = re.compile(r"stock|share|nasdaq|s&p|dow\b|market|wall street|futures|index|equit|bond|yield|treasur|"
                    r"\bfed\b|federal reserve|rate|inflation|\bcpi\b|jobs|payroll|economy|economic|gdp|recession|"
                    r"earnings|revenue|guidance|dollar|currenc|tariff|trade war|oil|gold (price|futures|rall|prices)|"
                    r"bullion|precious metal|investor|trader|rall(y|ies)|sell-?off|crash|volatil", re.I)
RANGE_SYSTEM = ("You predict the high and low of a trading session (full day, regular session or after-market) for "
                "Nasdaq 100 or gold from a snapshot taken when the session's lines are locked. Answer only JSON: {\"high\": number, \"low\": number}.")
QA_SYSTEM = ("You are the assistant inside the Day Range Predictor trading tools (MT5 EA, TradingView script, "
             "local AI service). Answer plainly and honestly. Never promise profits.")


def bucket(z):
    return -2 if z <= -0.8 else -1 if z <= -0.25 else 0 if z < 0.25 else 1 if z < 0.8 else 2


def day_moves(key):
    d = T.yahoo(T.MARKETS[key]["yahoo"], "10y", "1d")[["o", "h", "l", "c"]]
    d.index = d.index.date
    tr = np.maximum(d.h, d.c.shift()) - np.minimum(d.l, d.c.shift())
    atr = tr.rolling(20).mean().shift()
    return ((d.c - d.o) / atr).dropna()


CACHE = ROOT / "ai/finetune/cache/headlines"


def fetch_day(key, day, per_query):
    """Headlines for one market and day. Cached on disk, so re-running the builder is cheap."""
    path = CACHE / key / f"{day}.json"
    if path.exists():
        return json.loads(path.read_text())[:per_query]
    out = _fetch_day(key, day)
    if out is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out))
    return (out or [])[:per_query]


def _fetch_day(key, day):
    q = f"{QUERIES[key]} after:{day} before:{day + dt.timedelta(days=1)}"
    url = f"https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl=en-US&gl=US&ceid=US:en"
    for attempt in range(3):
        try:
            root = news.ET.fromstring(news._get(url))
            break
        except Exception:
            time.sleep(2 + 3 * attempt)
    else:
        return None
    out = []
    for it in root.findall(".//item"):
        title = re.sub(r"\s+-\s+[^-]+$", "", (it.findtext("title") or "").strip())   # drop " - Publisher"
        pub = it.findtext("pubDate")
        try:
            pday = email.utils.parsedate_to_datetime(pub).date()
        except (TypeError, ValueError):
            continue
        if pday != day or not title or RECAP.search(title):
            continue
        out.append(title)
    random.Random(f"{key}{day}").shuffle(out)
    return out[:40]


def news_examples(days, per_query, workers=4):
    moves = {k: day_moves(k) for k in ("NQ", "GC")}
    jobs = [(k, d) for d in days for k in ("NQ", "GC")]
    rows, seen = [], set()
    with cf.ThreadPoolExecutor(workers) as ex:
        for done, ((k, d), titles) in enumerate(zip(jobs, ex.map(lambda j: fetch_day(j[0], j[1], per_query), jobs)), 1):
            if done % 250 == 0:
                print(f"  headlines: {done}/{len(jobs)} day searches, {len(rows)} examples", flush=True)
            if d not in moves["NQ"].index or d not in moves["GC"].index:
                continue
            for t in titles:
                if t.lower() in seen or not MARKET.search(t):
                    continue
                seen.add(t.lower())
                rel = 0 if PRESS.search(t) else 3 if MACRO.search(t) else 1
                ans = {"nasdaq": bucket(moves["NQ"][d]), "gold": bucket(moves["GC"][d]), "relevance": rel}
                if rel == 0:
                    ans.update(nasdaq=0, gold=0)
                rows.append({"day": str(d), "kind": "news", "messages": [
                    {"role": "system", "content": llm.SYSTEM},
                    {"role": "user", "content": t},
                    {"role": "assistant", "content": json.dumps(ans)}]})
    return rows


def range_examples(key, train_until):
    """10 years of 6 PM-open snapshots with the fixed-line model's call and the day's real high and low.
    The fixed model is fitted only on days before `train_until`, so validation days stay unseen."""
    from ai import fixed_model as FM
    d = T.yahoo(T.MARKETS[key]["yahoo"], "10y", "1d")[["o", "h", "l", "c"]]
    d.index = d.index.date
    coef = FM.train(d, before=train_until, years=10)
    F, up, dn, atr = FM.features(d)
    ok = F.notna().all(axis=1) & atr.notna()
    name = "NQ (Nasdaq 100 e-mini)" if key == "NQ" else "GC (gold futures)"
    rows = []
    for i, day in enumerate(d.index):
        if i < 1 or not ok.get(day, False):
            continue
        p = d.iloc[i - 1]
        hi, lo, a = FM.lines(d, day, coef)
        prompt = (f"{name}, trading day {pd.Timestamp(day):%a %Y-%m-%d}. Lines are locked at the 6 PM New York open "
                  f"and cover overnight, the regular session and after-hours to 5 PM. Open {d.o.iloc[i]:,.2f}. "
                  f"Previous day: high {p.h:,.2f}, low {p.l:,.2f}, close {p.c:,.2f}. Daily ATR {a:,.1f}. "
                  f"5-day / 20-day range ratio {F.loc[day, 'r5']:.2f}. Fixed-line model: high {hi:,.2f}, low {lo:,.2f}. "
                  f"Predict the day's final high and low.")
        ans = {"high": round(float(d.h.iloc[i]), 2), "low": round(float(d.l.iloc[i]), 2)}
        rows.append({"day": str(day), "kind": "range", "messages": [
            {"role": "system", "content": RANGE_SYSTEM}, {"role": "user", "content": prompt},
            {"role": "assistant", "content": json.dumps(ans)}]})
    return rows


def session_examples(train_until):
    """Nasdaq regular session (locked at 9:30, 10 years of ^NDX) and after-market (locked at 4 PM, ~2 years)."""
    from ai import fixed_model as FM, session_model as S
    rows = []
    nd = S.rth_daily(T.yahoo)
    coef = FM.train(nd, before=train_until, years=10)
    F, _, _, atr = FM.features(nd)
    ok = F.notna().all(axis=1) & atr.notna()
    for i, day in enumerate(nd.index):
        if i < 1 or not ok.get(day, False):
            continue
        p = nd.iloc[i - 1]
        hi, lo, a = FM.lines(nd, day, coef)
        prompt = (f"Nasdaq 100 regular session (9:30 AM to 4:00 PM New York), {pd.Timestamp(day):%a %Y-%m-%d}. "
                  f"Lines are locked at the 9:30 open. Open {nd.o.iloc[i]:,.2f}, gap from yesterday's close "
                  f"{nd.o.iloc[i] - p.c:+,.2f}. Yesterday's session: high {p.h:,.2f}, low {p.l:,.2f}, close {p.c:,.2f}. "
                  f"Daily ATR {a:,.1f}. Regular-session model: high {hi:,.2f}, low {lo:,.2f}. "
                  f"Predict the session's final high and low.")
        rows.append({"day": str(day), "kind": "range", "messages": [
            {"role": "system", "content": RANGE_SYSTEM}, {"role": "user", "content": prompt},
            {"role": "assistant", "content": json.dumps({"high": round(float(nd.h.iloc[i]), 2), "low": round(float(nd.l.iloc[i]), 2)})}]})
    d = T.yahoo("NQ=F", "10y", "1d")[["o", "h", "l", "c"]]
    d.index = d.index.date
    t = S.ah_table(T.yahoo("NQ=F", "730d", "1h"), d)
    for day, r in t.iterrows():
        hi, lo, a = S.ah_lines(t, day)                          # untrained median lines (they tested as good as trained)
        prompt = (f"Nasdaq 100 e-mini after-market (4 PM to 9 AM New York), starting {pd.Timestamp(day):%a %Y-%m-%d}. "
                  f"Lines are locked at the 4 PM close. Price at 4 PM {r.o:,.2f}. Regular session range "
                  f"{r.rth_rng * a:,.1f} points, close at {r.rth_loc:.0%} of that range. Daily ATR {a:,.1f}. "
                  f"After-market median lines: high {hi:,.2f}, low {lo:,.2f}. Predict the after-market high and low.")
        rows.append({"day": str(day), "kind": "range", "messages": [
            {"role": "system", "content": RANGE_SYSTEM}, {"role": "user", "content": prompt},
            {"role": "assistant", "content": json.dumps({"high": round(r.H, 2), "low": round(r.L, 2)})}]})
    return rows


def qa_examples():
    m = json.loads((ROOT / "ai/model.json").read_text())
    nq, gc = m["symbols"]["NQ"], m["symbols"]["GC"]
    pairs = [
        ("What do the green and red day lines mean?",
         "Green is the predicted day high and red is the predicted day low. Each is the high (or low) so far plus the "
         "extra move the day still usually makes, looked up by hour of the day and where price sits in its range. "
         "They update every bar and only use data up to that bar, so they tighten as the day goes on."),
        ("How accurate are the day high and low lines?",
         "On unseen days the Nasdaq lines missed the real high by about 0.08 daily ATR and the low by about 0.10 ATR "
         "when read at the 9:30 session start, and about 0.3 ATR at the 6 PM open. Trend days are the weak spot: on a "
         "+2.8% rally day the 9:30 high was 519 points too low."),
        ("What are the locked lines?",
         "Two lines, one predicted high (green) and one predicted low (red), set once when a session starts and never "
         "moved. Full day: locked at the 6 PM New York futures open, covering overnight, the regular session and "
         "after-hours to 5 PM, trained on 10 years. Regular session: locked at 9:30, covering 9:30 to 4:00, trained on "
         "10 years of the Nasdaq-100 cash index. After-market: locked at the 4 PM close, covering 4 PM to 9 AM."),
        ("How accurate are the locked lines?",
         "On 500 unseen days the full-day Nasdaq lines missed the real high by about 0.28 daily ATR and the low by about "
         "0.35 ATR. The regular-session lines missed by about 0.25 and 0.32 ATR, with 62% of days inside 0.25 ATR on the "
         "high. The after-market lines missed by about 0.22 ATR; two years of data wasn't enough for training to beat "
         "the simple median, so they use the median."),
        ("What are the dashed max high and max low lines?",
         "The wide envelope set at the day open: the narrowest percentile of past up/down moves that held at least 95% "
         "of days per side in testing. On unseen days they held about 95% per side and both held about 90% of days."),
        ("What do the green TP and red SL lines show?",
         "For a quick trade of up to one hour, the take-profit (green) and stop-loss (red) for the side the AI leans to. "
         f"For Nasdaq the stop is {nq['short']['slm']}x and the target {nq['short']['tpm']}x the 5-minute ATR; for gold "
         f"{gc['short']['slm']}x and {gc['short']['tpm']}x. Thin dotted lines mean low confidence."),
        ("Is the AI TP/SL profitable?",
         f"Not proven. On unseen 5-minute data the price model picked direction {nq['short']['acc_hold']:.0%} of the time "
         f"on Nasdaq and {gc['short']['acc_hold']:.0%} on gold. After costs Nasdaq was about breakeven "
         f"({nq['short']['hold']['ev']:+.3f} ATR per trade) and gold lost ({gc['short']['hold']['ev']:+.3f} ATR). "
         "Paper trade before risking money."),
        ("Can you be 100% sure about a prediction?",
         "No. Nothing in markets is certain. The tools show measured hit rates so you can see how often each line "
         "really held, and they flag 'no proven edge' when testing found none."),
        ("How does news change the AI's call?",
         "The local Llama model scores recent Yahoo Finance and Google News headlines from -2 to +2 for Nasdaq and "
         "gold. The time-weighted score nudges the price model's probability (news_weight in ai/config.json). "
         "High-impact US events within 30 minutes switch setups off."),
        ("How do I check whether the news actually helps?",
         "Leave ai/service.py running for a few weeks, then run python ai/evaluate.py. It replays every logged call "
         "and compares calls where the news agreed with calls where it didn't. If the news calls aren't clearly "
         "better, set news_weight to 0."),
        ("What sessions do the signals use?",
         "Nasdaq uses the cash session, 09:30 to 16:00 New York. Gold uses London plus New York, 03:00 to 12:00 New York."),
        ("How do I retrain everything on the latest data?",
         "Run train.bat (or python tools/train_drp.py). It downloads fresh Yahoo data, retrains the lines, the "
         "quick-trade model and the presets, and rewrites the trained blocks in the EA and the Pine script. Then "
         "recompile the EA and re-paste the Pine script."),
        ("What colors do the tools use?",
         "Green #00E676 for highs and take-profit, red #FF5252 for lows and stop-loss, yellow #FFD600 for the optional "
         "build-up line, grey #787B86 for the day open, and a dark #131722 panel with #D1D4DC text."),
    ]
    return [{"day": "", "kind": "system", "messages": [{"role": "system", "content": QA_SYSTEM},
                                                       {"role": "user", "content": q}, {"role": "assistant", "content": a}]}
            for q, a in pairs]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=2500, help="how many past trading days of headlines to fetch")
    ap.add_argument("--per-query", type=int, default=15, help="headlines kept per market per day")
    ap.add_argument("--val-share", type=float, default=0.2)
    a = ap.parse_args()
    moves = day_moves("NQ")
    days = [d for d in moves.index if d.weekday() < 5][-a.days:]
    split = days[int(len(days) * (1 - a.val_share))]
    print(f"{len(days)} trading days {days[0]} .. {days[-1]}; validation from {split}")
    rows = news_examples(days, a.per_query)
    print(f"news examples: {len(rows)}")
    for key in ("NQ", "GC"):
        r = range_examples(key, split)
        print(f"{key} range examples: {len(r)}")
        rows += r
    r = session_examples(split)
    print(f"Nasdaq regular-session + after-market examples: {len(r)}")
    rows += r
    qa = qa_examples()
    rows += qa * 5                                              # small set, repeat so it sticks
    train = [r for r in rows if not r["day"] or dt.date.fromisoformat(r["day"]) < split]
    val = [r for r in rows if r["day"] and dt.date.fromisoformat(r["day"]) >= split]
    random.Random(7).shuffle(train)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, part in (("train", train), ("val", val)):
        with (OUT / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for r in part:
                f.write(json.dumps({"messages": r["messages"], "kind": r["kind"], "day": r["day"]}, ensure_ascii=False) + "\n")
    stats = {"built": dt.date.today().isoformat(), "days": [str(days[0]), str(days[-1])], "val_from": str(split),
             "train": {k: sum(r["kind"] == k for r in train) for k in ("news", "range", "system")},
             "val": {k: sum(r["kind"] == k for r in val) for k in ("news", "range", "system")}}
    (OUT / "stats.json").write_text(json.dumps(stats, indent=1))
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
