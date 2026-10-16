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
