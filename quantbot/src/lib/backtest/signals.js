const EXIT = { tp: 'TP', sl: 'SL' };

// Each simulated trade as its distinct entry and exit signals
export function tradeSignals(trades) {
  return trades.flatMap((t) => [
    { type: t.side === 'long' ? 'BUY' : 'SELL', t: t.entryTime, price: t.entry },
    { type: EXIT[t.reason] || 'CLOSE', t: t.exitTime, price: t.exit, reason: t.reason },
  ]);
}

const row = (type, status, detail) => ({ rule: `Signal test: ${type}`, status, detail });

// Checks that BUY, SELL, CLOSE, TP and SL each fired and behaved correctly in the simulation
export function testSignals(trades) {
  const sig = tradeSignals(trades).filter((s) => s.reason !== 'end');
  const n = (type) => sig.filter((s) => s.type === type).length;
  const entries = n('BUY') + n('SELL');
  const results = ['BUY', 'SELL'].map((type) => {
    const side = type === 'BUY' ? 'long' : 'short';
    const mine = trades.filter((t) => t.side === side);
    const noStops = mine.filter((t) => t.sl0 == null || t.tp0 == null).length;
    if (!entries) return row(type, 'fail', 'No entry signals fired, so no signal could be tested.');
    if (!mine.length) return row(type, 'warn', `No ${type} signal fired in this window (fine only if the strategy is ${type === 'BUY' ? 'short' : 'long'}-only).`);
    if (noStops) return row(type, 'fail', `${mine.length} fired, but ${noStops} opened without both SL and TP.`);
    return row(type, 'pass', `${mine.length} fired, each with SL and TP set.`);
  });
  const close = n('CLOSE');
  results.push(close
    ? row('CLOSE', 'pass', `${close} strategy-logic exits fired.`)
    : row('CLOSE', 'warn', 'No strategy-logic exit fired: every trade ended at TP, SL or the end of the test.'));
  const tps = trades.filter((t) => t.reason === 'tp');
  const lossTp = tps.filter((t) => t.pnl < 0).length;
  results.push(!tps.length ? row('TP', 'warn', 'Take profit was never hit in this window.')
    : lossTp ? row('TP', 'warn', `${tps.length} hit, but ${lossTp} closed at a loss.`)
      : row('TP', 'pass', `${tps.length} take profits hit.`));
  const sls = n('SL');
  results.push(sls ? row('SL', 'pass', `${sls} stop losses hit.`) : row('SL', 'warn', 'Stop loss was never hit in this window.'));
  return { results, counts: { BUY: n('BUY'), SELL: n('SELL'), CLOSE: close, TP: tps.length, SL: sls } };
}