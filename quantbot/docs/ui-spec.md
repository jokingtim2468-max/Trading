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

## Motion: grow from the click, shrink back into it

Everything that opens from a click uses one motion.

- **Open:** grows from 5% size and fully transparent to full size, starting at the spot that was clicked.
- **Close:** shrinks back to 5% and fades out, into the same spot it came from. That is the spot clicked to open it,
  not the close button.
- **Timing:** 400 ms (slowed to 0.75x from 300 ms so the growth is easy to follow and doesn't feel abrupt), easing
  `cubic-bezier(0.2, 0.8, 0.2, 1)` (Tailwind `duration-pop` and `ease-pop`).
- **Backdrops** behind dialogs fade in and out over the same 400 ms.

| Element | Grows from |
|---|---|
| Pages (sidebar links, back arrows) | the exact click point |
| Dialogs (add account, add market data, groups) | the exact click point |
| Delete-chat confirmation | the exact click point |
| Toasts (e.g. "Message failed") | the click that led to them (up to a minute before) |
| Mobile sidebar | the menu button tap |
| Dropdown menus, selects, market picker | the button that opened them (Radix anchor origin) |
| Tooltips | not animated this way (they open on hover, not a click) |
| Date fields | the browser's own date picker, which can't be animated |

## Numbers and charts

- **Numbers** on reports (result tiles, Monte Carlo stats, PnL summary, history cards, leaderboards) count up from 0
  to their value in 0.6 s, easing out.
- **Charts** draw themselves in over 1 s. Every chart has a **Replay** button (top right) that draws it again.
- **Reduced motion:** when the computer's "reduce motion" setting is on, numbers and charts show at once and the
  open/close motion is off (for people who get motion sickness).
- **Leaderboard** at the bottom of every Strategy Tester run, Converter run and saved session: every market and
  version ranked by net P&L, with return, win rate, profit factor, max drawdown, trades and the Monte Carlo grade.
  Click a row to open that run.

## Market data

- Built-in markets: XAUUSD (1-minute bars from May 2003, daily from 1999), US100 (1-minute bars from Sept 2011,
  daily from Nov 1990) and NQ (the same Nasdaq-100 prices on NQ's contract: 0.25 tick, $20 per point, 1-tick spread),
  downloaded free from Dukascopy and saved on the PC.
- The Converter converts a strategy once and tests that bot on every picked market (all three by default).
- Bar times are broker server time: UTC+2, or UTC+3 while New York is on daylight saving (like FTMO's MT5).
- Timeframes: M1, M5, M15, M30, H1, H4, D1. M1 tests cover up to 370 days.

## Desktop app (Electron)

- **Installer:** NSIS wizard (choose folder, Desktop and Start Menu shortcuts, run after finish) with a 164 x 314 side
  image: dark `#34342F` to `#1F1F1D` gradient, faint grid, the blue price line with a glow (`desktop/make-sidebar.mjs`).
- **Loading window:** frameless 440 x 460, a 22 px rounded card with a soft shadow and grain; grows in from 60% scale
  (400 ms); same logo morph, wordmark, progress bar and percentage as below. At 100% it scales up slightly and fades
  while the main window fades in (about 200 ms).
- **Main window:** Windows dark title bar with the QuantBot icon, 1440 x 920 by default (remembers its size and
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
