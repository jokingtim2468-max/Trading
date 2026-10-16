# TradingView script simulations on NQ / US100 (5-minute)

Data: real CME NQ futures 1-minute bars (Hugging Face `mdelcristo/NQ-F_1min_OHLCV_Parquet`) built into 5-minute
bars. Period: 2015-01-02 → 2025-05-30, 2,596 RTH days. June–July 2025 is excluded because the file shows two
~400-pt one-minute jumps that look like bad contract-roll joins.
NQ futures track US100; a broker's US100 CFD has a slightly different price level.
Account model: Lucid 25K rules, $150 risk per trade on MNQ ($2/pt), $1.24 commission per micro round trip, 1 tick
slippage on market fills. Take-profit limits must trade through by 1 tick. Max 1 hour per trade, flat by 15:55 ET,
2-loss / −$400 daily lock, no positions through FOMC or ISM releases.

## TradeAxis DOL (Draw on Liquidity) – `dol_sim.py`
Rule: when a new DOL line appears on a regular-hours 5-minute close, trade toward it. Target = the line, stop = the
same distance on the other side (1:1). Lines closer than 0.5 ATR are skipped.

| Version | Trades | Win % | PF | Net P&L | Max drawdown | $/week |
|---|---|---|---|---|---|---|
| As written | 330 | 48.8 | 0.67 | −$7,261 | $7,261 | −$14 |
| Dead-level fix | 9,702 | 47.6 | 0.71 | −$189,735 | $189,895 | −$365 |

* **Script bug:** dead levels are never removed from the 14-slot pool and keep their last score. After about 18
  months of bars, the pool holds 13 dead levels and 1 live one, and from 2022 on the DOL never changes. The "fixed"
  run evicts dead levels first, which matches how the script behaves on a freshly loaded chart.
* **Second quirk:** the DOL line's end point follows a list position. When the list shifts, the line can tilt
  toward a different level.
* **No edge:** price reached the line before an equal-distance stop only 45.6% of the time. Trading the line was
  worse than random direction (p = 0.999).

## iFVG Ultimate+ – `ifvg_sim.py`
Rule: the script's own lines. Entry at the close of the inversion bar. Stop at the SL line (gap edge ± 0.25 ATR).
Once price reaches the 1R break-even line, the stop moves to entry. Exit on the script's invalidation, at 60 minutes,
or at 15:55. SMT (QQQ) only affects the grade panel and is ignored.

| Version | Trades | Win % | PF | Net P&L | Max drawdown | $/week |
|---|---|---|---|---|---|---|
| Script lines (break-even, no target) | 1,558 | 25.5 | 0.85 | −$14,216 | $15,182 | −$27 |
| + 2R target | 1,599 | 29.8 | 0.81 | −$18,632 | $19,774 | −$36 |

* Positive years: 2018, 2022 and 2024 (best: 2024, +$2,121, PF 1.31). Every other year lost.
* Every year's drawdown was larger than the Lucid $1,000 limit.

## TBR Sessions: Sweeps, Fib Auto-Adjust & 3-Drive – `tbr_sim.py`
The script draws session ranges (Asia / London / NY), auto-adjusting Fibonacci levels from each break, double breaks
and 3-drive patterns. It has no entries, so two readings were tested in the NY window (09:30–12:00), using the
07:00–09:30 range:
* **A – 0.618 line:** after a NY body break, a limit order rests on the labelled 0.618 Fib line. Stop = range edge
  (Fib 0), target = break extreme (Fib 1.0). One per direction per day.
* **B – sweep reversal:** a wick past the range closes back inside before any body break. Trade against it, stop
  beyond the extreme, target the opposite range edge (only if that is at least 1:1).

| Version | Trades | Win % | PF | Net P&L | Max drawdown | $/week |
|---|---|---|---|---|---|---|
| A: 0.618 Fib line | 2,464 | 54.7 | 0.70 | −$41,073 | $42,014 | −$79 |
| B: sweep reversal | 1,435 | 26.2 | 0.71 | −$40,977 | $41,153 | −$79 |

* Both lost money in **every year** from 2015 to 2025.
* Version A wins 55% of the time but only targets about 0.6R. After costs it needs ~65% winners to break even.

## TradeX QuantORB – `orb_sim.py`
The script defines its own trade, and it was ported exactly:
* 09:30–09:45 opening range; trade only if the range is 10–100 points.
* Enter on a 5-minute close beyond the range until 12:00, max 2 trades per day.
* V4.1: stop = opposite side of the range, 2R target, break-even at 1R. V3.1: stop 25% inside the range, 1.5R target,
  break-even at 0.75R.
* Flat at 15:55.

The script marks stop/target hits on its own entry bar, using price action from before the entry. The simulation
instead fills at the next 1-minute open and checks exits minute by minute.

| Version | Risk | Trades | Win % | PF | Net P&L | Max drawdown | $/week |
|---|---|---|---|---|---|---|---|
| V4.1 as written | $500 | 2,827 | 38.7 | 1.05 | +$26,798 | $29,128 | +$52 |
| V4.1 script rules | $150 | 2,238 | 37.2 | 1.02 | +$2,754 | $7,792 | +$5 |
| V4.1 + Lucid 1h cap / news / day lock | $150 | 2,938 | 46.1 | 0.94 | −$5,912 | $10,734 | −$11 |
| V3.1 as written | $500 | 3,402 | 35.0 | 1.00 | −$386 | $46,530 | −$1 |
| V3.1 script rules | $150 | 3,064 | 33.9 | 0.98 | −$2,984 | $14,056 | −$6 |
| V3.1 + Lucid rules | $150 | 3,502 | 42.6 | 0.93 | −$9,134 | $15,086 | −$18 |

* **V4.1 as written:**
  * Lost $25k in 2015–2017. In those years NQ was cheaper and the opening ranges were small.
  * Made money in 2018 and every year from 2020 to 2025; 2019 was flat. Its strongest stretch was 2021–2024, at
    PF 1.13–1.51.
  * The 10–100 point range filter is in today's NQ points. It was probably set with recent prices in mind, which
    flatters recent years.
* **The 1-hour cap breaks it:** V4.1 needs time to reach 2R. Most trades under the Lucid 1-hour cap end on time,
  not at target.
* **Lucid drawdown:** even in the best years, every version's drawdown went past $1,000.

## Ranking (net P&L, highest first) – `rank_scripts.py`, chart `results/ranking.png`
| # | Script | Version | Risk | Net P&L | Max drawdown |
|---|---|---|---|---|---|
| 1 | TradeX QuantORB | V4.1 as written | $500 | +$26,798 | $29,128 |
| 2 | TradeX QuantORB | V4.1 script rules | $150 | +$2,754 | $7,792 |
| 3 | TradeX QuantORB | V3.1 as written | $500 | −$386 | $46,530 |
| 4 | TradeX QuantORB | V3.1 script rules | $150 | −$2,984 | $14,056 |
| 5 | TradeX QuantORB | V4.1 Lucid rules | $150 | −$5,912 | $10,734 |
| 6 | TradeAxis DOL | as written (clogs, few trades) | $150 | −$7,261 | $7,261 |
| 7 | TradeX QuantORB | V3.1 Lucid rules | $150 | −$9,134 | $15,086 |
| 8 | iFVG Ultimate+ | script lines | $150 | −$14,216 | $15,182 |
| 9 | iFVG Ultimate+ | + 2R target | $150 | −$18,632 | $19,774 |
| 10 | TBR Sessions | B: sweep reversal | $150 | −$40,977 | $41,153 |
| 11 | TBR Sessions | A: 0.618 Fib line | $150 | −$41,073 | $42,014 |
| 12 | TradeAxis DOL | dead-level bug fixed | $150 | −$189,735 | $189,895 |

## QuantORB on the newest week: 2026-10-05 → 2026-10-09 – `orb_week.py`
Data: real NQ=F 1-minute bars from Yahoo Finance (CME), saved in `results/orb_week/`. Each day has a full 390-bar
regular session and there are no bad jumps. Same port, fills and costs as the 10-year run.

| Version | Trades | Week P&L | Max drawdown |
|---|---|---|---|
| V4.1 as written ($500) | 2 | −$429.96 | $429.96 |
| V4.1 script rules ($150) | 0 | $0 | $0 |
| V4.1 Lucid rules ($150) | 0 | $0 | $0 |
| V3.1 as written ($500) | 2 | −$352.20 | $352.20 |
| V3.1 script rules / Lucid ($150) | 2 | −$129.73 | $129.73 |

* **Range filter:** opening ranges were 167, 109, 126, 79.5 and 158 points. The fixed 10–100 point filter allowed only
  Thursday. With NQ near 31,000, 100 points is just 0.32%, so the filter now blocks most days.
* **Thursday Oct 8:**
  * The short at 09:55 was stopped at the range high (−$426).
  * The long at 10:20 went to break-even (−$3).
  * At $150 risk the V4.1 stop (~106 points = $212 per micro) is larger than the risk budget, so it was skipped.
* **Sample size:** two trades in one week say nothing statistically about the strategy either way.
