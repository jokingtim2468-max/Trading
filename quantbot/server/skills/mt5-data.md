---
name: mt5-data
description: Load when reading the trader's MT5 CSV exports (XAUUSD / NQ M1-H4) - file format, broker time zone, resampling, sessions
---

# MT5 export data

## Format
Tab-separated with a header: `<DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>`
- `<DATE>` like 2004.06.11, `<TIME>` like 07:15:00. `<TICKVOL>` = tick count (not exchange volume). `<VOL>` is usually 0.
- `<SPREAD>` is in points (0.01 for gold). It can be 0 in early years: then assume about $0.30 for gold.
- Some exports have no `<TIME>` (daily files).

```python
import pandas as pd, numpy as np
df = pd.read_csv(path, sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)  # broker -> New York
bars = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values,
                     'c': df['<CLOSE>'].values, 'v': df['<TICKVOL>'].values.astype(float)}, index=t)
bars = bars[bars.index.weekday < 5]
```

## Time zone
- The trader's broker time = New York time + 7 hours (DST-following: UTC+2 in winter, UTC+3 in summer). Subtract 7 hours to get New York time.
- Verify on new files: the largest 5-minute ranges should cluster at 08:30 ET (US data) and 09:30 ET (NY cash open).
- Sessions in New York time: Asia 19:00-02:00, London 03:00-11:30, NY 08:30-16:00. Gold COMEX day session opens 08:20 ET. Futures reopen 18:00 ET.

## Timeframes
- Resample from the smallest file you have (M1 or M5) so every timeframe agrees:
  `bars.resample('15min').agg({'o':'first','h':'max','l':'min','c':'last','v':'sum'}).dropna()`
- Session days for futures (18:00 -> 16:45 ET): `day = (index + pd.Timedelta(hours=6)).normalize()`.
- Print each file's date range, bar count, gaps and duplicates before using it.

## Data the trader has
- XAUUSD M1, M5, M15, H1, H4: 2004-06 to 2026-10. NQ M5: 2012 to 2026 (its tick volume is constant 5 = useless for volume ideas).
- Free extras in ml-signals/data/: CFTC COT gold, GVZ (gold volatility, FRED GVZCLS), CPI (FRED CPIAUCSL). FRED also has DTWEXBGS (dollar), DGS10, DFII10, VIXCLS.
