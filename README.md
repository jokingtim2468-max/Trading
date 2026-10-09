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
