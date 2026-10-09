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

What it draws (every value on a bar uses only data up to that bar, so past bars never repaint):

- **Green line, predicted HIGH (live):** the high so far plus the extra move the day still usually makes. That extra move comes from a trained table, looked up by hour of the day and by where price sits in the day's range. It tightens through the day.
- **Red line, predicted LOW (live):** the same thing downward.
- **Yellow line, BUILD-UP / support (live):** a blend of the middle of the predicted range and the price where the most trading has happened so far. Later in the day it leans more on that busiest price.
- **Flow lines (current bar):** arrows from price now to the predicted high and low at the hour they usually happen, then dotted lines into the build-up level by the close. A side with no extra move expected is labelled "likely set".
- **Dots:** the bar where price reached the line that was predicted on the bar before (green at the high, red at the low).
- **Max high / low (dashed) and shaded zones:** the wide envelope set at the day open (the narrowest percentile that held at least 95% per side). Signals fade these zones.
- **BUY / SELL signals:** only when all 5 filters agree. Price reaches the zone, a rejection candle closes back inside, RSI is stretched and turning, price is beyond the 2σ VWAP band, and it's inside the active session (Nasdaq 09:30–16:00 NY, gold 03:00–12:00 NY).
- **Panel:** live values, the average miss of the lines at the day open and at session start on your own chart, how often the max lines held, and the signals' win rate and net R.

Live-line accuracy on 120 unseen recent days (see `reports/training_report.md`), as the average distance from the day's real high / low / build-up:

| | At the day open | At session start | Average over the day |
| --- | --- | --- | --- |
| NQ high / low / build-up | 0.30 / 0.32 / 0.20 ATR | **0.08 / 0.10 / 0.05 ATR** (≈38 / 47 / 23 pts) | 0.16 / 0.18 / 0.09 ATR |
| Gold high / low / build-up | 0.28 / 0.31 / 0.28 ATR | 0.14 / 0.16 / 0.15 ATR (≈$12 / $14 / $13) | 0.13 / 0.14 / 0.14 ATR |

The old fixed lines missed by about 0.35 ATR on NQ and 0.30 ATR on gold. The lines get closer as the day goes on, but the extremes still aren't known exactly in advance.

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

## AI quick-trade TP / SL (local Llama + news)

For quick trades (up to 1 hour, either direction) the green **TP** and red **SL** lines show where to put the target and stop for the side the AI leans toward. The thin lines are drawn when confidence is low.

- **`ai/service.py`** runs on your PC. Every minute it rebuilds 5-minute features from the MT5 bridge, or from Yahoo (delayed) if the bridge isn't running, and gets the price model's probability. It then shifts that probability with a news score. The news score comes from **a local Llama model through [Ollama](https://ollama.com)** reading Yahoo Finance and Google News headlines, and high-impact USD events on the ForexFactory calendar mark "event risk" and turn off setups. It publishes:
  - `http://127.0.0.1:8766/ai`, which the app reads: TP/SL price lines plus a panel with the top headlines
  - `MT5 Common\Files\DRP_AI_NQ.txt` / `DRP_AI_GC.txt`, which the EA reads: TP/SL lines plus panel rows. Without the service, the EA uses the built-in price-only model.
  - `ai/logs/predictions.csv`, a log of every call
- **TradingView** can't read news, so the Pine script runs the same price-only model on chart bars. It's tuned for 5-minute charts.
- **Setup (Windows):** install Ollama, then double-click `ai.bat`. It pulls `llama3.1:8b`, installs the Python packages and starts the service. Settings such as the model, news weight and bridge offset live in `ai/config.json`. On a PC without a strong GPU, `llama3.2:3b` is lighter.
- **Honest numbers:** on unseen 5-minute data the price model calls direction about 50–53% of the time. After spread and commission no TP/SL setting made money (NQ about breakeven, gold negative; see `reports/training_report.md`). That's why every display says "no proven edge" until a test shows otherwise. There's no free news history to backtest the news part, so run `python ai/evaluate.py` after a few weeks of the service running. It replays every logged call and tells you whether calls where the news agreed did better. If they didn't, set `news_weight` to 0.
- **Running cost:** a local model scoring a few dozen headlines every 5 minutes uses a little extra electricity on your PC. There's no API bill.

### Replay videos

`python tools/replay_video.py --symbol NQ --date 2026-10-08` renders a 1080p replay of a trading day from the 9:30 open with the live lines, followed by the 9:30 call against the actual result. It also writes a title and description. The tables are fitted only on earlier days, so the replay has no hindsight.
