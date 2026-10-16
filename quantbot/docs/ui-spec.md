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
