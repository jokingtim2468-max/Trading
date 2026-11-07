---
name: research-findings
description: Load before proposing a gold/NQ strategy - what was already tested on the trader's data, what lost and what held up, so you don't repeat dead ends
---

# What was tested on the trader's data (2004-2026 gold, 2012-2026 NQ, real costs, honest splits)

## Lost money or about breakeven after costs (do not re-propose without a genuinely new ingredient)
- Gold intraday patterns: ICT silver bullet / FVG / MSS, Judas swing / Asian-range sweeps, prior-day high/low sweeps, double/triple tops, head & shoulders, round-number rejections, RSI divergence (best: triple top NY + 2 ATR trail, ~breakeven, 6 trades/year).
- 20 public intraday strategies x settings (180 versions): ORB, VWAP fade/trend, RSI(2), Bollinger, MACD/EMA cross, Supertrend, Donchian, inside bar, gap fade, exhaustion candles, intraday momentum.
- Tick-volume surge breakouts (3x/4x/5x) with 1.5 ATR trail: 21-24% win rate, lost in 18-21 of 21-23 years.
- Gold overnight drift (long 18:00-02:00 ET): only worked 2012+, lost 2004-2011 (bull-market effect).
- COT / GVZ / CPI regime filters on gold: no reliable timing edge (best rules +$0-9/week).
- One-trade-a-day "A+" setups at 25% of the DLL risk: 48-57% win, blew 50Ks.

## Held up
- Gold daily trend: EMA 13/55 cross on daily closes, LONG only, trailing stop 1.5 x daily ATR(20), max 60 sessions, held one session at a time (18:00-16:40 ET for Lucid). Positive in every period; ~3 trades/year; ~$3-9/week long-run per MGC, ~$50-90/week in strong gold years.
- NQ opening drive with adds: strong 09:30 bar (body >= 0.5 ATR) with the gap and the trend, breaking the overnight high/low; stop 2 ATR, add a unit at +1R/+2R/+3R raising the stop, trail 4 ATR, out 15:55. Walk-forward 2019-2025 +681R (no losing year), 2026 +25R; ~$98-140/week on a 150K at 1 MNQ/unit; 25K-100K too small for even 1 MNQ.
- Per-session NQ trend (long while daily EMA50 > EMA200, 18:00-16:40): +$47/week 2012-2025 at 1 MNQ on a 150K.

## Lessons
- Bigger size never fixed a weak edge: it turned drawdowns into blown accounts.
- Most "high win rate" setups win small and lose big; expectancy after costs is what counts.
- A strategy that only works in 2024-2026 is likely riding gold's bull market.

## Independent re-test (second agent, Nov 2026), all after costs on the trader's data
- NQ opening drive (ml-signals/ml_signals.py rules, US100 CFD M5 2012-2026): plain version profitable in 2012-2018 (PF 1.15), 2019-2025 (PF 1.29) and 2026 (PF 1.15); walk-forward ML version PF 1.89 / 1.43 / 1.20. Win rate only 15-17%, losing streaks up to 30-33 trades.
  - Lucid 50K at 1 MNQ, no time limit, 40% consistency on days so far: ~68% of Monday starts pass, median ~7 months (ML) / ~13 months (plain). 2 MNQ fails far more often. Daily loss limit never matters at 1 MNQ.
  - Sizing by fixed $ risk (e.g. $200/trade) breaks the Lucid floor: fail rate 64%. Keep 1 MNQ on a 50K.
- The same opening drive ported to gold (08:20 and 09:30 ET setups): lost in every period 2004-2026 (PF 0.57-0.86). No edge on gold.
- Daily EMA 13/55 gold trend, entered only on the cross: 70 trades, lost in 2012-2018 and 2019-2025. Entered every session while ema13 > ema55: profitable only in 2019-2025 (a bull-market effect), fails Lucid (5-9% pass).
- k x ATR filters on the opening move and a "regime switching" gold engine: failed out of sample.
