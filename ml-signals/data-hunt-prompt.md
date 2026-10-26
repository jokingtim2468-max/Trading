# Prompt: find the data for a better gold bot (free first, $100 total maximum)

Paste everything below the line into a new AI agent session that can browse the web and run Python.

---

I'm building an XAUUSD / gold futures (MGC, GC) signal bot. I already have 22 years of XAUUSD 5-minute bars (open,
high, low, close, tick count) and these FRED series: dollar index, 10-year yield, 10-year real yield, VIX. Price
patterns alone have no edge after costs, so I need **information that isn't in price bars**.

Find each dataset below, **free if at all possible, and $100 total at most**. For each one:
- Give the source, what it costs, how far back it goes and its time resolution.
- Say how to download it, with an exact URL, API call or script.
- Download it if it's free, and save it as CSV with a UTC timestamp column.

Only use official or long-established sources (exchanges, government agencies, well-known data vendors). No cracked
data, no sites that need my broker login, nothing from unknown sellers. Check each site is legitimate before giving it
any payment details.

## 1. Order flow / real volume for gold futures (most important)
- Tick or 1-minute **GC or MGC futures** data with real traded volume, and if possible bid/ask volume (buyer vs
  seller aggression) or top-of-book. At least 3-5 years, more is better.
- Places to check:
  - Databento (new accounts have historically got free credits; check the current offer, and price GC 1-minute
    OHLCV and trades data)
  - CME DataMine sample data
  - Dukascopy historical tick data for XAU/USD (free, with bid/ask volumes; it's a CFD feed, not futures, but useful)
  - FirstRate Data, Kibot, Portara (price their GC 1-minute files)
  - a TradingView export of MGC1!/GC1! if my plan allows it
- Also find the free GVZ (Cboe gold volatility index) daily history on FRED (`GVZCLS`) and any intraday version.

## 2. Positioning and flows (free, government or official)
- **CFTC Commitments of Traders** for gold (weekly, since 2006 or earlier): managed money and commercial net
  positions. Source: cftc.gov historical compressed files.
- **SPDR Gold Shares (GLD) daily holdings** in tonnes (spdrgoldshares.com history file).
- **Central bank gold purchases**: World Gold Council monthly/quarterly data (free with registration).

## 3. Scheduled news with times (free)
- Historical economic calendar with exact release times and actual vs forecast, at least 2010 to now: US CPI, NFP,
  FOMC decisions and minutes, PCE, retail sales, ISM. Also Fed speeches if available.
- Places to check: official BLS/BEA/Fed release schedules (free), ForexFactory or Investing.com calendar history.
  Respect each site's terms; prefer official sources.

## 4. Cross-market intraday (free)
- 5-minute or 1-minute history for DXY (or EUR/USD as a stand-in), US 10-year yield futures (ZN) or TLT, silver
  (XAG/USD), and S&P 500 futures/SPY. Dukascopy covers the FX and metals ones for free.

## 5. Sentiment (free, optional)
- Retail positioning history for XAU/USD (Dukascopy SWFX sentiment index, Myfxbook community outlook, IG client
  sentiment), as far back as each source goes.

## Deliverables
1. A table: dataset, source, cost, history, resolution, licence/terms notes.
2. The downloaded free files, as CSVs with UTC timestamps, in one folder, with a `README.md` saying where each came from.
3. A total-cost plan that stays **under $100**, showing what each paid item adds over the free ones. Skip any paid
   item whose free substitute is good enough.
4. Python download scripts for anything that updates (COT weekly, GLD daily, calendar), so I can refresh them.

When done, I'll give these files to my gold bot builder. It will test whether order flow, COT positioning, ETF flows
and news timing give gold signals an edge that holds up on years it wasn't tuned on.
