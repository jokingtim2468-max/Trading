import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOf } from '../../src/lib/agents/loopfixScore.js';

const mk = (pf, ddPct, net, trades) => ({ metrics: { profitFactor: pf, maxDDPct: ddPct, net, trades } });

test('a better script scores higher', () => {
  const weak = scoreOf([mk(0.9, 20, -500, 120)]);
  const strong = scoreOf([mk(1.6, 8, 3000, 120)]);
  assert.ok(strong.score > weak.score, `${strong.score} should beat ${weak.score}`);
});

test('too few trades is punished', () => {
  const few = scoreOf([mk(2.0, 5, 1000, 10)]);
  const enough = scoreOf([mk(1.3, 5, 1000, 80)]);
  assert.ok(enough.score > few.score);
});

test('no valid results scores far below any real run', () => {
  assert.ok(scoreOf([]).score < scoreOf([mk(0.5, 50, -2000, 100)]).score);
});

test('aggregates across markets and rounds the readout', () => {
  const s = scoreOf([mk(1.2, 10, 500, 60), mk(1.4, 6, 700, 60)]);
  assert.equal(s.trades, 120);
  assert.equal(s.net, 1200);
  assert.ok(s.pf > 1.2 && s.pf < 1.4);
});
