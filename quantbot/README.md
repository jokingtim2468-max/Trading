# QuantBot

AI quant developer for MT5 and Pine Script: chat that writes Expert Advisors and Pine strategies, a Strategy Tester
that backtests the newest script in a chat, a Strategy Converter that converts any strategy to MT5 or Pine and tests it
on data the bot has never seen, test history, a PnL calendar and trading-account / copy-group management.

Built-in market data: XAUUSD (from 2003), US100 and NQ (from 2011 intraday, 1990 daily), downloaded free from
Dukascopy the first time a range is used and saved in `data/market/`, in broker time (UTC+2 / UTC+3 like MT5).
Pick any timeframe from M1 to D1 and any dates; M1 tests cover up to 370 days. NQ uses the Nasdaq-100 index prices on
NQ's contract terms (Dukascopy has no CME futures data), so absolute prices sit slightly below the futures.

The Converter converts a strategy once and tests that same bot on XAUUSD, US100 and NQ, then ranks every market and
version in a leaderboard. AI: your own Claude (Opus / Sonnet / Haiku 5.5) or Gemini key, or a free local model through
Ollama (Settings → Local model).

Migrated off Base44: everything runs on this PC. Chats, tests, uploaded candle files and settings are saved in
`data/` (one JSON file per table). API keys are encrypted with AES-256-GCM using a secret created in `data/secret.key`.

## Run

```bash
npm install
npm start          # http://localhost:5173
```

Add a Claude (`sk-ant-...`) or Gemini (`AIza...`) API key in Settings. AI calls go straight from this PC to
Anthropic or Google with your key.

For a production build: `npm run build`, then `npm run serve`.

Options: `QUANTBOT_PORT` (default 5173), `QUANTBOT_DATA` (default `./data`), `QUANTBOT_USER` (your display name).
The server only listens on 127.0.0.1 and refuses requests from other websites.

## Test

```bash
npm test           # backend, market data, backtest engine, accuracy vs hand-written rules
npm run test:e2e   # launches QuantBot with fake Claude / Ollama / Dukascopy and clicks through every feature
```

The end-to-end run uses Playwright's Chromium (`npx playwright install chromium`) or an installed Chrome / Edge via
`CHROME_PATH`. Screenshots go to `test-results/e2e/`.

## Not included yet

- Copy trading: the MT5 / Tradovate copier engine lived in a separate desktop app repo. Accounts and copy groups can
  be managed here, but connecting and copying stay off until the engine is added.
- Login: there are no accounts. One trader per PC.
