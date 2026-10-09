# MT5 Charts

A TradingView-style charting terminal for MetaTrader 5.

- Charts built on TradingView's open-source **Lightweight Charts** library: candles, hollow candles, bars, line, area, baseline, Heikin Ashi; volume; multi-pane indicators.
- **MT5 symbols only** (Market Watch list from your broker when connected) and all 21 MT5 timeframes.
- **★ Favorites** tab. XAUUSD is always favorited by default; star any symbol to add it.
- **Pine Script** editor: write or import `.pine` files and add them to the chart. Supports a large subset of Pine v5: `indicator`, `input.*`, `ta.*` (sma, ema, rma, wma, rsi, macd, bb, atr, stoch, vwap, highest, lowest, crossover, crossunder, change, stdev), `math.*`, `plot`, `hline`, `plotshape`, `x[n]`, ternary and tuple destructuring.
- **Expert Advisors** tab: upload `.mq5` / `.ex5` files into your terminal's `MQL5\Experts` folder.
- **Settings → MT5 tabs** that mirror MT5's Tools → Options: Server, Charts, Trade, Expert Advisors, Notifications, Email, FTP, Events, Community, Signals.
- Drawing tools: trend line, horizontal/vertical line, rectangle, Fib retracement.
- One-click BUY/SELL, positions with SL/TP lines, trade history, and journal.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

With no bridge running you get demo candles. For live data and trading, on the Windows PC running MT5:

```bash
cd bridge
pip install -r requirements.txt
python mt5_bridge.py   # http://127.0.0.1:8765, localhost only
```

Then go to Settings → MT5: Server and click **Connect to MT5**.

## Limits

- This is not TradingView's own code. Their full charting library and premium features are closed source, so this app rebuilds them on the open-source library. TradingView extras like screeners, social/chat, ideas and alerts are left out.
- Pine scripts run in a built-in interpreter that covers the subset above. Strategies (`strategy.entry` and similar), `request.security`, arrays and loops aren't supported yet.
- MT5's Python API can't attach an EA to a chart. Upload the EA here, then drag it onto a chart from MT5's Navigator, with Algo Trading turned on.

## Test

```bash
npm test
```

## Day Range Predictor (US100 / NQ / XAUUSD)

Two versions of the same model:

| File | Platform | Symbols |
| --- | --- | --- |
| `experts/DayRangePredictor.mq5` | MT5 (Expert Advisor, draws only, places no trades) | US100 / NAS100 / USTEC, XAUUSD |
| `pine/DayRangePredictor.pine` | TradingView (Pine v5) | `CME_MINI:NQ1!`, `OANDA:XAUUSD` (any XAUUSD feed) |

What it draws each day, using only data known at the open (no repainting):

- **Max HIGH / Max LOW** (solid lines): today's open ± the 95th percentile of the last 250 days' up/down moves, scaled by the 14-day ATR.
- **Likely HIGH / Likely LOW** (dashed lines): the same at the 50th percentile, so price reaches them about half of days.
- **Reversal zones** (shaded): from the 85th percentile out to the max line.
- **BUY / SELL signals**: only when all 5 filters agree: price reaches the zone, a rejection candle closes back inside, RSI is stretched and turning, price is beyond the 2σ VWAP band, and it's inside the active session (Nasdaq 09:30–16:00 NY, gold 03:00–12:00 NY). At most one per side per day.
- **Panel**: a walk-forward accuracy test (how often the day's high and low really stayed inside that morning's max lines) and the win rate and net R of the signals on the chart.

Walk-forward results on daily data (last 500 trading days up to Oct 2026; every day's lines built only from earlier days):

| Max line percentile | NQ: high held | NQ: low held | NQ: both held | Gold: high held | Gold: low held | Gold: both held | Band width |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P90 | 89.2% | 91.0% | 80.2% | 91.2% | 89.4% | 80.8% | ~2.2× ATR |
| P95 (default) | 94.4% | 95.4% | 89.8% | 94.4% | 94.2% | 88.6% | ~2.7× ATR |
| P97 | 96.6% | 97.4% | 94.0% | 96.6% | 96.2% | 92.8% | ~3.1× ATR |

Higher accuracy always means wider lines. The reversal signals tested at around a coin flip on 2 years of hourly NQ and gold data (≈45–55% at 1R, before spread and commission), so treat them as a filter, not a guarantee. No indicator is right 100% of the time, and this is not financial advice.

### Training on recent data

`tools/train_drp.py` downloads the latest Yahoo Finance history (NQ=F and GC=F: 10 years daily, 2 years hourly), checks the latest prices against Google Finance, and tunes the settings. Google Finance has no history download, so it's used only for that price check. Each setting is picked on older data and then scored on the most recent data it never saw. The results are written to:

- the `TRAINED PRESETS` block in both scripts. These are on by default ("Use trained presets"), and NQ or gold settings are picked from the symbol name.
- `presets/DRP_US100.set` and `presets/DRP_XAUUSD.set`, which you can load from the EA's Inputs tab in MT5.
- `reports/training_report.md`, which lists everything tested and how it scored on unseen days.

Re-train any time with `train.bat` on Windows, or `pip install -r tools/requirements.txt && python tools/train_drp.py`. Then recompile the EA and re-paste the Pine script. Tuned signal filters only replace the strict defaults when they also made money on the unseen holdout data.

MT5 install: copy the `.mq5` into `MQL5\Experts` (or use the app's Expert Advisors tab), compile it in MetaEditor, then drag it onto an intraday chart (M5 or M15 work well). In the Strategy Tester, set "Server time minus New York" to your broker's offset (7 for most brokers) because auto-detect needs a live clock.

TradingView install: Pine Editor → paste `pine/DayRangePredictor.pine` → Add to chart. Use an intraday timeframe. The built-in Pine interpreter in this app doesn't run it, because it needs `request.security`, `var` and arrays.
