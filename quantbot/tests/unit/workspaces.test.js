import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaces, cleanTitle } from '../../server/workspaces.js';

test('cleanTitle keeps a short name and rejects code or essays', () => {
  assert.equal(cleanTitle('"Gold London Breakout."'), 'Gold London Breakout');
  assert.equal(cleanTitle('Title: NQ opening range bot\nmore text'), 'NQ opening range bot');
  assert.equal(cleanTitle('```pine\nstrategy("x")\n```'), null);
  assert.equal(cleanTitle('x'.repeat(80)), null);
});

test('each chat gets its own folder named after it; scripts land inside, never outside', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  try {
    const ws = createWorkspaces(root);
    const a = ws.create('Gold London Breakout', 's1');
    const b = ws.create('Gold London Breakout', 's2');
    assert.equal(path.basename(a), 'gold-london-breakout');
    assert.equal(path.basename(b), 'gold-london-breakout-2', 'a taken name gets a number');
    assert.ok(fs.existsSync(path.join(a, 'README.md')) && fs.existsSync(path.join(a, 'scripts')));
    const file = ws.saveScript(a, { code: '//@version=5\nstrategy("x")', language: 'Pine' }, 'Gold Breakout v2');
    assert.equal(file, path.join(a, 'scripts', 'gold-breakout-v2.pine'));
    assert.equal(ws.saveScript(path.join(root, '..'), { code: 'x', language: 'MT5' }, 'evil'), null, 'outside the root is refused');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
