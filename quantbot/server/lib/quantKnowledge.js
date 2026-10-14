// Quant knowledge extracted from the trader's MT5 pipeline (quant-strategies, xauusd-quant, agent prompts)
// plus ICT / Smart Money methods. Sent to every model that writes, converts, tests or improves a bot.
export const QUANT_PLAYBOOK = `QUANT PLAYBOOK. When building or improving a bot, automatically build in the best-fit methods below (default for XAUUSD and index scalping: ICT confluence entries plus the risk and management rules). Implement them in code; never just list them.

ICT / SMART MONEY
1. Daily bias: H4/D1 structure (HH+HL bullish, LH+LL bearish) or price vs H4 EMA 200. Trade only with the bias. Premium/discount: buy only below the 50% level of the current dealing range, sell only above it.
2. Killzones (New York time): Asian range 20:00-00:00, London 02:00-05:00, NY AM 07:00-10:00 (indices 08:30-11:00), London close 10:00-12:00. Silver Bullet windows 03:00-04:00, 10:00-11:00, 14:00-15:00. No new entries outside them. MT5 data is broker server time (usually GMT+2, GMT+3 in US summer): expose a server-to-New-York offset input and convert.
3. Liquidity: buy-side = equal highs, previous day high, Asian high, session highs; sell-side = equal lows, previous day low, Asian low. A setup starts with a sweep: wick beyond the level, close back inside.
4. Market structure shift: after the sweep a displacement candle (body >= 1.5x ATR or range >= 2x the 20-bar average) breaks the most recent opposite swing (CHoCH / MSS). BOS in the bias direction confirms continuation.
5. Entry: the first fair value gap left by the displacement (bullish FVG: low[1] > high[3]; bearish FVG: high[1] < low[3], on closed bars), limit at its 50% (consequent encroachment) or the OTE zone 62-79% (sweet spot 70.5%) of the displacement leg. Order block = last opposite candle before the displacement, enter at its mean threshold (50%). Breaker blocks and inverse FVGs for retests. Cancel the setup if price closes through the gap or the killzone ends.
6. Stops and targets: SL beyond the sweep wick plus buffer (on gold at least 1.35x ATR to clear MAE noise). TP1 at the nearest opposing liquidity (min 2R), runner to the next draw on liquidity or the -1 to -2 standard deviation projection of the displacement leg.
7. Power of 3 (AMD): Asia accumulation, London manipulation (Judas swing: fake break of the Asian range then reversal), NY distribution.
8. SMT divergence when a correlated market is available: one sweeps a high or low, the other fails to.

QUANT MODELS (pipeline encyclopedia)
- Multi-model composite: H4 EMA 200 + H4 linear-regression slope macro filter; ADX(14) >= 25 momentum mode, < 20 mean-reversion mode; Z = (close - SMA30) / StDev30 (trend: |Z| > 0.5 with the trend; range: buy Z < -2, sell Z > 2); wick-based volume imbalance > 15%; enter only when composite confidence >= 70%.
- Statistical mean reversion: close outside Bollinger(20, 2-2.5) then an engulfing close back inside, Z beyond +/-2.2, RSI(14) 80/20 divergence; target VWAP or EMA 20; SL beyond the swing + 1x ATR.
- Session breakout: Asian box 00:00-06:45 GMT, London Judas sweep then break, NY open drive 12:30-15:30 GMT; confirm a close beyond the range with tick volume > 1.5x its 20-bar average; TP 1.5x the Asian range; no trading 21:00-00:30 server time.
- Volatility squeeze: Bollinger(20, 2) inside Keltner(20, 1.5) = squeeze; trade the fire in the direction of momentum(12); Chandelier 3x ATR trail.
- Volume profile: POC is the fair-value magnet, price rotates between VAH and VAL (70% of volume), acceptance outside the value area = expansion. Initial balance (first 60 min of London/NY) classifies normal, trend (> 2x IB) and neutral days.
- CVD absorption: a new price high without a new CVD high (or tick-volume delta proxy) = short reversal bias, and the reverse for lows.
- Gamma regime: below the zero-gamma flip use breakout logic with wider stops, above it fade extremes with tighter targets.

XAUUSD MICROSTRUCTURE
- 1 lot = 100 oz, a $1 move = $100 per lot, point 0.01. Spread 15-25 points in active sessions, 50-150 at rollover 21:00-23:00 GMT: block entries when spread > 30 points.
- Typical ATR: M1 0.4-1.2, M5 1.2-3.5, M15 2.5-6.5, H1 6-18, D1 25-65 USD.
- Median M15 noise MAE is 1.20-1.50 USD: stops under 150 points get noise-stopped. SL 1.35-1.5x ATR(14), TP 2.5-3.2x ATR (MFE peak), target MFE/MAE > 1.8.
- Fat tails (kurtosis > 4.5) and volatility clustering: halve size when ATR(20) is above its 80th percentile; never martingale, grid or averaging down.
- Best signal-to-noise: London 07:30-11:30 GMT and NY 12:30-16:30 GMT. London fix 10:30 and 15:00 GMT. Avoid entries 15 min around CPI, NFP and FOMC.

RISK AND MANAGEMENT (always)
- Risk 0.5-1% of balance per trade from the stop distance, signals on closed bars only, one position per direction, unique magic number.
- 3-stage management: breakeven + spread at +0.65-1.0R, close 50% at +1.2-1.5R, ATR or swing trail on the runner.
- Prop guards: FTMO daily loss breaker at 3.8% (limit 5%) and max loss at 8.5% (limit 10%). LucidPro: end-of-day trailing max loss ($1,000 / $2,000 / $3,000 / $4,500 for 25K / 50K / 100K / 150K, locks at start + $100), daily loss limit ($1,200 / $1,800 / $2,700, none on 25K eval), max 2 / 4 / 6 / 10 minis, funded best day <= 40% of cycle profit. Stop trading once the target is hit; flatten Friday 21:00 UTC.

IMPROVING A BOT
Diagnose from the test results first: no trades -> loosen or fix filters; low win rate -> add bias, killzone and sweep confluence; high drawdown -> lower risk, daily breaker, volatility sizing; profit factor < 1.3 -> better R:R with targets at liquidity and cut late-session trades; long losing streaks -> regime filter (ADX or squeeze). Change one or two things per version and never curve-fit to one window.`;