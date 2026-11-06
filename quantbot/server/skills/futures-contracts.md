---
name: futures-contracts
description: Load when sizing trades or converting points to dollars - contract specs for gold, Nasdaq and S&P futures and the gold CFD
---

# Contract specs

| Symbol | Market | $ per 1.00 price move | Tick | $ per tick |
|---|---|---|---|---|
| GC | Gold futures (100 oz) | $100 | 0.10 | $10 |
| MGC | Micro gold (10 oz) | $10 | 0.10 | $1 |
| NQ | Nasdaq-100 E-mini | $20 | 0.25 | $5 |
| MNQ | Micro Nasdaq | $2 | 0.25 | $0.50 |
| ES | S&P 500 E-mini | $50 | 0.25 | $12.50 |
| MES | Micro S&P | $5 | 0.25 | $1.25 |
| XAUUSD (MT5) | Gold CFD, 1 lot = 100 oz | $100 per lot | 0.01 | $1 per lot |

- Contracts = floor(risk_usd / (stop_distance * $_per_point)). Clamp to at least 1 only if 1 contract still fits the risk; otherwise skip the trade.
- Typical costs: MGC about $1.50 commission round trip + $0.10-0.20/oz slippage per side; MNQ about $1.50 + 0.25-0.5 pt per side.
- Use the position_size and calculate tools for the arithmetic; never do it in your head.
