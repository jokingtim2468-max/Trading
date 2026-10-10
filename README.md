# MT5 Charts

A TradingView-style charting terminal fed by MetaTrader 5 prices.

- **Charts** built on TradingView's open-source Lightweight Charts: candles, hollow candles, bars, line, area, baseline, Heikin Ashi, volume, and separate panes for oscillators.
- **Multi-chart layouts**: 1, 2, 3 or 4 charts side by side, plus grids of 4, 6 and 8 charts. Symbol, interval, crosshair and time sync are in the layout menu.
- **SELL / BUY panel** at the top-left of every chart, with live bid, ask and spread and the pips emphasised the way MT5's one-click panel shows them.
- **MT5 symbols only** (your broker's Market Watch when connected), all 21 MT5 timeframes, and an MT5-style Market Watch with live bid, ask and spread that turns blue on an up-tick and red on a down-tick.
- **★ Favorites**: XAUUSD is always a favorite.
- **Color schemes**: TradingView Dark and Light, MT5 Green On Black, Color On Black and Black On White, and Midnight Galaxy.
- **Pine Script editor** (subset of Pine v5) and an **Experts** tab that copies `.mq5`/`.ex5` files into `MQL5\Experts`.
- Drawing tools, MT5 period separators and Ask line, and a read-only view of MT5's own terminal options.

## Trading (FTMO)

This app **never sends orders**. The MT5 bridge is read-only: it has no endpoint that places, changes or closes an order. That's on purpose. Every order, close, TP and SL goes through FTMO's own TradingView connection, so every trade is a normal manual trade on FTMO's infrastructure, with no EA, API or script involved.

Clicking SELL or BUY on a chart opens that symbol on TradingView. Connect your FTMO account once in TradingView's Trading Panel and place the order there. If TradingView needs a broker prefix for FTMO's symbols, set it in Settings → Trading.

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

Then go to Settings → MT5: Server and click **Connect**. The MT5 account only provides prices, so a free MetaQuotes-Demo account is enough.

## Limits

- This is not TradingView's own code. Their full charting library is closed source, so the app is rebuilt on their open-source library. Screeners, ideas and social features are left out.
- The Pine interpreter covers a subset of Pine v5. `strategy.*`, `request.security`, loops and arrays aren't supported yet.
- MT5 prices come from whatever MT5 account the bridge is logged into. Prices on FTMO's TradingView feed can differ slightly.

## Test

```bash
npm test
```
