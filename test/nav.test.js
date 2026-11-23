import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialNav, onKey, onSnapshot } from '../web/nav.js';

const NOW = 1_000_000;
const sess = (id, o = {}) => ({ id, status: 'working', agentCount: 0, lastActivity: 0, ...o });
const SNAP = { now: NOW, sessions: [sess('A'), sess('B', { status: 'idle' }), sess('C', { status: 'your_turn' })] };
const at = (sessionId, view = 'session') => ({ ...initialNav(), view, sessionId });
const key = (nav, k, snap = SNAP) => onKey(nav, k, snap, NOW);

test('knob moves through home and sessions, wrapping', () => {
  assert.equal(key(initialNav(), 'RIGHT').nav.sessionId, 'A');
  assert.equal(key(initialNav(), 'RIGHT').nav.view, 'session');
  assert.equal(key(at('C'), 'RIGHT').nav.view, 'home');
  assert.equal(key(at('C'), 'RIGHT').nav.sessionId, null);
  assert.equal(key(initialNav(), 'LEFT').nav.sessionId, 'C');
  assert.equal(key(at('A'), 'LEFT').nav.view, 'home');
});

test('knob from detail moves to neighbouring session view', () => {
  const n = key(at('A', 'detail'), 'RIGHT').nav;
  assert.deepEqual([n.view, n.sessionId], ['session', 'B']);
});

test('ENTER and ESC', () => {
  assert.equal(key(at('B'), 'ENTER').nav.view, 'detail');
  const fromHome = key(initialNav(), 'ENTER').nav;
  assert.deepEqual([fromHome.view, fromHome.sessionId], ['session', 'A']);
  assert.equal(key(at('B', 'detail'), 'ESC').nav.view, 'session');
  assert.equal(key(at('B'), 'ESC').nav.view, 'home');
  assert.equal(key(initialNav(), 'ESC').nav.view, 'home');
});

test('1 jumps to next your_turn session, cycling', () => {
  assert.equal(key(at('A'), '1').nav.sessionId, 'C');
  const two = { now: NOW, sessions: [sess('A', { status: 'your_turn' }), sess('B'), sess('C', { status: 'your_turn' })] };
  assert.equal(key(at('C'), '1', two).nav.sessionId, 'A');
  const none = { now: NOW, sessions: [sess('A'), sess('B')] };
  assert.deepEqual(key(at('B'), '1', none).nav.sessionId, 'B');
});

test('2 busiest, 3 most recent', () => {
  const s = { now: NOW, sessions: [
    sess('A', { agentCount: 2, lastActivity: 5 }), sess('B', { agentCount: 2, lastActivity: 9 }), sess('C', { lastActivity: 50 })] };
  assert.equal(key(initialNav(), '2', s).nav.sessionId, 'B');
  assert.equal(key(initialNav(), '3', s).nav.sessionId, 'C');
  assert.equal(key(initialNav(), '2', { now: NOW, sessions: [] }).nav.view, 'home');
});

test('4 focuses current session', () => {
  assert.deepEqual(key(at('B'), '4').effects, [{ type: 'focus', sessionId: 'B' }]);
  assert.deepEqual(key(initialNav(), '4').effects, []);
});

test('m toggles dim; every key records input time', () => {
  const n = key(initialNav(), 'm').nav;
  assert.equal(n.dim, true);
  assert.equal(key(n, 'm').nav.dim, false);
  assert.equal(n.lastInputAt, NOW);
});

test('selected session disappearing returns home', () => {
  const n = onSnapshot(at('B'), SNAP, { now: NOW, sessions: [sess('A')] }, NOW);
  assert.deepEqual([n.view, n.sessionId], ['home', null]);
});

test('entering your_turn alerts, and auto-jumps after 30s idle', () => {
  const prev = { now: NOW, sessions: [sess('A'), sess('B')] };
  const next = { now: NOW, sessions: [sess('A'), sess('B', { status: 'your_turn' })] };
  const idle = { ...at('A'), lastInputAt: NOW - 30_001 };
  const jumped = onSnapshot(idle, prev, next, NOW);
  assert.deepEqual([jumped.view, jumped.sessionId], ['session', 'B']);
  assert.equal(jumped.alerts.B, NOW + 3000);
  const busy = { ...at('A'), lastInputAt: NOW - 29_999 };
  const stayed = onSnapshot(busy, prev, next, NOW);
  assert.equal(stayed.sessionId, 'A');
  assert.equal(stayed.alerts.B, NOW + 3000);
});

test('no alert on first snapshot or for sessions already your_turn', () => {
  const s = { now: NOW, sessions: [sess('A', { status: 'your_turn' })] };
  assert.deepEqual(onSnapshot(initialNav(), null, s, NOW).alerts, {});
  assert.deepEqual(onSnapshot(initialNav(), s, s, NOW).alerts, {});
});

test('onKey does not mutate input nav', () => {
  const n = initialNav();
  key(n, 'RIGHT');
  assert.equal(n.view, 'home');
});
