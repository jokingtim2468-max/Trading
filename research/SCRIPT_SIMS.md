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
| 3 | SMC Sniper Pro | Model 3 CISD, Lucid rules (1h cap) | $150 | +$122 | $4,280 |
| 4 | SMC Sniper Pro | Model 1 IFVG, Lucid rules (1h cap) | $150 | −$30 | $2,561 |
| 5 | TradeX QuantORB | V3.1 as written | $500 | −$386 | $46,530 |
| 6 | SMC Sniper Pro | Model 3 CISD, script rules | $150 | −$1,476 | $6,545 |
| 7 | SMC Sniper Pro | Model 1 IFVG, script rules | $150 | −$1,860 | $3,456 |
| 8 | TradeX QuantORB | V3.1 script rules | $150 | −$2,984 | $14,056 |
| 9 | SMC Sniper Pro | Model 2 MSS+EQ, script rules | $150 | −$3,345 | $3,823 |
| 10 | SMC Sniper Pro | Model 2 MSS+EQ, Lucid rules (1h cap) | $150 | −$3,530 | $3,943 |
| 11 | TradeX QuantORB | V4.1 Lucid rules (1h cap) | $150 | −$5,912 | $10,734 |
| 12 | TradeAxis DOL | as written (pool clogs, few signals) | $150 | −$7,261 | $7,261 |
| 13 | TradeX QuantORB | V3.1 Lucid rules (1h cap) | $150 | −$9,134 | $15,086 |
| 14 | iFVG Ultimate+ | script lines (BE, no target) | $150 | −$14,216 | $15,182 |
| 15 | iFVG Ultimate+ | + 2R target | $150 | −$18,632 | $19,774 |
| 16 | Liquidity DOL Scoring | only PoT >= 60%, Lucid rules | $150 | −$22,305 | $25,192 |
| 17 | Liquidity DOL Scoring | only PoT >= 60%, script rules | $150 | −$23,344 | $26,199 |
| 18 | SUPER INDIBOT Ribbon | A: BUY to SELL arrow, script rules | $150 | −$38,882 | $50,088 |
| 19 | TBR Sessions | B: sweep reversal | $150 | −$40,977 | $41,153 |
| 20 | TBR Sessions | A: 0.618 Fib line | $150 | −$41,073 | $42,014 |
| 21 | SUPER INDIBOT Ribbon | A: BUY to SELL arrow, Lucid rules | $150 | −$42,458 | $50,665 |
| 22 | SUPER INDIBOT Ribbon | B: exit when ribbon unaligns, Lucid rules | $150 | −$45,052 | $50,547 |
| 23 | SUPER INDIBOT Ribbon | B: exit when ribbon unaligns, script rules | $150 | −$76,391 | $82,759 |
| 24 | Liquidity DOL Scoring | every new DOL, Lucid rules | $150 | −$93,643 | $97,011 |
| 25 | Liquidity DOL Scoring | every new DOL, script rules | $150 | −$156,341 | $160,029 |
| 26 | TradeAxis DOL | dead-level bug fixed | $150 | −$189,735 | $189,895 |

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

## SMC Sniper Pro – Quant Flow Labs – `smc_sim.py`
Exact port of all three models with the default filters (2 of 3 HTF biases, fresh 1H FVG) and the Fixed-RR bracket:
entry at the signal close, stop at the sweep extreme ± 0.25 ATR, 2R target. Only regular-hours signals are traded
(09:30–15:50), at $150 risk.

Quirks of the script, kept in the port:
* The MSS check runs for every model. Model 1 therefore also fires on MSS, and Model 3 loses setups when MSS comes
  first.
* Once a setup reaches stage 2, Model 1 has no expiry.

| Version | Trades | Win % | PF | Net P&L | Max drawdown |
|---|---|---|---|---|---|
| Model 1 IFVG, script rules | 481 | 43.5 | 0.94 | −$1,860 | $3,456 |
| Model 1 IFVG, Lucid rules | 482 | 46.9 | 1.00 | −$30 | $2,561 |
| Model 2 MSS+EQ, script rules | 138 | 32.6 | 0.71 | −$3,345 | $3,823 |
| Model 2 MSS+EQ, Lucid rules | 137 | 34.3 | 0.62 | −$3,530 | $3,943 |
| Model 3 CISD, script rules | 679 | 42.9 | 0.97 | −$1,476 | $6,545 |
| Model 3 CISD, Lucid rules | 687 | 49.8 | 1.00 | +$122 | $4,280 |

* **Filters leave few trades:** the bias and HTF-FVG filters allow about 50–75 regular-hours trades per year.
* **No edge:** every model is flat to negative over 10 years. The best, Model 3 under Lucid rules, made +$122 in total.
* **Drawdowns:** every version had drawdowns well above the $1,000 Lucid limit.

## SUPER INDIBOT – EMA Ribbon Trend – `ribbon_sim.py`
Port: EMAs 5/11/15/18/21/24/28/34 on the 24h 5-minute close. BUY when all 7 adjacent pairs turn bullish, SELL is the
mirror; this matches the script's wasBull/wasBear flip logic. The script has no stop or exit, so two readings were
tested (regular-hours arrows only):
* **A – arrow to arrow:** hold until the opposite arrow, then reverse.
* **B – strong trend only:** exit as soon as the ribbon is no longer fully aligned.

Stop for sizing = EMA 34 ± 0.25 ATR, $150 risk on MNQ.

| Version | Trades | Win % | PF | Net P&L | Max drawdown |
|---|---|---|---|---|---|
| A: arrow to arrow, script rules | 6,363 | 29.3 | 0.93 | −$38,882 | $50,088 |
| A: arrow to arrow, Lucid rules | 5,856 | 40.2 | 0.89 | −$42,458 | $50,665 |
| B: strong trend only, script rules | 9,125 | 31.0 | 0.87 | −$76,391 | $82,759 |
| B: strong trend only, Lucid rules | 5,893 | 36.1 | 0.87 | −$45,052 | $50,547 |

* **Too many trades:** the 5-minute ribbon flips several times a day, so costs and whipsaws dominate.
* **Stops come first:** the EMA-34 stop is usually hit long before the opposite arrow appears.

## Liquidity DOL Scoring Engine – `liqdol_sim.py`
Port (Day Trading mode):
* Levels are 5-minute pivots (3/3), up to 15 tracked, and are retired on first touch.
* Scoring is weighted 30/25/25/20: proximity, freshness (half-life 50 bars), confluence with PDH/PDL/daily open/EQ
  (+20 if the 1H bias agrees) and density. PoT = min(95, score).
* PDH/PDL and the daily open come from `lookahead_off` higher-timeframe calls, so on historical bars they are one
  session older than the names suggest.
* A new DOL = the best level's birth bar or price changes. Unlike TradeAxis DOL, there is no list-position bug.

Traded like TradeAxis DOL: on a new regular-hours DOL, trade toward it. Target = the level, stop = the same distance
on the other side (1:1), skip levels closer than 0.5 ATR, $150 risk.

| Version | Trades | Win % | PF | Net P&L | Max drawdown |
|---|---|---|---|---|---|
| every new DOL, script rules | 17,547 | 49.9 | 0.85 | −$156,341 | $160,029 |
| every new DOL, Lucid rules | 10,029 | 49.4 | 0.84 | −$93,643 | $97,011 |
| only PoT ≥ 60%, script rules | 1,677 | 49.8 | 0.79 | −$23,344 | $26,199 |
| only PoT ≥ 60%, Lucid rules | 1,628 | 49.3 | 0.78 | −$22,305 | $25,192 |

**Is the PoT % honest?** Touch within 60 minutes of a new regular-hours DOL:

| Shown PoT | Events | Actual touch rate |
|---|---|---|
| 0–20% | 373 | 29% |
| 20–40% | 15,861 | 36% |
| 40–60% | 31,026 | 60% |
| 60–80% | 2,390 | 68% |
| 80–95% | 30 | 83% |

* **The PoT is roughly honest, even slightly conservative.** But it measures touch, not direction.
* **No direction edge:** price reached the level before an equal-distance stop only ~50% of the time. After costs
  that is a loss.
* **Too many trades:** the target changes ~20 times a day, so trading every new DOL multiplies the losses.
