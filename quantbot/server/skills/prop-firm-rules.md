---
name: prop-firm-rules
description: Load when a script, backtest or plan involves prop firm accounts (Lucid, FTMO, Apex...) - limits, trailing floor, evaluation pass tests
---

# Prop firm rules and how to simulate them

## LucidFlex (check lucidtrading.com for current numbers)
| Account | Max loss (EOD trailing) | Daily loss limit | Max size | Eval target |
|---|---|---|---|---|
| 25K | $1,000 | $600 | 2 minis / 20 micros | ~$1,250 |
| 50K | $2,000 | $1,200 | 4 / 40 | ~$3,000 |
| 100K | $3,000 | $1,800 | 6 / 60 | ~$6,000 |
| 150K | $4,500 | $2,700 | 10 / 100 | ~$9,000 |
- All positions closed by 4:45 PM ET; Lucid auto-closes. A trade may open at the 6:00 PM ET reopen and close the next day before 4:45 PM.
- Up to 5 funded and 10 evaluation accounts per household. Automated systems and trade copiers are allowed.
- Eval consistency: best day <= 40-50% of total profit (check current rule). Funded LucidFlex: no consistency rule, 90/10 split.
- Lucid's Tradovate prop accounts do not get Tradovate API keys: automation goes through a webhook bridge.

## The trailing floor (simulate it exactly)
```python
eq, floor, blown = 0.0, -MLL, 0
for day_pnl in daily_pnls:            # day_pnl already capped at -DLL when the day's worst point hit the DLL
    eq += day_pnl
    if eq <= floor: blown += 1; eq, floor = 0.0, -MLL; continue   # count it, start a new account
    if eq > 0: floor = max(floor, min(0.0, eq - MLL))             # trails end-of-day highs, locks at the start balance
```
- Check the DLL against the session's WORST open point, not just the close: a day that dips through the DLL and recovers is still stopped out.
- Size in whole contracts only. If 1 micro already risks too much for the account, say the account is too small.

## Evaluation pass test
Start a simulated evaluation every Monday across the history; play forward until +target (pass) or the floor (fail). Report pass %, fail %, median weeks to pass, per account size and contract size.
- Math to remember: with NO edge, reaching +T before -L happens L/(T+L) of the time (gambler's ruin): 40% for +$3,000 before -$2,000. Passing faster than that needs a real edge, not a bigger size. A bigger size only makes it more of a coin flip.

## Other firms (verify current terms before use)
- FTMO: 5% daily loss, 10% max loss (static), profit target 10% then 5%, balance-based. MT5/cTrader, overnight allowed on standard accounts.
- Apex, MFFU, Tradeify, TradeDay: each has its own automation, copy-trading and news rules. Read them before running a bot there.
