# QuantBot

AI quant developer for MT5 and Pine Script: chat that writes Expert Advisors and Pine strategies, a Strategy Tester
that backtests the newest script in a chat, a Strategy Converter that converts any strategy to MT5 or Pine and tests it
on data the bot has never seen, test history, a PnL calendar and a copy-trading page that runs your scripts on
groups of accounts.

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

Signals: scripts the chat writes (and any script that follows the format in `server/lib/signals.js`) send every buy,
sell, limit, cancel, stop/target move and close as a small JSON message to QuantBot's webhook,
`/hook/<secret key>`. The Signals page logs each one, chimes, shows a desktop notification and lists what is open with
its SL and TP; every signal also goes into the log file. MT5 EAs post to `http://127.0.0.1:<port>/hook/<key>` on the
same PC (allow that address under Tools > Options > Expert Advisors > Allow WebRequest). TradingView sends webhooks
from its own servers, so the desktop app can open a public link through Cloudflare's free quick tunnel (`cloudflared`,
downloaded from Cloudflare's GitHub releases the first time you turn it on; the address changes each time it starts).
TradingView webhooks need a paid TradingView plan with two-factor login. Only `/hook/<key>` answers through the public
link. QuantBot doesn't place orders itself: Lucid and other prop accounts can't be traded through Tradovate's API.

Copy trading (the Copy trading page, `/accounts`): add your scripts, add accounts, make groups, then drag a script onto
a group. The page opens on an overview of the groups (script, P&L, trades made / max, passed / failed / current);
click one to open it (its script, stats, top accounts and latest trades). A group runs one script, so an account
never holds two scripts' trades: dropping a different script asks to replace it (clearing the old one and its open
trades) or keep it, and the copier also skips a signal for an account that still holds another script's trade. Each script has its own webhook address, `/hook/<key>/s/<script id>` (alerts to the plain address are matched
by the strategy name). Every buy / sell is copied to each active account in the script's groups, on paper at the
alert's price: sized so the stop risks the account's "risk per trade" (default 15% of the plan's max loss, $300 on a
Lucid 50K), else the script's quantity x the account's Qty. Set SL / TP moves follow, and a close (or the opposite
signal) settles the trade. An account with an order URL (e.g. a TradersPost webhook) also gets each order sent there
in TradersPost's JSON format, which is how the trades reach a real account. Account plans (LucidPro 25K-150K or
custom) pass an account at the profit target and fail it at the max loss, which trails the best end-of-day balance and
locks at start + $100 for Lucid. A group stops copying when it reaches its max trades (the overview shows e.g. 20/100).
XP per closed trade: 10 for a profit of $5 or less (losses included), 20 up to $10, 30 up to $20, 50 above. Accounts
rank up at 100 XP, then 200 more, 300 more...; scripts at 1,000, then 2,000 more... Logic: `server/copier.js`,
`server/lib/copyRules.js` (shared with the app).

Everything copy trading does goes into an activity log (`CopyEvent`, the newest 20,000 kept) and the log file as
`copy <kind>: ...` lines: each signal and the groups it went to, how every account sized its trade
(`risk $300 / (4 stop x $10) = 7; risking $280.00`), skips and why (group paused, max trades reached, account failed,
one contract over the risk, no open trade to close, event types that aren't copied), fills, SL / TP moves, closes with
P&L, XP and balance, max-loss floor moves, rank-ups, pass / fail, orders sent to order URLs (and failures), and setup
done in the app (script dropped on a group, accounts moved, rules changed, start over, max trades). Prop firms: account rules cover LucidPro 25K-150K (evaluation, then funded; trailing max loss on the New York day)
and FTMO 10K-200K 2-Step (Challenge +10%, Verification +5%, then funded; 5% daily loss on the Prague day, fixed 10%
max loss). Firm limits are checked when an account is saved: Lucid allows 5 funded accounts per person, FTMO any
number of accounts but $400,000 of funded capital at once (badges on the groups overview show what's used).
Auto-withdraw (funded accounts): on the firm's schedule (FTMO every 14 days, 80% split, both editable), when the
account is flat and in profit, QuantBot takes the profit out, logs your share (`Payout`), and starts the account again
from its starting balance; the request itself is made in FTMO's Client Area, which has no payout API.

News and trading hours (per group, `server/lib/blackout.js`): no new trades around news from Forex Factory's weekly
feed and FTMO's economic calendar (`server/news.js`, every 30 minutes, kept in `data/news.json`; impacts and minutes
before / after are settings), 2 minutes either side of FTMO's restricted events (matched on FTMO's instruments, e.g.
"USD + US INDICES + XAUUSD"), on blocked weekdays, in blocked hours and on blocked dates or weeks. Times are in the
PC's time zone. Stops, targets and closes still follow; each blocked signal is logged with the reason.

MT5 (FTMO and other MT5 accounts): turn on "Place the trades on this MT5 account" and run the QuantBot Copier EA
(`mt5/QuantBotCopier.mq5`, downloadable from the account) on that account's terminal, on the same PC or VPS as
QuantBot. It asks `http://127.0.0.1:<port>/mt5/<key>/<account>/poll` every second for orders (open / modify / close,
in 0.01 lots on the account's own symbol via the symbol map, e.g. `MGC1!=XAUUSD`) and reports each fill or error
to `/ack`; fills, slippage and rejections go in the activity log.

Multi-broker MT5 and 24/7 automation (Settings > MT5 & deployment): add MT5 accounts from any broker or prop firm
(FTMO, FundedNext, FOREX.com...) one at a time or many at once (one per line: broker, account number, password,
server, capital, terminal path; pasting from a spreadsheet works). Accounts are ordinary TradingAccount records
(`firm`, `login`, `server`, `capital`, `enabled`, `terminal_path`); the same number on the same server updates the
account instead of adding it twice. Passwords are encrypted with AES-256-GCM (`password_enc`, the same key as the API
keys), can't be written or read through the generic data API, and are only handed to the daemon on this PC
(`server/mt5daemon.js`). The daemon, `mt5/mt5_manager.py` (Python 3 + `pip install MetaTrader5`, Windows), fetches
the enabled accounts from `http://127.0.0.1:<port>/daemon/accounts` with its token, runs one worker process per
account (the MetaTrader5 package talks to one terminal per process), starts and logs in each account's own
terminal64.exe (portable mode), checks the connection every 30 s, logs in again with a growing wait (up to 5 minutes)
when it drops, refuses two accounts sharing one terminal, and reports state, balance, equity and Algo Trading back
to `/daemon/status`, which the accounts table shows live. `--once` does one pass (a test run). The tests run the real
script against QuantBot with a stand-in MetaTrader5 module (`tests/support/fake_mt5`). The VPS guide covers
Windows Server sizing, one MT5 folder per account, Allow algorithmic trading / WebRequest, a startup task at logon
(MT5 terminals need a desktop session, so not as SYSTEM at boot), Sysinternals Autologon, and "Start QuantBot when
Windows starts" (desktop app).

Scripts are written with Claude only: each has its own chat (Open its Claude chat) that always uses Claude and
saves every new version Claude writes as the script's code. Each script also has a folder next to QuantBot's logs
(`<install folder>/scripts/<script>/`, or `data/scripts/` from source) with `CLAUDE.md` (where it trades, results,
recent warnings, your notes), the code, `activity.log`, `trades.csv`, `summary.json` and `notes.md`; QuantBot
rewrites them as things happen (`server/scriptFolders.js`) and reads your edits to `notes.md` back, so Claude Code or
Claude Desktop pointed at the folder has the full context. Below the accounts,
**Activity log** filters it (trades, signals, skips & warnings, ranks & pass / fail, orders, setup, by account, script
or text; click a line for its details) and **Evaluate** shows net P&L, win rate, profit factor, P&L per trade, average
win / loss, max drawdown, best / worst, average hold and an equity curve, with tables by script, account, group, exit
reason and side. Both export CSV. The chat can read all of it too (`copy_trading_summary`, `copy_trading_log`,
`copy_trading_trades`).

Both testers translate the script into JavaScript for the bar-by-bar simulator (`src/lib/backtest/engine.js`), which
runs in a worker and shows how far it has got. Test code that would take more than two minutes (usually code that
rescans the whole chart on every bar, common in ICT scripts) is stopped early and the Strategy Tester asks the model
once for a faster version with the same logic. Stop ends a test at once. Bars carry broker time and New York time
(`ctx.nyHour`), and a run with no trades logs why (entries never triggered, stops on the wrong side, or errors).

Migrated off Base44: everything runs on this PC. Chats, tests, uploaded candle files and settings are saved in
`data/` (one JSON file per table). API keys are encrypted with AES-256-GCM using a secret created in `data/secret.key`.

## Terminal

A trading terminal inside the app (`/terminal`): XAUUSD / US100 candles from the built-in market data, drawn with
TradingView's open-source Lightweight Charts; the day's predicted high / low (the simple guess until the trained
model's daily loop supplies its own); an order ticket that sends market orders with stop and target to a chosen copy
group through the copier (MT5 accounts place them through the Copier EA; the firm rules and news blocks apply); open
positions with Close / Close all. Right-click the chart for presets, revert and the **AI chart editor**: a draggable
chat where the local model (or your default model) changes the chart's look. It can only change chart settings, every
change is a version you can revert or restore (`data/terminal/chart.json`).

Trading tools (`npm run test:terminal` drives all of them in a browser):

- **Rule guard** (on by default): before an order goes out, each active account's room before its daily loss limit
  and its max drawdown is checked against the order's risk; an order that would break a rule on any account is
  blocked, and an order without a stop is blocked while the guard is on (accounts with no limits set always pass).
  The ticket lists every account's room; the orange dashed line on the chart is where price would fail the
  account with the least room (on its open trade, else on the ticket if it filled).
- **One-click trading** (top left of the chart): SELL / size / BUY places a market order on one click with the ticket's stop and target.
- **Hover help**: hold the mouse on any control for 1 second to see what it is, what it does and how to use it.
- **Flatten all** (top right, or Alt+X): closes every Terminal trade on every group and cancels every pending order.
- **$ Risk sizing**: pick dollars per account and a stop; each account gets lots = risk / (stop distance x $ per point).
- **Limit and stop orders**: a *limit* waits for a better price (buy below the price, sell above) and fills when price
  comes back to it; a *stop* waits for a breakout (buy above, sell below) and fills when price pushes through it.
  From the ticket or by right-clicking the chart; drag the dashed line to move one, X to cancel.
- On the Terminal's own trades: **BE** moves the stop to the entry, **Trail** keeps the stop N points behind the price
  (only ever tightening), **½** closes half (MT5 gets a partial close), X closes it.
- **Drawings**: trendline, rectangle and Fibonacci retracement from the tool rail, kept per symbol in this browser;
  click one to select it, Delete or its X removes it.
- **Alerts**: right-click a price for an alert; optional alerts when price touches the model's high / low; high-impact
  USD news as a red line on the chart and a toast 5 minutes before. Sounds, toast corner and duration in the gear menu.
- **Model lines**: the first time the Terminal opens each day, the local model is asked for the day's high / low with
  a confidence (kept in `data/terminal/book.json`); until it answers, the simple guess is shown.
- **Replay**: pick any date in the downloaded history, step candle by candle (→, space to play, 1-10x) and practice
  with the same ticket; practice trades never reach an account.
- **Journal** (`/journal`, also linked from the PnL calendar): every closed trade, logged automatically, with chart
  pictures at open and close, a setup and a note per trade, win rate, profit factor and average R per setup, and
  history import from MT5 (History, Positions, saved as CSV / tab file) or any CSV with the usual columns.

More protection and speed (all per group or per PC, off unless set):

- **Daily profit lock**: when an account is up the set amount today, new trades stop; with "+ stops to entry" the
  Terminal's open trades on that group also get their stops moved to break-even (checked every 5 s).
- **Loss-streak cooldown**: after N losses in a row, trading pauses for M minutes.
- **Consistency meter**: each account's best day as a % of its total profit, orange when over the firm's cap.
- **Hotkeys** (gear menu, off by default: single keys trade for real): B / S buy or sell at the one-click size, C
  closes all, E stops to break-even, H closes half; every key can be changed.
- **Order templates**: save the ticket (side, type, size, stop and target as distances) and refill it in one click.
- **Auto bracket**: every new trade without a stop gets one N points away and a target at R times that.
- **Sessions**: Asia / London / New York shaded in each city's own hours, and yesterday's high / low (PDH / PDL).
- **Weekly report** (Journal; a toast on Sunday / Monday): profit, win rate, average R, best / worst setup and day,
  rule-breaks blocked; Save as PDF prints it.
- **Model scorecard** (Journal): the model's saved daily highs / lows against what happened, and the hit rate by the
  confidence it gave, so you can see whether to trust it.
- **Overview** (`/overview`): every group and account with balance, today, total, room before the firm's limits,
  open trades and how its MT5 is connected.

**MT5 fast lane (live gold prices and instant orders).** The QuantBot Copier EA (v2) keeps one socket open to the
app (127.0.0.1, the app's port + 1; add `127.0.0.1` under MT5 Tools > Options > Expert Advisors > Allow WebRequest
next to the Copier address). Over it the EA streams its chart's live ticks, and every order is pushed to MT5 the
moment the app has checked it (rule guard, news blocks, sizing), with no polling; fills come straight back. The app's
own time, from its first check to the order leaving for MT5, is shown on every order ("Checked and sent to MT5 in
0.62 ms") and in the top bar (`npm test` measures it: about 0.5-0.9 ms median). The rest is outside the app: MT5's
timer picks the order up within ~1-16 ms (Windows timer steps, or on the next tick), then your broker's server
(typically 20-200 ms). With the EA connected, pending orders, trailing stops and alerts are checked on every MT5 tick
on the app's side, even with the Terminal page closed; without it, the HTTP poll and Dukascopy prices take over.

Pending orders, trailing stops and alerts are checked against the live price while the Terminal is open (the latest
Dukascopy minute candles, every 10 seconds); MT5 accounts still get plain market orders when one fills.

## Train (Unsloth on your GPU)

The **Train** page fine-tunes a small open model to predict each day's high and low from the 10 days before it,
then tests it on later days it never saw against a simple guess. It runs Unsloth's official Docker image
(`unsloth/unsloth:core`) on this PC's NVIDIA GPU.

- Needs: Docker Desktop (WSL 2) and a current NVIDIA driver. The page checks both and downloads the image (about 10 GB).
- Models: eight recommended for an 8 GB RTX 4060 (all checked on Hugging Face): **Qwen3.5 2B** (default, about 5 GB),
  Qwen3.5 0.8B, Qwen3 1.7B 4-bit, Llama 3.2 1B / 3B 4-bit, Gemma 3 1B 4-bit, Phi-4 mini 4-bit and Qwen3 4B 4-bit
  (tight). Or **any Hugging Face model** (search, or type owner/name; gated ones with your token), or a **model
  folder on this PC**. The page checks the files first: Safetensors and PyTorch .bin weights can be trained; GGUF,
  ONNX, MLX and EXL2/GPTQ/AWQ are run-only formats, so it points you to the original repo. It estimates the GPU memory
  and picks 16-bit LoRA or 4-bit QLoRA.
- Hugging Face token: stored encrypted on this PC (`data/train/hf.json`), handed to the container through its
  environment only. Needed for gated models (accept the license on the model's page) and uploads.
- Exports: the LoRA adapter always; optionally the full model as 16-bit or 4-bit safetensors and GGUF (Q4_K_M,
  Q5_K_M, Q8_0, F16) for Ollama, llama.cpp and LM Studio, and an upload of all of it to your Hugging Face account.
- Data: the built-in XAUUSD hourly history, or your own MT5 export.
- Settings are picked for your GPU by default (largest batch that leaves memory spare, effective batch 16, LoRA rank
  16 / alpha 32, 2e-4, 2 epochs); the script trims the sequence length to the longest real example, trains on the
  answers only, and halves the batch by itself if the GPU runs out of memory.
- Every run also writes an **Unsloth Studio recipe** (`unsloth_studio/`: the config YAML and an alpaca-format dataset)
  you can Upload in Unsloth Studio to look at or re-run the same training there.
- Each run is a folder in `data/train/<id>`: config, train/test data, `events.jsonl`, the LoRA adapter, test
  predictions and `result.json`. The training script is `train/unsloth/qb_train.py` (it also runs on its own:
  `python qb_train.py <folder>`).

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
in the first time the app opens. The log is `logs\quantbot.log` in the install folder (Settings > Logs shows the path
and opens the folder); a copy is kept in `%APPDATA%\QuantBot` while an update installs and put back afterwards. Windows may warn about an unrecognised app the first time (the installer isn't
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

- Direct broker connections: copy trading fills on paper at the alert price; real orders go through each account's
  order URL (TradersPost or similar), not straight to Tradovate or MT5.
- Login: there are no accounts. One trader per PC.
