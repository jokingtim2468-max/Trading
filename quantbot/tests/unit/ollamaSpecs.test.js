import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickModel, detectSpecs } from '../../server/lib/ollamaSpecs.js';

test('model recommendation by VRAM', () => {
  assert.equal(pickModel({ vram_gb: 16 }).model, 'qwen2.5-coder:14b');
  assert.equal(pickModel({ vram_gb: 8 }).model, 'qwen2.5-coder:7b');   // the user's case
  assert.equal(pickModel({ vram_gb: 6 }).model, 'qwen2.5-coder:7b');
  assert.equal(pickModel({ vram_gb: 4 }).model, 'qwen2.5-coder:3b');
  assert.equal(pickModel({ vram_gb: 2 }).model, 'qwen2.5-coder:1.5b');
});

test('falls back to system RAM with no GPU', () => {
  assert.equal(pickModel({ vram_gb: null, ram_gb: 32 }).model, 'qwen2.5-coder:7b');
  assert.equal(pickModel({ vram_gb: null, ram_gb: 12 }).model, 'qwen2.5-coder:3b');
  assert.equal(pickModel({ vram_gb: null, ram_gb: 4 }).model, 'qwen2.5-coder:1.5b');
});

test('detectSpecs returns a usable recommendation on any machine', async () => {
  const s = await detectSpecs();
  assert.ok(typeof s.cpu === 'string' && s.ram_gb > 0);
  assert.ok(s.pick && /^qwen2\.5-coder:/.test(s.pick.model));
});
