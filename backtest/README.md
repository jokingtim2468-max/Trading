# Strategy backtest (5-minute bars)

Tests about 20 common intraday strategies on their own and with a filter
(1H EMA bias, VWAP side, ADX trend or ADX range). Each one is tuned on the first
70% of the data and judged on the last 30% only.

Rules shared by every test: one position at a time, market entry at the next open,
stop in ATR, optional R target, 4.5 h time stop, flat by 16:35 New York,
costs of 1.5 points (US100) or 0.4 points (XAUUSD) per round trip.

```bash
python3 -I backtest/run.py path/to/USATECHIDXUSD5.csv US100
python3 -I backtest/robust.py path/to/USATECHIDXUSD5.csv US100
python3 -I backtest/run.py path/to/XAUUSD5.csv XAUUSD
```

CSV format: tab separated `YYYY-MM-DD HH:MM  open  high  low  close  volume`, UTC times.
Results for US100 are in `results_US100.txt`.
