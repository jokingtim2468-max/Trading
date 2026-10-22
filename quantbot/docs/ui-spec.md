---
tags: [quantbot, ui-spec]
---

# QuantBot UI spec

Drop this file into your Obsidian vault. It mirrors what the code does; the source of truth is
`src/index.css` (colors, fonts), `tailwind.config.js` (easing) and `src/lib/clickOrigin.js` (motion).

## Colors (dark theme)

| Role | Token | Hex |
|---|---|---|
| Background | `hsl(60 3% 15%)` | `#272725` |
| Card / popover | `hsl(60 2% 19%)` | `#31312F` |
| Sidebar | `hsl(30 3% 12%)` | `#201F1E` |
| Text | `hsl(51 30% 95%)` | `#F6F5EE` |
| Muted text | `hsl(42 5% 64%)` | `#A8A59F` |
| Primary (accent blue) | `hsl(204 85% 66%)` | `#5FB7F2` |
| Text on primary | `hsl(210 50% 10%)` | `#0D1926` |
| Border / input | `hsl(48 4% 23%)` | `#3D3C38` |
| Hover (accent) | `hsl(43 4% 16%)` | `#2A2A27` |
| Destructive / loss (red) | `hsl(0 84% 60%)` | `#EF4343` |
| Profit (green, chart-2) | `hsl(142 71% 45%)` | `#21C45D` |
| Chart 3 | `hsl(199 89% 60%)` | `#3EBAF4` |
| Chart 4 | `hsl(43 74% 66%)` | `#E8C468` |
| Chart 5 | `hsl(27 87% 67%)` | `#F4A462` |

## Type and shape

- Headings: Source Serif 4. Body: Inter. Code: the system monospace font.
- Both fonts ship with the app (`public/fonts/`, SIL Open Font License), so they look the same on every PC and
  offline; nothing loads from Google Fonts.
- Corner radius: 0.75 rem (12 px) on cards; buttons and inputs use the shadcn defaults (`rounded-md`).

## Depth: four levels

| Level | What | Look |
|---|---|---|
| 1 Page | App background | `#272725` with a faint noise grain over everything (3.5% opacity) |
| 2 Content | Cards, report tiles | Solid `#31312F`, 1 px border, a 4% white lip on top, short shadow `0 1px 2px rgb(0 0 0 / .28)` |
| 3 Chrome | Sticky page bars (Tester, Converter, PnL, Accounts) | Frosted glass: background at 72%, 14 px blur, 6% white bottom edge, shadow `0 6px 24px rgb(0 0 0 / .18)` |
| 4 Overlays | Menus, pickers, popovers, toasts (80%, 18 px blur) and dialogs (88%, 24 px blur, 16 px corners) | Glass with a 10-12% white edge and a deep shadow (`0 16px 40px` / `0 24px 64px`) |

- Glass only on surfaces with little text; chat, reports and tables stay solid for contrast.
- Without backdrop blur support every glass surface falls back to its solid color.
- Dialog backdrops dim the page to 55% black with a 3 px blur, so the glass has something to show.
- The chat composer floats at level 3 depth but stays solid.

## Report layout

- **Headline numbers** (4 large tiles, Source Serif 4, 24 px): Net P&L (with a green / red bar on its left edge and the
  return under it), Profit factor (with a verdict: healthy edge 1.5+, thin edge 1-1.5, losing under 1), Win rate (with
  the trade count), Max drawdown (red above 10%, with the dollar amount).
- **Detail ledger** underneath: every other metric as label / value rows in one bordered panel, 3 columns on desktop.
- **Facts** about a run (version, market, dates, model) are label / value pairs (muted label, bright value), never a
  dot-joined string.
- Version pills: `v1 XAUUSD -$212 22 trades MC F` (MC = Monte Carlo grade, its score in the tooltip).

## Home screen

- Greeting, then two cards: **Sessions** (Tokyo, London, New York with a live dot, a progress bar while open, and
  "opens in / closes in"; MT5 server time; a note during the London / New York overlap) and **Last test** (bot, market,
  latest net, link to Test history; or how to start with the Converter).

## Motion: simple fades and short slides

Nothing grows or zooms any more. Everything fades with a short slide.
- **Timing:** 200 ms, easing `cubic-bezier(0.25, 0.1, 0.25, 1)`. These are Tailwind's `duration-pop` and `ease-pop`;
  `MOTION` lives in `src/lib/clickOrigin.js`.

| Element | Motion |
|---|---|
| Pages | fade in sliding up 12 px; fade out sliding up 6 px |
| Dialogs and confirmations | fade in while rising slightly (from 48% to 50% of the window); backdrop fades |
| Dropdown menus, selects, popovers | fade, sliding 4 px away from the button that opened them |
| Toasts | fade in sliding up from the bottom edge; fade out sliding right |
| Phone sidebar | slides in from the left edge and fades; slides back out |
| Copy trading: opening a group | the group fades in sliding from the right; "All groups" slides the overview back in from the left |
| Desktop app opening | the page fades in sliding up 10 px (300 ms) |
| Pressed buttons | fade to 75% while held (no size change) |
| Settings > Motion "Reduced" | everything appears straight away |

## Numbers and charts

- **Numbers** on reports (result tiles, Monte Carlo stats, PnL summary, history cards, leaderboards) count up from 0
  to their value in 0.6 s, easing out.
- **Charts** draw themselves in over 1 s. Every chart has a **Replay** button (top right) that draws it again.
- **Reduced motion:** when the computer's "reduce motion" setting is on, numbers and charts show at once and the
  open/close motion is off (for people who get motion sickness).
- **Leaderboard** at the bottom of every Strategy Tester run, Converter run and saved session: every market and
  version ranked by net P&L, with return, win rate, profit factor, max drawdown, trades and the Monte Carlo grade.
  Click a row to open that run.
- **Signals page** (sidebar, radio icon, after Accounts): sticky glass header like the other pages, then three cards.
  **Webhook**: "Send test signal" (outline, send icon); a bordered "TradingView public link" box (desktop app only)
  with a state pill (Off / Downloading / Connecting / On, green border when on), a Turn on / Turn off button, the URL in
  a monospace field with a Copy button (check icon for 1.5 s after copying) and one paragraph of setup help; a second box
  with the "MT5 / this PC" address; "New secret key" (ghost button, key icon). **Open from signals**: one small card
  per open position or pending limit: side pill (LONG / SHORT / BUY LIMIT / SELL LIMIT), symbol, qty, strategy, and
  Entry / SL (red label) / TP (green label) in monospace. **Signal log**: filter tabs (All, Entries, SL / TP moves,
  Closes), Clear log, and a table newest first with a coloured pill per event: BUY green, SELL red, BUY/SELL LIMIT
  lighter green/red, SET SL amber, SET TP sky blue, CLOSE neutral, CANCEL muted. New signals chime (two notes, rising
  for buys, falling for sells) and show a desktop notification; test signals stay quiet.
- **Settings > Logs** (desktop app only, under Updates): a card titled "QuantBot's log file" with one line of help,
  the full log path in small monospace muted text, and an outline **Open logs folder** button (folder icon) that opens
  the `logs` folder in the install folder in File Explorer.
- **Test progress:** while a test simulates, the status line under the loader counts up ("XAUUSD: simulating
  trades... 42% of 45,120 bars"). The Strategy Tester's **Run test** button turns into an outline **Stop** button
  (square icon) while it runs, like the Converter's; Stop ends the test at once with no error shown.

## Copy trading page

- **Layout:** header "Copy trading". On wide screens a 300 px **Scripts** column (sticky) sits left of the accounts;
  on phones it stacks on top.
- **Scripts panel:** card with a trophy icon (chart-4 yellow), "Add script" outline button, and the scripts ranked by
  XP (1, 2, 3... in muted numbers). Each row: rank picture (40 px), name, "<tier> · <xp> XP · <n> trades · <P&L>"
  (P&L green / red), "Trading <groups>" or "Not on a group", a pencil and a grip. Rows are dragged onto a group.
- **Groups overview** (top card): "Groups" with a grid of group cards (1 / 2 / 3 per row) and a dashed "New group"
  card. Each group card shows its name, Futures / MT5 pill, Paused, a chevron, then the **script** (24 px ranked
  picture, name, the script's P&L in this group), a full-width **P&L** row (profit green over loss red on the left,
  total on the right), **Trades made** "20/100", **Passed · Failed · Current**, and up to 7 account pictures.
  Cards are drop targets for accounts and scripts (2 px primary ring while hovered); cards an account can't join
  fade to 40%.
- **Group view** (click a card): "← All groups", the name, account count and the ••• menu (rename, pause, delete).
  Then **Script**: the script's card (44 px picture, rank, XP, its P&L, trades and win rate here, X to take it off)
  next to the dashed **script slot** ("Drag a script here" / "Drag a different script here to replace it"),
  highlighted primary while a script is dragged.
- **One script per account:** dropping a different script on a group, or moving an account with an open trade into
  a group running another script, asks "There is already one on this account" with **Keep <script>** (outline)
  and **Yes, replace it** (primary). Replacing clears the old script and its open trades from those accounts.
- **Top accounts** (trophy icon): the group's accounts best first by gain, with 1st / 2nd / 3rd places in gold,
  silver and bronze circles (one account shows without a place). Each row has a picture, name, tier, balance, gain,
  status, risk or Qty, and an X to take the account out.
- **Three stat cards** (rounded-xl, background/60, small uppercase muted labels):
  - **P&L:** profit (green `+$`) over loss (red) in small type on the left, the total large on the right (green if up,
    red if down).
  - **Trades:** "made/max" large with the max muted ("20/100"), a 6 px primary progress bar, a small Max field and
    "Start count again".
  - **Accounts:** three columns, Passed (green), Failed (red), Current (text color).
- **Members:** 30 px rank picture, trader name, the account name muted, tier name in tier color, balance, a status pill
  (Current muted, Passed green border, Failed red border) and "Risk $300" or a Qty field.
- **Latest trades:** up to 8 rows: trader, "Buy 7 MGC1!" (green) / "Sell..." (red), entry -> exit, P&L, "+50 XP".
- **Account cards:** 46 px rank picture, random trader name (e.g. "Crimson Falcon") in medium weight, then
  "<account name> · <login> on <server>", then "<tier> · into/need XP"; the **script** it trades (file icon in
  primary, or "No script: add it to a group"), balance with the change since the start, and a Passed / Failed pill.
- **Accounts card:** platform tabs, Sort, Add account, then filter chips "All accounts", "Not in a group" (a drop
  target to take an account out) and "In <group>" while a group is open.
- **Script dialog:** name, language, a primary-tinted "Written with Claude" box with **Open its Claude chat** (or
  "Save and write it with Claude"), the code, **Its folder (for Claude)** with the path and an Open folder button
  (desktop app), and the script's webhook addresses.
- **Add account dialog:** 56 px picture, "Trader name" field with a dice button (new random name and picture),
  then name, login (optional for TradingView), platform, and a "Copy trading" box: Account rules (LucidPro 25K / 50K /
  100K / 150K, Custom, Just track it), Risk per trade, Order URL.
- **Activity log / Evaluate** (card under the accounts, tabs on the left, "<group> only" or "All groups" muted):
  - Activity: filter chips (All, Trades, Signals, Skips & warnings, Ranks & pass / fail, Orders, Setup) with counts,
    a search field, account and script selects, an outline **Export CSV** button. Lines: time (muted, tabular),
    a small uppercase kind pill (signal primary, open green, move / skip / limit chart-4 yellow, rank violet, order sky,
    others muted) and the message (yellow for warnings, red for errors). Clicking a line opens its details as JSON.
  - Evaluate: 8 stat tiles, 4 per row (Net P&L, Win rate, Profit factor, Per trade, Avg win / loss, Max drawdown,
    Best / worst, Avg hold), a 180 px primary equity area chart, then tables By script, By account, By group, By exit
    and Longs vs shorts; **Export trades CSV** top right.
- **Account dialog, prop accounts:** Stage select (Evaluation / Challenge / Verification / Funded) with the firm's
  rules as the hint; a red line under it when the firm's limit is reached (Save is disabled). Funded accounts get a
  bordered box: a "Withdraw profit automatically every 14 days" switch, Your split % and Every (days).
- **Account dialog, MT5:** a bordered box with a "Place the trades on this MT5 account" switch and, on the right, the
  EA status (green "EA connected 3s ago", muted "EA not connected yet"); then Symbol map, the Copier address with a
  copy button, and three numbered steps with a "Download QuantBot Copier" link.
- **Account cards:** a muted pill "<firm> <stage>" (e.g. "FTMO Funded") and "· $3,200.00 out" after the balance once
  money is withdrawn.
- **Groups overview:** firm badges on the right of "Groups": "Lucid funded 3/5", "FTMO funded $300K / $400K"
  (chart-4 yellow when full).
- **News and trading hours** (in the open group, above the Tradovate guide): calendar-off icon in chart-4, a pill
  "Open for new trades" (green) or "No new trades now" (yellow, with the reason under it), "Times in <zone> (this PC)"
  on the right. Then: Block news switch with minutes before / after; source chips (Forex Factory, FTMO calendar) and
  impact chips (High, Medium, Low, Holiday); FTMO restricted events switch; Blocked days chips Sun-Sat; Blocked hours
  (time pairs as removable chips, two time fields and +); Blocked dates and weeks (date range, note, +); and "Next
  news blocks for <symbol>" (FTMO-restricted ones in yellow) with Refresh and when the calendars last updated.
- **Activity log:** new chips "News & hours" (block, yellow pill) and "Payouts" (payout, green pill).
- **Settings tabs:** "General" and "MT5 & deployment" (the page widens to 4xl on the second; `?tab=deploy`).
- **Multi-broker MT5 accounts card:** a 3-column form (Broker / prop firm, Account number, Password, MT5 server,
  Capital, Terminal), a primary "Add account to daemon" button and an outline "Add many at once" that opens a
  monospace textarea (one account per line) with "Add these accounts". Results list each line in green (added /
  updated) or red (the reason). Then a compact table: account (firm + number + capital, server and terminal muted
  under it), daemon pill (Connected green, Logging in yellow, Error red with the reason under it, Needs its password
  yellow, Auto-login off / Last seen muted), broker balance / equity, Auto-login switch, and a small password field
  with a key button.
- **MT5 auto-login daemon card:** title with a pill ("Running: 2/6 accounts connected" green, else "Not reporting" /
  "Not started yet"), three numbered steps (Python + pip, Download mt5_manager.py, run it), the daemon command with a
  copy button, and an outline "New token" button.
- **24/7 VPS deployment card:** "Start QuantBot when Windows starts" switch (desktop app), then 7 numbered steps with
  copyable install and startup-task commands.
- **Drag and drop:** drops follow the pointer (the target under the cursor), not the card's size. The page only
  auto-scrolls when dragging into the outer 10% of the window.
- **No wrapping:** numbers, labels and table cells stay on one line (they truncate); activity lines show one line and
  the full text when clicked; Evaluate tiles hold one value each, 5 per row.

### Rank pictures and tier rings

QuantBot's own design (not copied from any other app). A round picture made from the account's seed: a two-color
diagonal gradient with a white 5 x 5 mirrored pattern, inside a 6-unit ring. The ring's faint track is the tier color
at 25%; the bright arc fills clockwise from the top with progress to the next level. A small pill under the picture
shows the level in black on the tier color. Three levels per tier (I, II, III); Legend counts on (Legend 4, 5...).

| Tier | Levels | Hex | Ornaments |
|---|---|---|---|
| Unranked | 0 | `#6B7280` | none |
| Iron | 1-3 | `#8B8F98` | none |
| Bronze | 4-6 | `#C27C4E` | 4 studs |
| Silver | 7-9 | `#C9D1DC` | studs + top crest |
| Gold | 10-12 | `#F2C14E` | studs + crest |
| Platinum | 13-15 | `#5EE0C8` | studs + crest + side wings |
| Diamond | 16-18 | `#6FA8FF` | bigger studs + crest + wings |
| Master | 19-21 | `#B57BFF` | studs + wings + crown |
| Legend | 22+ | `#FF5D73` | studs + wings + crown + soft red glow |

XP: 10 for a closed trade of $5 or less (losses too), 20 up to $10, 30 up to $20, 50 above. Accounts level up at 100
XP, then 200 more, 300 more...; scripts at 1,000, 2,000 more...

## Terminal page

- Sidebar entry **Terminal** (candlestick icon), route `/terminal`, full height. Its own dark trading palette, the
  familiar trading-terminal layout, QuantBot's logo and motion (no TradingView logo or icons):

| Role | Hex |
|---|---|
| Chart / page background (Dark preset) | `#131722` |
| Panels, menus, chat | `#1e222d` (95% with blur on overlays) |
| Borders, grid | `#2a2e39` / `#1e222d` |
| Text / muted | `#d1d4dc` / `#787b86` |
| Up candles, profit | `#089981` |
| Down candles, loss, Sell | `#f23645` |
| Buy, primary action | `#2962ff` |
| Model / guess high-low lines | `#e8c468` dashed |

- Top bar (46 px): back, logo, symbol select (XAUUSD, US100), timeframes M1-D1 (selected one on `#2a2e39`), **Edit
  chart**, **Trade on** group select, MT5 status (green dot "MT5 4/4" when every MT5 account in the group is logged in).
- Left tool rail (52 px): Crosshair, Horizontal line (click the chart to drop a blue line), Remove all lines.
- Chart: TradingView's open-source Lightweight Charts (credited in the positions bar, "Charts by TradingView
  Lightweight Charts™"). OHLC legend top left follows the crosshair. Price lines: guess / model high and low, open,
  ticket SL / TP (dotted), open positions (entry solid with "Buy 1 × 4", SL / TP dashed).
- Right-click menu: 14 px corners, glass `#1e222d` at 95%, 9 px rounded items that highlight on hover, the app's pop
  motion: Edit chart with AI…, **Presets ›** (side submenu with a two-tone swatch per preset: Dark, Black background,
  Gray background, Black & white candles, Light, Hollow candles, QuantBot), Revert last change, Reset to default, then
  Horizontal line / Stop loss / Take profit at the clicked price.
- Chart editor: a 400 px floating window with 20 px corners, dragged by its header (grip icon, position remembered),
  minimise and close; preset chips, a chat (blue own bubbles, `#2a2e39` replies), Versions pills with "now" and
  **Revert**, input + blue Send. It can change only the chart settings (colors, grid, candles, model lines).
- Trades on the chart (the Terminal's own): a solid entry line (blue buy, red sell) with a dark pill at the right
  edge: "Buy 0.4 × 4", entry price, live P&L (green / red), **TP** and **SL** buttons that drag out a target or stop
  when there is none, and an **✕** that closes the trade on every account. Stops and targets are dashed lines with a
  solid pill (green TP, red SL) you drag up and down: while dragging it shows the price, the move from the entry
  ("+$100.00" for $100 above a buy) and the money across the accounts ("+$2,305.60 · 4 acc", cents always shown);
  letting go moves it on every account. Trades opened by scripts show as plain lines.
- Order ticket (300 px): symbol and "Market order", a Sell / Buy segmented switch with the price (selected side
  filled red or blue), Size / Stop loss / Take profit steppers (− and + either side, stop and target show their
  dollar risk / reward live), a summary box (accounts, risk, reward), and a full-width Buy (blue) or Sell (red) button
  pinned at the bottom with the result line under it.
- Positions bar (190 px): every open trade of the group, Close per Terminal trade, Close all.

## Train page

- Sidebar entry **Train** (CPU icon), route `/train`, under Signals. Same sticky glass bar as Signals.
- **This PC** card: three check rows (green check / grey cross): Docker version, NVIDIA GPU name and memory, Unsloth image
  downloaded (with size). A **Download Unsloth** button (about 10 GB, once) shows the last `docker pull` line beside it.
- **Hugging Face** card: status pill (green "Signed in as <user>", grey "No token: public models only"), a password
  field for the `hf_…` token with **Save token**, or **Remove token** once signed in.
- **New training run** card: data (built-in XAUUSD hourly, or an MT5 export path on this PC); a three-way pill switch
  (blue when selected): **Recommended** (a 2-column grid of model tiles, the default marked with a star, each with a tag
  and GPU memory badge that turns amber when it won't fit, the note and the repo id in small mono), **Hugging Face**
  (search box with a search icon, results list with downloads / GGUF / gated, or type owner/name) and **Folder on this
  PC**; for the last two a Method select (Auto / LoRA 16-bit / QLoRA 4-bit) and an info box that fades in: size, files
  found (Safetensors, PyTorch .bin, GGUF, ONNX, MLX, EXL2/GPTQ/AWQ), green "Trainable" with the memory need, amber when
  it's too big, red when it holds only run-only formats;
  train and test date ranges (the test must start after training ends), and a bordered **Pick the training settings
  for my GPU** switch (on by default) that spells out the chosen batch, accumulation, epochs, learning rate and LoRA rank
  and why. Switched off, a **Training settings** row (epochs, learning rate, LoRA rank, batch size, gradient
  accumulation, max sequence length) fades and slides in.
- **Run cards** (newest first, fade and rise in): model name, status pill (blue running phase, green done, red error,
  grey stopped), a progress bar with step, loss, epoch and GPU memory, a blue loss line, four result tiles (model error,
  simple guess error, better than guess, test days) and a verdict line: green 15%+ better, amber 3-15%, grey no edge.
  Under it, blue download links for the run's **Unsloth Studio recipe** (the config YAML and the alpaca dataset), and
  each export's result (red if one failed; the Hugging Face link in blue).
- **Save the trained model as**: checkboxes in two columns (LoRA adapter always on; full model 16-bit / 4-bit
  safetensors; GGUF Q4_K_M, Q5_K_M, Q8_0, F16), then an **Upload to Hugging Face** repo field with a Private box
  (greyed out until a token is saved).
- Polls every 2 s while a run or download is going, every 10 s otherwise.

## Market data

- Built-in markets: XAUUSD (1-minute bars from May 2003, daily from 1999), US100 (1-minute bars from Sept 2011,
  daily from Nov 1990) and NQ (the same Nasdaq-100 prices on NQ's contract: 0.25 tick, $20 per point, 1-tick spread),
  downloaded free from Dukascopy and saved on the PC.
- The Converter converts a strategy once and tests that bot on every picked market (all three by default).
- Bar times are broker server time: UTC+2, or UTC+3 while New York is on daylight saving (like FTMO's MT5), which is
  always New York time + 7 hours. Test code gets both clocks (`ctx.hour`, `ctx.nyHour`).
- Timeframes: M1, M5, M15, M30, H1, H4, D1. M1 tests cover up to 370 days.

## Desktop app (Electron)

- **Installer:** NSIS wizard (choose folder, Desktop and Start Menu shortcuts, run after finish) with a 164 x 314 side
  image: dark `#34342F` to `#1F1F1D` gradient, faint grid, the blue price line with a glow (`desktop/make-sidebar.mjs`).
- **Loading window:** frameless 440 x 460, a 22 px rounded card with a soft shadow and grain; grows in from 60% scale
  (400 ms); same logo morph, wordmark, progress bar and percentage as below. At 100% it scales up slightly and fades
  while the main window fades in (about 200 ms).
- **Opening:** the main window appears at its real size and fades in (160 ms) while the page zooms out of the middle
  of the window, 94% to 100% and transparent to solid (420 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`), as the loading
  card fades away. No window resizing (that stuttered).
- **Motion setting:** Settings > Motion, "Full animations" (default) or "Reduced". QuantBot follows this, not
  Windows' "Animation effects" switch (which used to turn every animation off on PCs where it's off).
- **Title bar (QuantBot's own, no Windows frame):** 34 px, sidebar color `#201F1E`, 5% white bottom edge; the candle
  logo, "QuantBot" in Source Serif 4 SemiBold 13 px and the current page in muted 12 px; minimize, maximize / restore
  and close buttons 48 px wide with lucide icons, hover `#F6F5EE` at 10% (close: red `#EF4343`, white icon). Drag
  to move, double-click to maximize.
- **Closing** the window ends QuantBot completely (server and process); a downloaded update installs then.
- **Main window:** 1440 x 920 by default (remembers its size and
  position), minimum 960 x 640, background `#272725` so it never flashes white.

## Source-folder launcher: icon, loading screen, updates

- **Icon:** a rounded square, gradient `#34342F` → `#1F1F1D`, with a blue price line (`#3E9FE0` → `#7CC8F7`)
  (`installer/quantbot.ico`), used by the
  Desktop and Start Menu shortcuts.
- **Window:** Microsoft Edge app mode (its own window and taskbar entry, no tabs or address bar), 1440 × 920.
- **Loading screen** (`launcher/splash.html`): radial background `#2F302D` → `#272725`; the price line morphs
  through three shapes every 2.4 s with a soft blue glow; "QuantBot" in Source Serif 4 SemiBold 46 px; tagline in
  Source Serif 4 Light 16 px, muted `#A8A59F`.
- **Progress bar:** 6 px track (`#31312F`, 1 px `#3D3C38` border), fill gradient `#3E9FE0` → `#5FB7F2` with a glow
  and a sheen sweeping every 1.6 s. The percentage (Inter SemiBold 22 px, tabular numbers) and step label sit above
  it. It shows real progress (git download %, packages installed of total, modules built of total), eases toward the
  real value, never passes it and never goes backwards.
- **Motion:** the loading screen grows in (400 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`) and shrinks away into the app
  at 100 %. Reduced motion turns this and the sheen off.
- **Errors:** a red panel with the reason, **Try again**, and **Open the installed version** when one exists.
- **Version** bottom-left: `v1.0.0 · commit · date`, 11 px `#6F6C66`.

### Terminal: default chart look and toasts
- Default preset **Gray · B&W candles** (`graybw`): background `#2f3033`, grid `#3a3b3f`, text `#d1d4dc`, rising candles `#ffffff` (wick `#e0e0e0`), falling candles `#0b0b0c`, crosshair `#9598a1`. Right-click → Reset to default applies it; the old dark look is the **Dark** preset.
- Toasts (TradingView style): bottom-right stack, max 4, newest on top. Card `#1e222d`, border `#363a45`, radius 12px, 340px wide, shadow `0 16px 40px rgba(0,0,0,.55)`.
  Round tinted icon (buy `#2962ff`, sell/stop/error `#f23645`, take profit `#089981`, close `#d1d4dc`), bold white title, gray `#9598a1` detail lines, X to dismiss.
  A 2px bar in the icon color runs down over 5 s, then the toast closes; hovering pauses it. Slides in from the right, fades out (none in calm mode).
  Titles: Order executed · Take profit modified · Stop loss modified · Position close sent · Order rejected.

### Terminal: trading tools
- Order types: Market / Limit / Stop segmented control (`#1e222d` track, `#2a2e39` selected), one gray `#787b86` line under it saying what the type does. Size: Lots / $ Risk switch.
- Rule guard card: border `#2a2e39`, radius 10px, shield icon `#089981` when on, switch `#089981` / `#363a45`. One row per account: dot green `#089981`, the lowest account orange `#ff9800`, a blocked one red `#f23645`; "risk of room" on the right.
- Lowest-limit line: orange `#ff9800`, dashed, 2px, title "Limit <account> · <rule>".
- Flatten all: solid red `#f23645` button, white bold text, top bar far right. Shortcut Alt+X.
- Pending orders: dashed line in the side color (buy `#2962ff`, sell `#f23645`), dark `#1e222d` pill with a dashed border, drag to move, X to cancel.
- Entry pill buttons: BE, Trail (yellow `#e8c468` when on), ½, X. The Trail box opens under the pill (zoom-in pop). A stop at break-even moves its pill to the left of the chart so it never covers the entry pill.
- Drawings: blue `#2962ff` 2px lines, rectangles with 12% fill; Fibonacci levels gray `#787b86`, 0.5 and 0.618 yellow `#e8c468`, labels `#9598a1` 10px; selected drawing white with a red round X at its end.
- News: red `#f23645` dashed vertical line at 70% opacity, 10px bold label at the top.
- Toast kinds and icon colors: alert bell `#e8c468`, news calendar `#f23645`, pending clock `#2962ff`, trailing stop `#e8c468`. Default corner: top right of the chart, under the top bar (clear of the ticket and price scale); detail lines wrap up to 3 lines, other corners and 3 / 5 / 8 / 15 s in the gear menu.
- Replay bar: 42px, `#1e222d`, under the top bar, slides down; Replay button turns solid blue `#2962ff` while on; ticket says "Practice (replay)".
- Bottom panel tabs: Positions / Orders / Alerts (Practice in replay), selected tab white with a 2px `#2962ff` underline.
- Journal page: app theme cards (`bg-card`, rounded-xl), profit `text-chart-2`, loss `text-destructive`, chart thumbnails 40x28 opening full size on a 70% black backdrop.

### Terminal: one-click trading and hover help
- One-click box, top left of the chart under the OHLC row: red `#f23645` SELL (price on top, 13px semibold; "SELL" 10px under), size field with − / + in `#1e222d`, blue `#2962ff` BUY. 8px radius, `#363a45` border, shadow `0 6px 18px rgba(0,0,0,.45)`. Size steps 0.01 under 1 lot, else 1; remembered on this PC. It uses the ticket's stop / target and the rule guard still applies.
- Hover help: hold the mouse on any Terminal control for 1 second. Card 280px, `#1e222d`, border `#363a45`, radius 10px, white 13px semibold title, `#b2b5be` 12px text, zoom-in pop; below the control, or above near the bottom of the screen. Hides on click or scroll. Texts live in `src/lib/terminalTips.js`.
- Sounds (Web Audio sine, no files): order filled / moved = two rising notes 660 → 880 Hz; alert = 660 → 880 → 660 Hz; news = twice that (660 → 880 three times, 6 beats, about 0.8 s); error / rejected = falling 523 → 392 Hz. Notes 0.12 s apart, each 0.2 s with a soft attack, quiet (gain 0.15). Off in the gear menu.
- Voice: after a fill's chime a voice says "Order filled" (the PC's own text-to-speech; English natural / Aria / Jenny / Zira voice preferred, rate 1.05). Switch "Say Order filled" in the gear menu.
- Custom fill sound: gear menu → Fill sound → Choose… (audio file under 1 MB, kept in this browser). When set, a fill plays only that file (no chime, no PC voice); Test plays it, Reset goes back to the PC voice.

### Terminal: price feed and speed badge
- Top bar, right of the MT5 count: 1.5px dot + text 12px tabular. Live: green `#089981`, pulsing dot, "MT5 live <bid> / <ask>"; then gray `#9598a1` "· app 0.62 ms" (checks to order sent) and "· fill 23 ms" (sent to MT5's confirmation). No EA: gray `#5d606b` "Delayed price".
- Order toasts add a line "Checked and sent to MT5 in 0.62 ms" when the order went over the fast lane.

### Terminal: protection, templates, sessions
- Protection (inside the Rule guard card): "Protection" link `#9598a1` with a sliders icon opens a form on `#131722` at 60%: inputs 64px, blank = off; lock mode as two 24px buttons (selected `#2962ff`). Under each account: gray `#787b86` 11px lines, orange `#ff9800` when the lock is hit, the cooldown is running or the best day is over the cap.
- Templates: chips 24px tall, round, `#363a45` border, above the ticket fields; "+ Template" dashed.
- Sessions: full-height bands at 6% opacity: Asia `#e8c468`, London `#2962ff`, New York `#089981`, 10px label at the bottom; hidden on H4 and D1. PDH / PDL: gray `#9598a1` long-dashed price lines.
- Hotkeys: gear menu rows, key buttons 44px min, blue while waiting for a key; master switch off by default.
- Overview page and the Journal's Weekly report / Model scorecard use the app theme cards (`bg-card`, rounded-xl), profit `text-chart-2`, loss `text-destructive`.

### Accounts: Fleet panel and the Add / Configure Account Profile drawer
- Fleet panel sits at the top of the Accounts page (above the Scripts / Groups columns). It polls `/api/fleet` every 5 s.
- KPI cards (4, testid `fleet-kpi`): Active, Passed, Failed, Net Fleet P&L. Card `bg-card`, border `#2a2e39`, rounded-2xl. Big number 24px semibold; label 11px `text-muted-foreground`. Net P&L number `text-chart-2` when ≥ 0, `text-destructive` when < 0.
- **Failed is a real count, not a cosmetic 0.** It shows how many accounts actually hit a firm's fail rule. The daily loss floor / kill switch stop an account trading *before* it breaches, so in normal running it stays 0 — but a real failure is shown honestly. Nothing is pinned.
- Table (testid `fleet-table`), one row per account, `data-account="<label>"`: Account ID + details subline · Firm & model (or plan) · Platform · Group select (testid `fleet-group`) · Active script / profile (testid `account-script`) · Balance & P&L · Status pill (testid `fleet-status`) · Actions.
- Status pill colors: ACTIVE green `#089981` on `rgba(8,153,129,.12)`; PASSED 🎯 cyan `#22d3ee` on `rgba(34,211,238,.12)`; FAILED red `#f23645` on `rgba(242,54,69,.12)`; PAUSED gray `#787b86` on `rgba(120,123,134,.12)`. Rounded-full, 11px semibold, 2px 8px padding.
- Row actions: Edit details (pencil, aria-label `Edit <label>`), Edit config (opens the drawer on that account), Audit payout (dialog), Pause / Resume.
- **Add / Configure Account Profile** drawer (sheet from the right, testid via the ProfileConfigurator): dropdowns cfg-firm, cfg-model (LucidFlex labelled "LucidFlex (Recommended 🏆)"), cfg-size (sizes with no preset disabled), cfg-platform (NinjaTrader disabled), cfg-target (new or an existing account). An auto-populated card (testid `cfg-card`) shows risk + example lots for a 3-point stop, TP ratio, daily cap + consistency, daily floor + broker limit, kill switch, stop floor + ATR, target / max drawdown, buffer, contracts. A warning box (testid `cfg-warning`) shows the honest backtest (exhaustion engine PF 0.87 on 2004–2026 gold). "Deploy to VPS Fleet" button posts `/api/fleet/deploy` and returns a `.set` download link for MT5.

### Payout engine (server/lib/fleetRules.js → payoutAudit, server/payouts.js)
- Five rules enforced before any withdrawal: (1) 14-day lockout from the cycle start (last payout, else funded date, else first trade); (2) drawdown buffer kept in — the account's `buffer_usd`, else 2.5% of the start balance — never withdraw 100%; (3) consistency audit (40 % / 50 % of total profit per day) showing the extra profit needed to dilute the best day; (4) flat-position check (no open trades); (5) a JSON Payout record + a Discord / Telegram webhook note.
- Withdrawal lowers the balance by the gross amount (it is **not** reset to the start) and adds to `withdrawn`. The note names the 80 % trader split and the buffer left in, with the firm's payout page link.

### Settings: Agent team (local Ollama)
- Card (testid `agent-team`) in the Models section, under Default models and Local model. Bot icon `text-primary`.
- Controls: Running model select (testid `agent-model`, from the Ollama test), Agents 1–4 (testid `agent-count`), Step limit per agent (default 40), Backtest translator (the app's models, default the user's default model).
- Start / Stop buttons (testids `agent-start` / `agent-stop`). Per-agent log cards (testid `agent-log`): status color thinking `text-primary`, testing `text-chart-4`, done `text-chart-2`, error `text-destructive`, limit / stopped `text-muted-foreground`.
- Each agent works in `data/agents/<model>/agent-N/` (data/ read-only), acts through one command per reply (LIST / READ / WRITE / DELETE / BACKTEST / DONE), and backtests on XAUUSD, US100 and NQ (M5 by default, last 180 days) with the same engine as the Script Tester. Note mentions `OLLAMA_NUM_PARALLEL=<count>` so agents run at the same time.

### Settings: Local model — "Set up a model for my PC"
- A box (testid `model-setup`) at the top of the Local model card. "Check my specs" button (testid `model-detect`) calls `localModel` action `recommend`: the server reads the NVIDIA GPU (`nvidia-smi`), RAM and CPU and returns the largest coding model that fits with headroom.
- Specs line (testid `model-specs`): GPU + VRAM (or "No NVIDIA GPU found"), CPU + cores, RAM. Then the recommendation (model label, tag, ~size) and a one-line note. Ladder: ≥15 GB → Qwen2.5-Coder 14B; ≥5.5 GB → 7B (the 8 GB sweet spot); ≥3.5 GB → 3B; else 1.5B (CPU-friendly).
- "Install <model>" button (testid `model-install`) calls action `install`, which streams `POST /api/pull` from Ollama. A progress bar (testid `model-progress`) polls `pull_status` every 1.2 s: primary fill while downloading, `text-chart-2` + check on done (then the model is auto-saved and selected), `text-destructive` on error.

### Chat: /loopfix (auto-improve a script on a timer)
- Typed in the main chat: `/loopfix` (improve the chat's linked script, else the most recently updated one), `/loopfix <name>` (a named script), or `/loopfix stop`.
- A local Ollama model backtests the script on XAUUSD / US100 / NQ (M5, 180 days), scores it (profit factor and net up, drawdown and too-few-trades down), keeps the best version, writes a better one, and repeats every 10 minutes until the best hasn't improved for 3 rounds ("as good as it got"). The engine (`src/lib/agents/loopfix.js`) is a module singleton so it keeps running as you move between pages; it stops when the app closes.
- Status panel (testid `loopfix-panel`) above the composer: spinning icon while testing / fixing, round number and phase, a countdown to the next round, the best-so-far line (testid `loopfix-best`, `text-chart-2`: PF · DD% · net · trades), a Stop button (testid `loopfix-stop`) and the last few log lines (testid `loopfix-log`). The improved script is written back to its Script record each round, so the Copy trading page and its chart show the latest version live.

### Home screen: this week's P&L (replaces "Last test")
- The home screen's right card is now **This week** (testid `home-week-pnl`), not the last backtest. It reads `/api/fleet` and shows this week's realised P&L across every running account (big number, testid `week-net`, `text-chart-2` ≥ 0 / `text-destructive` < 0), the count of accounts running, trades closed this week with the win %, and a Today and All-time line. Empty state links to Accounts. The week starts Monday 00:00 local; today starts at midnight. P&L comes from closed `AccountTrade` records, summed server-side in the fleet view.

### Backtest: candle-accurate language auto-detection
- BACKTEST (agent team and /loopfix) detects Pine vs MQL5 from the file name and, failing that, from the code itself (`//@version=5` / `strategy()` → Pine; `OnTick` / `#property` / `CTrade` → MT5) via `detectLanguage`, so the right engine runs even if the extension is wrong. The engine (`src/lib/backtest/engine.js`) is bar-close accurate: signals fire on the candle close, fills at the next candle's open, SL is checked before TP intrabar (worst case), spread is applied, and exact candle timestamps are kept. It has no sub-candle tick fills — 20-year tick data isn't available — so intrabar order is always resolved pessimistically rather than guessed.

### Agent team / loop-fix: timeframe (M5 by default)
- The Agent team card has a Timeframe select (testid `agent-tf`, M5 / M15 / M30 / H1 / H4; M5 labelled "most accurate"). Loop-fix always uses M5. The built-in market data is stored as minute (M1) bars and every timeframe is resampled from it, so M5 is the most granular — the tightest intrabar SL/TP sequencing and the closest to real fills. The agent kickoff and the loop-fix report state the timeframe actually used.

### Market Lab (quant-data engine) — /market-lab
- Sidebar link "Market Lab" (microscope icon). Pick a market, timeframe (M5 default) and range, press Analyze; it loads the bars and computes the quant feature pack client-side (`src/lib/quant/features.js`, pure + unit-tested) — the same numbers the AI and an ML filter read.
- Cards: period summary (return, up-bar %, median & 95th-pct bar range); Volatility by hour (24 themed bars, testid area under `lab-results`); by session and weekday; Return distribution (21-bucket histogram, testid `lab-hist`; mean/std/skew/kurtosis in the hint); Volatility regime (ATR filled line, testid `lab-atr`); Momentum & autocorrelation (lag 1–5 bars — positive = trending, negative = mean-reverting — plus P(up|up) vs base rate, breakout rate, gaps, longest runs).
- "For machine learning" card: a Copy feature vector button (testid `lab-vector`) copies the flat numeric row `featureVector` produces, with a one-line honesty note that ML sharpens a bot that already has an edge and can't rescue a losing one. Bars render red for negative values, the theme primary for positive.

### Walk-forward / out-of-sample robustness
- `src/lib/backtest/walkForward.js` (pure, unit-tested) splits a run's closed trades by time into consecutive windows and into an in-sample / out-of-sample split (default 70/30). It reports per-window net/PF, how many windows are profitable, the OOS net/PF, whether the edge **holds out-of-sample** (`oosHolds`), and a 0–1 robustness score. `robustnessVerdict()` gives a one-line verdict ("robust…", "weak out-of-sample — likely overfit", "overfit: loses out-of-sample").
- **Strategy Tester** logs a "Walk-forward: …" line next to the Monte Carlo result (green when it holds OOS, amber when it doesn't).
- **/loopfix and the agent team** now optimise for it: `scoreOf` folds the walk-forward score in and heavily rewards holding out-of-sample, so keep-best chases a strategy that repeats on unseen data instead of a prettier in-sample curve. The loop-fix best line and report, and the agent BACKTEST report, show the per-window result and the OOS net/PF; the agent's DONE target now requires holding out-of-sample. This is the main guard against the loop overfitting.

### Loop-fix / agent: two-pass backtest (vanilla + parameter-optimized)
- Each loop-fix round runs two passes: the script **as the model wrote it** (vanilla), then **optimization trials** (`src/lib/quant/optimize.js`) that perturb the script's signal/exit inputs — TP ratio, ATR period, stop floor, etc. (not risk/size/firm caps) — backtest each variant, and keep the one with the best **out-of-sample robustness** score. The winner is the same script with tuned numbers, so it stays a deployable .pine/.mq5.
- Both results are written to `results/<name>.results.md` (and `results/latest.md`) with an "Optimization pass" section listing the vanilla score, every trial's params/score/OOS, and which was kept — the file the model reads before its next structural edit. The live Script record is updated with the kept version so the Copy trading page shows it.
- Cost note: each trial re-translates and backtests the script. Trials default to 5 (settable via `start({ trials })`, 0 disables). For a free/fast loop, set the backtest translator to your local Ollama model.
- `parseInputs`/`applyInputs`/`trialSets`/`optimizeScript` are unit-tested. ML here means automated parameter search selected on unseen data — a take/skip neural filter can't be expressed in Pine/MQL5, so it isn't baked into the deployed script.

### Planned (not built): multi-agent debate orchestration
- A future layer to arrange several agents into a configurable conversation — who speaks to whom and the order they critique/"argue" a problem before converging on a script. Noted here so the agent folder model (`data/agents/<model>/agent-N/`, per-agent inbox/results) stays compatible with it; not implemented yet.

### Deploy readiness gate
- `src/lib/quant/readiness.js` (pure, unit-tested) turns a backtest into one honest verdict — PASS / CAUTION / FAIL with a 0–100 score and reasons — from checks that reuse what's already measured: enough trades (30+), net profit, profit factor > 1.1, drawdown within the account's max-DD limit, **holds out-of-sample** (walk-forward), consistency across windows, and Monte Carlo survival when present. A `fail` check (loses OOS, drawdown over the limit, unprofitable) blocks PASS; soft issues (thin trades, soft PF) are CAUTION.
- Surfaced wherever a script is judged: the **Strategy Tester** logs a "Deploy readiness: GRADE (score) — reasons" line after Monte Carlo; the **loop-fix** results file and the **agent BACKTEST** report both end with the same line, so the AI optimises toward a deployable verdict, not just a pretty curve.

### Train: Auto-train card
- First card on the Train page (testid `auto-train`, primary-tinted border). `GET /api/train/autoconfig` reads the PC: GPU name + VRAM (nvidia-smi), Docker running, Unsloth image installed. Three check rows (green check / grey cross, the page's `Check` component).
- Plan box (testid `auto-train-plan`): the recommended model — the curated "Best fit" under 12 GB (Qwen3.5 2B on 8 GB), else the largest that fits with 1 GB headroom — plus the auto settings (batch × accumulate, LoRA rank, LR, epochs, sequence) and the reason, and the exports: adapter + GGUF Q4_K_M under 12 GB (F16/Q8_0 merge the full model and can crash small cards), adapter + Q8_0 at 12 GB+.
- Blockers listed in `text-chart-4` when anything's missing (no Docker, no NVIDIA GPU, Unsloth not downloaded). "Auto-train with these settings" (testid `auto-train-start`) is disabled until ready; `POST /api/train/autostart` re-checks and refuses with the blockers.

### Train: exports can't kill a finished run
- Each export format (and the Hugging Face upload) runs in its own Python process after the trained model's VRAM is released; scores are saved to result.json before exporting. A crash in one format (e.g. GGUF F16/Q8_0 running out of memory on 8 GB) is recorded as "failed (exit N): reason — likely out of memory: use GGUF Q4_K_M" and the other formats still run. A failed Docker run now shows the container's last log lines in the error instead of only pointing at output.log.

### Strategy Lab (Converter + Tester + Market Lab in one page)
- One sidebar link, "Strategy Lab" (flask icon). Header: back arrow, "Strategy Lab", a segmented tablist (`bg-accent/40` track, selected tab `bg-background` + shadow) with Convert / Test / Market (testids `lab-tab-convert|test|market`), History link on the right.
- Each tab keeps its own URL (`/strategy-converter`, `/strategy-tester`, `/market-lab`; `/strategy-lab` opens Convert) and its panel heading (h2 "Strategy Converter" / "Strategy Tester" / "Market Lab"). A tab is mounted the first time it's opened and then only hidden, so a running test and anything typed survive switching tabs; `PageTransition` gives all four URLs one key so the page doesn't animate/remount between tabs.

### Train: click a model to start
- Under the Auto-train button, every model is a button (testid `auto-train-models`, `data-model=id`): name, ~VRAM and tag; the recommended one has the primary border. Clicking starts training at once with settings computed for that model on this GPU (`POST /api/train/autostart { model }`); models too big for the card are disabled, and the server refuses them too.

### Local model install: Ollama handled too
- "Install <model>" now makes sure Ollama answers first: starts it if installed but stopped, and on Windows installs it with winget (`Ollama.Ollama`) if missing, then pulls the model. Status text shows each phase ("installing Ollama (winget)…", "starting Ollama…", "downloading…"); failures say what to do instead of "fetch failed". A non-local Ollama address is never touched, only reported.

### Background services start themselves
- **Ollama:** any local-model call (chat, agent team, /loopfix, Settings test/install) that finds Ollama not answering starts it — or on Windows installs it with winget first — then retries once. Remote Ollama addresses are never touched.
- **Docker + Unsloth:** a training run (manual, Auto-train or click-a-model) starts Docker Desktop if it's closed (Windows `Docker Desktop.exe`, macOS `open -a Docker`, Linux `systemctl --user start docker-desktop`, waits up to 3 min) and downloads Unsloth's image if it's missing, showing each step as the run's phase. On the Auto-train card these show as grey notes ("Docker Desktop will be started for you", "Unsloth … will be downloaded on the first run"), not blockers; only things the app can't fix (no NVIDIA GPU, Docker Desktop not installed) block.
- Never under CI or the test suite (`CI` / `QUANTBOT_NO_AUTOSTART`): there the app reports instead of installing or launching anything.

### Strategy Tester: account, firm rules, replay
- **Account picker** (testid `account-picker`) under the run controls: Account size dropdown (default **$10K**; sizes from the presets), Prop-firm chips (testid `firm-chips`, `data-firm`) showing only firms that offer that size plus "No firm (plain account)", and — once a firm is picked — an "<Firm> account type" dropdown with that firm's models at that size (Lucid: LucidFlex / LucidPro…). Chips that stop applying **slide all the way off to the right** (framer-motion exit `x: 110vw`, 0.55 s, ease-in; `popLayout` so the rest reflow at once; reduced motion: fade). New ones slide in from the left. A rules line (testid `account-rules`) states target / max loss (static or end-of-day trailing) / daily loss / consistency. Changing size keeps the firm and type when they still exist, else falls back to no firm.
- The test's balance is the account size. With a firm picked, `evaluateProp` (`src/lib/backtest/propRules.js`, unit-tested) walks the closed trades against the preset's rules; a verdict banner (testid `prop-result`) shows PASSED 🎯 (`text-chart-2`), FAILED (`text-destructive`), IN PROGRESS (`text-chart-4`) or ACTIVE, with the date and reason (e.g. "max drawdown: balance $8,953 hit the floor $9,000"), trading days and lowest balance.
- **Replay** tab (first tab, testid `trade-replay`): the tested candles play bar by bar (lightweight-charts; 5–2000 bars/s; Play/Pause, Next trade, restart, scrubber). Entries appear as green ▲ Buy / red ▼ Sell arrows with lots, exits as dots with reason and P&L, and the open trade shows its entry (blue), SL (red dashed) and TP (green dashed) lines. Status: bar time, running balance, trades so far, the open position.
- Charts pin `localization.locale: 'en-US'` — an invalid browser locale tag (e.g. `en-US@posix`) otherwise crashes lightweight-charts (Terminal chart too).

### Chart tab: tools, position tool, prop-account simulation
- **Tools snap back to the cursor** after placing anything (trendline, rectangle, Fibonacci, horizontal line, position), so the next click selects instead of drawing again. Click any drawing to select it (white), then **Backspace/Delete** removes it (or the red ✕). Horizontal lines are drawings now (saved per symbol, selectable, deletable).
- **Position tool** (ruler icon, second in the toolbar): one click places a simulated long at that price — stop ~3 average candles away, target at 2R, **0.01 lots**. Green target zone / red stop zone (20% fill) 260 px wide, white entry line. Labels: "Target $X · N pts" (`#089981`), "Stop -$X · N pts" (`#f23645`), and a dark pill with Long/Short (click to flip), an editable lots field and "lots @ entry · R:R". Square handles drag the target and stop; dragging the box moves the whole position. $ = points × lots × the symbol's point value. Labels/handles stay pinned inside the chart. It never sends an order.
- Trading size defaults to **0.01 lots** (ticket and one-click; existing saved one-click sizes are reset once to 0.01).
- **Simulate a prop account** (Replay bar button): the account picker (size, firm chips, account type) — practice trades are judged live by `simAccount`: max-loss floor (static, or trailing the best end-of-day balance, Lucid locked at start + $100) and the daily loss limit both count open losses. Status strip under the replay bar: ACTIVE / PASSED 🎯 / FAILED pill, balance, equity, floor + room (amber under 25% left), today's P&L + daily loss left, $ to target. A failed account is closed out at the current price and new practice trades are refused; picking an account starts a fresh one.

### Strategy Tester: "All accounts"
- An **All accounts (16)** chip sits after "No firm" in the tester's firm chips (only there, not in the chart's simulator). It tests every firm / type / size in the presets; each size gets its own run at that balance (sizing follows the balance) reusing the one translation, then `rankAccounts` orders them: passed (earliest first), funded accounts that never broke (most profit), still in progress (closest to target), failed (lasted longest).
- Result card (testid `all-accounts`): a headline (testid `best-account`) — "Best account: <firm type size> PASSED 🎯 date · reason", or "No account passed. Lasted longest:" when none passed — with "N of 16 passed", then a ranked table (#, account, size, result pill, when/why, trading days), the best row tinted. Reasons show money as $47,465.80 (two decimals unless whole dollars).

### Train: every market, one model that knows them apart
- Data "Built-in markets (hourly, downloaded automatically)": market chips (testid `train-markets`, `data-market`) Gold (XAUUSD), Nasdaq-100 (NQ), US100 — all on by default except US100 (NQ and US100 are the same Nasdaq-100 price feed, so picking one turns the other off; MNQ is the same prices too). Each run downloads every chosen market's hourly history if it isn't on the PC (phase "downloading NQ data"), one file per market.
- Each training example names its market and that market's last-year profile — average daily range and 1-sd daily move, computed only from days before the forecast day — so one model learns how gold and the Nasdaq-100 behave differently. Scores are reported overall and per market. Examples start after a year of history (the profile needs it).

### Chat workspaces
- No folder to pick anywhere: a normal chat's first reply names the chat (the script's own `// Script:` name if the reply has one, else a short 2–5 word title from a quick call to the same model; on any failure the first words of the message stay), and that name becomes its workspace, `data/workspaces/<chat-name>/` (README.md, scripts/, results/; a taken name gets -2, -3…). Older chats get theirs on their next message.
- Every script the AI writes in the chat is saved there as `scripts/<script-name>.mq5` / `.pine` (newest version). Copy-trading script chats keep their own script folders.
- Chat header: a small folder chip (testid `chat-workspace`, FolderOpen icon, the folder name, `border-border`, xs muted) after the title; the tooltip shows the full path; in the desktop app clicking opens the folder (Electron `workspace:open`, only folders inside data/workspaces).

### Account presets: each firm's published rules (checked 2026-10-21)
- 122 account types across 8 sizes ($2.5K–$200K), each with the firm's own numbers and `rules_source`/`rules_checked` on the firm: **Lucid** Flex / Pro (+ funded) 25–150K — target $1,250/3,000/6,000/9,000, max loss $1,000/2,000/3,000/4,500 end-of-day trailing locking at start + $100, **optional** daily loss $600/1,200/1,800/2,700, Flex 50% consistency in eval, Pro 40% funded, 2/4/6/10 minis. **FTMO** 10–200K — 2-Step 10% then 5%, 5% daily (open losses count), 10% static, 4 trading days; funded 5%/10%; 1-Step 10%, 3% daily, 10% end-of-day trailing that never locks, 50% best day. **The5ers High Stakes** 2.5–100K — 10% then 5%, 5% daily, 10% max, 3 profitable days (0.5%+); funded. **Alpha Pro** 6% / 8% / 10% at 2.5–200K — 6→6%, 8→5%, 10→5% targets, 3/4/5% daily from the day's starting balance, 6/8/10% static max; Qualified (funded).
- The trader's own numbers (risk per trade, caps, floors, kill switch, buffers) are kept for every type that already had a preset; new types: risk 10% of max loss, own daily floor 40% of the daily limit (20% of max loss without one).
- The rules engine needs every rule at once to pass (target, consistency, minimum trading days, minimum profitable days) and says what's still missing ("2 of 4 trading days"). A daily limit the firm sells as optional gets a checkbox in the account picker (testid `account-dll`, on by default); the rules line spells out every limit.
- All accounts shows the top 15 ranked with "Show all N" (testid `all-accounts-more`).

### Chart tab: Close all (replay)
- Red "Close all (N)" button in the replay bar (testid `replay-close-all`, `#f23645`, disabled at 30% when nothing is open): closes every open practice trade at the current price. Live accounts keep "Flatten all" in the top bar.

## Train page (one button)
- Only control: a grid of model buttons (best fit for this GPU preselected, too-big models disabled) and one large "Train" button.
- Settings, markets (XAUUSD + NQ), dates, exports, Docker and Unsloth are chosen automatically. No Hugging Face / API options.
- Runs list below shows progress, loss chart, results and Stop/Delete.

## Chart: position tool and prop account
- Position box: TP zone green #089981, SL zone red #f23645, both at fill opacity 0.17 (15% more transparent than 0.2).
- TP/SL are TradingView-style order lines: dashed line + draggable price pill (price and $) just right of the box.
- Box label has a Buy/Sell quick button: sends at market with the box's stop/target distances.
- "Prop account" toolbar button opens Replay with the account picker. Firms that don't offer the chosen size show dimmed (dashed) and jump to their nearest size.

## Chart: indicators (Pine + MQL5)
- "Indicators" button in the Terminal top bar opens a popover (same glass style and click-origin pop as the settings menu).
- Quick add: EMA 20/50, VWAP, Bollinger Bands, RSI 14, MACD, ATR 14. Paste box for Pine Script or MQL5.
- Overlay indicators draw on price; the others share one pane below (25% of the chart height). Each row has show/hide and delete.
- Pine runs in the app directly; MQL5 (and Pine with loops / var / functions) is rewritten to simple Pine by the model, then runs the same way.

## Replay (real time) and Pine Editor
- Replay plays in real time: 1× = one market second per second; speeds 1×, 10×, 60×, 300×. The forming candle ticks along the real 1-minute path (open→low→high→close for up candles, open→high→low→close for down). "Next candle" jumps to the next bar.
- Practice stops/targets are checked on every price move.
- "Pine Editor" tab under the chart: script list on the left, code editor with line numbers, Add/Update on chart, Ctrl+S.
- Position box: drag the middle to move it in price and time; the white handle on the right edge resizes its width.

## Chat: local only + system-prompt handshake
- Model menus offer only "Local model (Ollama)"; Settings no longer shows API key or default-model cards.
- When a chat is created, the full system prompt is sent as its first (hidden) message ending "reply with exactly: OK".
  A toast says "System prompt loaded" when the model answers OK, or shows its actual reply when it doesn't.
- The hidden handshake always opens the conversation sent to the model.

## Chat: live text + queue; Train: Ollama models
- While replying, the chat shows the model's live output (thinking first, then the answer) in a left-bordered mono block; "Using <tool>…" during tool calls.
- Messages typed during a reply show in the queue above the composer and go out one by one; the queue survives page switches.
- Train page: "Your Ollama models" row (installed Ollama models mapped to their Unsloth weights); the chat model is preselected when it fits the GPU. After training, the GGUF is added to Ollama as <name>-gold.

## Title bar: model status light (top right, before the window buttons)
- Dot + model name; checked every 15 s; click opens Settings.
- Bright green with glow = loaded in memory; soft green = installed, loads on first message; amber = not installed; red = Ollama not running; grey = no model set.

## Web access + training examples
- Chat tools web_search / web_fetch: Ollama's web search when an Ollama key is saved (Settings → local model, optional), else DuckDuckGo with Bing as backup.
- Training adds example scripts (shipped strategies + the trader's bots with PF > 1.3, DD < 10%, 30+ trades) at ~5% of the data; trained models are added to Ollama with Unsloth's Modelfile (chat template kept).

## Model menus list each Ollama model by name
- Chat, Strategy Tester and Agent Team menus show every installed Ollama model as "<Family> <size> · <strength>" (e.g. "Qwen2.5 Coder 7B · coding"); the Settings model is first and marked (default); "-gold" models read "trained on your data".
