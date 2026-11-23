import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICES, estimateCostUsd, priceFor } from '../server/prices.js';

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };

test('opus 5.5 input priced per MTok', () => {
  assert.equal(estimateCostUsd({ 'claude-opus-5-5': { ...zero, input: 1e6 } }), PRICES['claude-opus-5-5'].input);
});

test('all token kinds summed', () => {
  const c = estimateCostUsd({ 'claude-opus-5-5': { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6, cacheWrite1h: 1e6 } });
  assert.equal(c, 4 + 20 + 0.2 + 5 + 8);
});

test('longest prefix wins (opus-5-5 not opus-5)', () => {
  assert.equal(priceFor('claude-opus-5-5').input, 4);
  assert.equal(priceFor('claude-opus-5').input, 5);
  assert.equal(priceFor('claude-opus-5-5[1m]').input, 4);
});

test('unknown model is priced, never zero', () => {
  assert.ok(estimateCostUsd({ 'claude-mystery-9': { ...zero, input: 1e6 } }) > 0);
});
