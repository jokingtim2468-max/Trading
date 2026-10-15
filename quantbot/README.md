# QuantBot

AI quant developer for MT5 and Pine Script: chat that writes Expert Advisors and Pine strategies, a Strategy Tester
that backtests the newest script in a chat, a Strategy Converter that converts any strategy to MT5 or Pine and tests it
on data the bot has never seen, test history, a PnL calendar and trading-account / copy-group management.

Built-in market data: XAUUSD (from 2003), US100 and NQ (from 2011 intraday, 1990 daily), downloaded free from
Dukascopy by the desktop app the first time a range is used (Dukascopy now only serves real browsers behind Amazon's bot
check, so downloads go through the app's built-in Chromium, one request at a time) and saved in `data/market/`, in broker time (UTC+2 / UTC+3 like MT5).
Pick any timeframe from M1 to D1 and any dates; M1 tests cover up to 370 days. NQ uses the Nasdaq-100 index prices on
NQ's contract terms (Dukascopy has no CME futures data), so absolute prices sit slightly below the futures.

The Converter converts a strategy once and tests that same bot on XAUUSD, US100 and NQ, ranks every market and
version in a leaderboard, then opens a chat linked to that bot ("Fine-tune in chat") with the results and code. In
any chat the AI can read your saved tests, their trades and the built-in market data through read-only tools
(`server/lib/chatTools.js`): list_tests, get_test_run, get_trades, get_bars, market_stats, list_markets. Its system
prompt (`server/lib/chatPrompt.js`) explains the backtester, the markets, broker time and how to use the tools. AI: your own Claude (Opus / Sonnet / Haiku 5.5) or Gemini key, or a free local model through
Ollama (Settings → Local model).

Both testers translate the script into JavaScript for the bar-by-bar simulator (`src/lib/backtest/engine.js`), which
runs in a worker and shows how far it has got. Test code that would take more than two minutes (usually code that
rescans the whole chart on every bar, common in ICT scripts) is stopped early and the Strategy Tester asks the model
once for a faster version with the same logic. Stop ends a test at once. Bars carry broker time and New York time
(`ctx.nyHour`), and a run with no trades logs why (entries never triggered, stops on the wrong side, or errors).

Migrated off Base44: everything runs on this PC. Chats, tests, uploaded candle files and settings are saved in
`data/` (one JSON file per table). API keys are encrypted with AES-256-GCM using a secret created in `data/secret.key`.

## Install on Windows

Download **QuantBot-Setup-x.y.z.exe** from the [latest release](https://github.com/jokingtim2468-max/Trading/releases/latest),
or paste this into PowerShell to fetch it and open the wizard:

```powershell
irm https://raw.githubusercontent.com/jokingtim2468-max/Trading/vibe-coded/clever-thompson-2f91fo/quantbot/installer/install.ps1 | iex
```

The setup wizard lets you pick the install folder and adds **QuantBot** to the Desktop and Start Menu. QuantBot is its
own app (Electron, `desktop/`) with its own title bar: a loading window with real progress, then the main window grows
open. Closing the window ends QuantBot completely. The testers use the built-in XAUUSD, US100 and NQ data only. Each time it opens it
checks the GitHub releases and, when there's a newer version, downloads and installs it first (progress in the
loading window). Settings > Updates shows the version and can install an update now. Your data lives in
`%APPDATA%\QuantBot\data` and is kept through updates and uninstalls; data from the older PowerShell version is copied
in the first time the app opens. Windows may warn about an unrecognised app the first time (the installer isn't
code-signed): click **More info**, then **Run anyway**.

Releases are built by GitHub Actions (`.github/workflows/quantbot-desktop.yml`) on every push that changes `quantbot/`:
unit tests, the UI build, then `electron-builder` makes the NSIS installer and publishes it as release v1.0.<run>.
Build one yourself on Windows: `cd desktop && npm install && npm run dist` (output in `desktop/release/`).

## Run from source

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
npm run test:launcher  # the source-folder launcher: install, open, publish and install an update
npm run test:desktop   # the Electron app: loading window progress, main window, data folder (Linux: xvfb-run)
```

The end-to-end run uses Playwright's Chromium (`npx playwright install chromium`) or an installed Chrome / Edge via
`CHROME_PATH`. Screenshots go to `test-results/e2e/`.

## Not included yet

- Copy trading: the MT5 / Tradovate copier engine lived in a separate desktop app repo. Accounts and copy groups can
  be managed here, but connecting and copying stay off until the engine is added.
- Login: there are no accounts. One trader per PC.
