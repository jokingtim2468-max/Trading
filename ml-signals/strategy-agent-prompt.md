# Prompt: build and properly test the best gold strategy you can

Paste everything below the line into a new coding agent (Claude Code, Cursor, etc.) that can run Python. Attach the
MT5 data files.

---

## Your job

Build the best trading strategy you can for **XAUUSD gold** (traded as MGC/GC micro/mini gold futures on prop firm
accounts), using the MT5 data I give you. You are free to use any idea: trend, mean reversion, breakouts, sessions,
volume, ICT, multi-timeframe, machine learning. **Every script you write must be tested with a command you run
yourself, and every result you report must come from that command's output.** Never report a number you did not
measure.

## The data you have (MT5 exports)

- XAUUSD bars in **M1, M5, M15, H1 and H4** (some files may be named M2/H1; check each file's real bar spacing).
- Tab-separated, columns: `<DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>`
  - Dates look like `2004.06.11`, times like `07:15:00`.
  - `TICKVOL` is tick count, not real exchange volume.
  - `SPREAD` is in points (0.01). It can be 0 in early years; then assume $0.30.
- **Time zone: broker time.** In this data New York time = broker time minus 7 hours (DST-following). Verify it: the
  biggest 5-minute ranges should cluster at 08:30 ET (US data) and 09:30 ET.
- First load each file and print the date range, bar count, any gaps and duplicates. Use M1/M5 for accurate fills
  and higher timeframes for signals.

## Account rules the strategy must survive (LucidFlex; confirm current numbers on lucidtrading.com)

| Account | Max loss (end-of-day trailing) | Daily loss limit | Max size | Profit target (evaluation) |
|---|---|---|---|---|
| 25K | $1,000 | $600 | 20 MGC micros | about $1,250 |
| 50K | $2,000 | $1,200 | 40 micros | about $3,000 |
| 100K | $3,000 | $1,800 | 60 micros | about $6,000 |
| 150K | $4,500 | $2,700 | 100 micros | about $9,000 |

- **Flat by 4:45 PM ET every day.** No position may be open between 4:45 PM and the 6:00 PM ET reopen, and nothing
  over the weekend. A trade may open at 6:00 PM and close the next day before 4:45 PM.
- **Trailing max loss:** the floor follows the highest end-of-day balance up and stops trailing at the starting
  balance. Breaking the floor at any moment blows the account.
- **Evaluation consistency rule:** the best single day can be at most 50% of total profit (check the current rule).
- **MGC = $10 per $1 move** (10 oz); GC = $100 per $1 (100 oz).
- **Costs per trade:** at least $0.20/oz slippage on entry and on exit, plus about $1.50 commission per MGC round trip.
- **Trading:** manual, copied to other accounts with a trade copier. So signals must be clear (entry, stop, target)
  and at most a few per day.

## How to test properly (non-negotiable)

1. **Realistic fills.** Enter on the bar after the signal, never at the signal bar's close or at a price that only
   becomes known later. If the stop and target are both inside one bar, count the stop first. Use M1 or M5 bars to
   check which was hit first.
2. **No look-ahead.** Higher-timeframe values (H1/H4/daily) use only bars that have already closed. Check with an
   assertion that no feature uses future data.
3. **Split the history:**
   - Pick settings on **2004-2018** only.
   - Check them on **2019-2025**.
   - Grade **2026** once, at the very end.
   - A strategy only counts if it is profitable after costs in **both** 2004-2011 and 2012-2018, and also in
     2019-2025.
4. **Report every version you tried,** not just the winner. With N versions tested, say how many passed; if only a
   few pass out of hundreds, treat them as likely luck.
5. **Dollars on the real account rules.**
   - Simulate each account size with the rules above: trailing floor, daily loss limit, contract cap, flat by 4:45 PM.
   - Report average week, typical (median) week, winning weeks %, max drawdown, worst day, best day, and blown
     accounts.
6. **Evaluation pass test.**
   - Start a simulated evaluation every Monday 2008-2025.
   - Report pass rate, fail rate and median weeks to pass for each account size and contract size.
7. **Stress.** Double the slippage, and confirm the edge survives. Run a Monte Carlo of 2,000 shuffled weeks for the
   chance of blowing an account within a year.
8. **Write one command that re-runs everything:** `python3 run_all.py <data folder>`. It prints a final table and
   writes `results.json`. Run it yourself before you finish and paste its real output.

## What has already been tested on this data (do not repeat, do better)

These were tested with the rules above and **lost money or were about breakeven after costs**:
- Intraday price patterns on gold: ICT silver bullet, FVG/MSS entries, Judas swing / Asian-range sweeps,
  prior-day high/low sweeps, double/triple tops and bottoms, head & shoulders, round-number rejections, RSI
  divergence, opening-range breakouts, VWAP fades, Bollinger, MACD/EMA crosses, Supertrend, Donchian intraday,
  inside bars, exhaustion candles.
- A 5x / 4x / 3x tick-volume-surge breakout with a 1.5 ATR trail: 21-24% win rate, lost in 18-21 of 21-23 years.

What held up:
- **Daily trend:** EMA 13/55 cross on daily closes, long only, 1.5 x daily ATR trailing stop, held one session at a
  time (6:00 PM to 4:40 PM ET).
  - Positive in every period, but only about 3 trades a year.
  - About $3-9 a week long-run on 1 MGC, and about $50-90 a week in strong gold years like 2026.
- **Overnight drift:** long 6:00 PM to 2:00 AM ET made money from 2012 on, but lost in 2004-2011. Likely a bull-market
  effect.
- **Pass-rate math:** with no edge, reaching +$3,000 before -$2,000 happens about 40% of the time at best (gambler's
  ruin). To pass evaluations fast and reliably you need a real edge, not a bigger size.

Use these as baselines: your strategy should beat the daily trend on the same tests, or say clearly that it doesn't.

## Ideas worth trying (not yet tested)

- Combining the daily trend with intraday timing on M5/M15: enter on a pullback during London/NY instead of at the
  session open.
- Volatility regime filters: skip trading when the daily ATR is extreme, or size down then.
- Multi-timeframe agreement: H4 + daily trend, entries on M15.
- Seasonality: day of week, month, and the days around US data (CPI, NFP, FOMC).
- A small ML model (logistic regression or gradient boosting) that rates the daily trend's signals.
  - Train only on past years (walk-forward).
  - It must beat taking every signal on unseen years.
- Pyramiding into winners with the stop raised each time (this helped the NQ opening drive).

## Deliverables

1. `run_all.py` plus its modules, every one run and tested by you, with the real printed output.
2. A results table for the best strategy: per period, per account size and per contract size.
3. A Pine Script v6 indicator (TradingView) that shows the strategy's signals with entry, stop and target lines, the
   contract size for a chosen $ risk, and alerts. It must be signals only, with no auto trading.
4. An honest summary:
   - What it makes per week per account.
   - How often it would blow an account.
   - How long an evaluation takes to pass.
   - Whether it beats the daily-trend baseline.

If nothing beats the baseline, say so and deliver the best baseline version, with the tests to prove it.
