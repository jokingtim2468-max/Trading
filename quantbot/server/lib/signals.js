// Signal standard for every generated strategy, so BUY / SELL / CLOSE / TP / SL can be tested, not just seen on a chart
export const SIGNAL_SPEC = {
  MT5: `DISTINCT SIGNALS (mandatory): the EA must emit five separate, machine-readable events: BUY (long entry), SELL (short entry), CLOSE (exit by strategy logic), TP (take profit hit), SL (stop loss hit).
- On every event Print exactly one line "SIGNAL|<TYPE>|<symbol>|<time>|<price>|<sl>|<tp>|<ticket>" and draw its own chart arrow object (a different arrow code and color per type).
- Detect TP and SL fills in OnTradeTransaction from the closing deal's DEAL_REASON (DEAL_REASON_TP / DEAL_REASON_SL). CLOSE is only a strategy-logic exit via CTrade.PositionClose, never a stop hit.
- Inputs (default true) to also send the same line via Alert() and SendNotification().`,
  Pine: `DISTINCT SIGNALS (mandatory): the script must emit five separate, testable events: BUY (long entry), SELL (short entry), CLOSE (exit by strategy logic), TP (take profit hit), SL (stop loss hit).
- strategy.entry ids "BUY" / "SELL" with alert_message; strategy.exit with comment_profit="TP", comment_loss="SL", alert_profit and alert_loss; strategy-logic exits via strategy.close(comment="CLOSE", alert_message).
- Every alert message is JSON: {"signal":"<TYPE>","symbol":"{{ticker}}","price":"{{close}}","sl":<sl>,"tp":<tp>,"time":"{{timenow}}"}.
- Detect TP / SL fills when strategy.closedtrades increases, reading strategy.closedtrades.exit_comment(strategy.closedtrades - 1).
- One plotshape() per event type (own shape, color, text and title) so each signal is separable on the chart and in the Data Window.`,
};

export const SIGNAL_RULE = 'Emits distinct BUY, SELL, CLOSE, TP and SL signals (a separate alert / log line and marker for each)';