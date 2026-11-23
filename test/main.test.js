import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasAddress } from '../server/main.js';

test('hasAddress finds the USB address among interfaces', () => {
  const ifaces = { lo: [{ address: '127.0.0.1', family: 'IPv4' }], enp9u1: [{ address: '192.168.7.1', family: 'IPv4' }] };
  assert.equal(hasAddress(ifaces, '192.168.7.1'), true);
  assert.equal(hasAddress({ lo: ifaces.lo }, '192.168.7.1'), false);
  assert.equal(hasAddress({}, '192.168.7.1'), false);
});
