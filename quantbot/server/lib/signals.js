// Signal standard for every generated strategy: distinct BUY / SELL / CLOSE / TP / SL events that the testers can
// check, sent live to QuantBot's webhook (server/signals.js, Signals page) so the trader sees each order as it happens.
export const SIGNAL_EVENTS = ['buy', 'sell', 'buy_limit', 'sell_limit', 'cancel', 'set_sl', 'set_tp', 'close'];
export const CLOSE_REASONS = ['tp', 'sl', 'time', 'signal', 'eod', 'daily_limit', 'breakeven', 'manual'];

const MESSAGE = `QUANTBOT SIGNALS (mandatory): every trade action is also sent to QuantBot's webhook as one JSON message, so the trader's Signals page logs it, chimes and tracks the position:
{"qb":1,"event":"buy","symbol":"<symbol>","tf":"<timeframe>","price":21450.25,"sl":21430.0,"tp":21490.5,"qty":3,"trade_id":"<strategy>-<entry bar time>","reason":"","strategy":"<script name>","source":"<tradingview|mt5>","time":<bar time ms>}
- event: buy / sell = position opened at price; buy_limit / sell_limit = pending limit order at price; cancel = pending order removed; set_sl / set_tp = stop or target moved (send the new sl or tp); close = position closed at price with reason tp (take profit hit), sl (stop loss hit), time (time stop), signal (strategy-logic exit), eod, daily_limit, breakeven or manual.
- BUY, SELL, CLOSE, TP and SL must stay distinct: entries are event buy / sell; exits are event close with reason tp, sl or signal.
- Always send symbol, price, trade_id (the same id from order to close), strategy and time; entries and limits also send sl, tp and qty. Numbers are plain JSON numbers rounded to the tick, never strings.`;

export const SIGNAL_SPEC = {
  MT5: `${MESSAGE}
- MQL5: input string QuantBotUrl = "http://127.0.0.1:5174/hook/PASTE_KEY" (the trader copies it from QuantBot's Signals page) and input bool SendToQuantBot = true. A function QBSend(event, price, sl, tp, qty, reason) builds the JSON (source "mt5", time = TimeCurrent()*1000) and posts it with WebRequest("POST", QuantBotUrl, "Content-Type: application/json\\r\\n", 3000, data, result, headers); a failed post is printed (with GetLastError) and never stops trading. Tell the trader to add the address's http://127.0.0.1:<port> part under Tools > Options > Expert Advisors > Allow WebRequest for listed URL.
- Call QBSend right after each CTrade action (buy, sell, limit, PositionModify, PositionClose). Detect TP and SL fills in OnTradeTransaction from the closing deal's DEAL_REASON (DEAL_REASON_TP / DEAL_REASON_SL) and send close with reason tp / sl; a strategy-logic PositionClose sends reason signal.
- Also Print one line per event, "SIGNAL|<TYPE>|<symbol>|<time>|<price>|<sl>|<tp>|<ticket>", and draw its own chart arrow (a different arrow and color per type).`,
  Pine: `${MESSAGE}
- Pine: an input "QuantBot strategy name". Build each message with str.format / str.tostring (source "tradingview", symbol syminfo.ticker, tf timeframe.period, time = time) and send it with alert(msg, alert.freq_once_per_bar_close) on confirmed bars, one alert() call per event. The trader makes ONE TradingView alert on the script with "Any alert() function call" and QuantBot's webhook URL (Signals page); the alert's message box stays empty because the script writes it.
- strategy() scripts: strategy.entry ids "BUY" / "SELL"; strategy.exit with comment_profit="TP" and comment_loss="SL"; strategy-logic exits via strategy.close(comment="CLOSE"). Detect TP / SL fills when strategy.closedtrades increases, reading strategy.closedtrades.exit_comment(strategy.closedtrades - 1), and send close with reason tp / sl. Send the alert() messages next to these calls.
- One plotshape() per event type (own shape, color, text and title) so each signal is separable on the chart and in the Data Window.`,
};

export const SIGNAL_RULE = 'Emits distinct BUY, SELL, CLOSE, TP and SL signals (a separate QuantBot webhook message and marker for each)';
