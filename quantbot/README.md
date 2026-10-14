# QuantBot

AI quant developer for MT5 and Pine Script: chat that writes Expert Advisors and Pine strategies, a Strategy Tester
that backtests the newest script in a chat, a Strategy Converter that converts any strategy to MT5 or Pine and tests it
on data the bot has never seen, test history, a PnL calendar and trading-account / copy-group management.

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
npm test
```

## Not included yet

- Copy trading: the MT5 / Tradovate copier engine lived in a separate desktop app repo. Accounts and copy groups can
  be managed here, but connecting and copying stay off until the engine is added.
- Login: there are no accounts. One trader per PC.
