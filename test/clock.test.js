import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../web/clock.js';

test('clock follows the server time, not the local clock', () => {
  const c = createClock();
  const localNow = Date.parse('2024-05-27T13:00:00Z');   // Car Thing has no NTP
  const serverNow = Date.parse('2026-11-23T23:30:00Z');
  c.sync(serverNow, localNow);
  assert.equal(c.now(localNow + 5000), serverNow + 5000);
});

test('unsynced clock falls back to local time', () => {
  assert.equal(createClock().now(1234), 1234);
});
