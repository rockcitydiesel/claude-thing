import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, UsagePoller } from '../server/usage.js';

const SAMPLE = {
  five_hour: { utilization: 23, resets_at: '2026-11-23T23:00:00+00:00' },
  seven_day: { utilization: 14, resets_at: '2026-11-27T05:59:59+00:00' },
  limits: [
    { kind: 'weekly_all', group: 'weekly', percent: 14, resets_at: '2026-11-27T05:59:59+00:00', scope: null },
    { kind: 'weekly_scoped', group: 'weekly', percent: 13, resets_at: '2026-11-27T05:59:59+00:00', scope: { model: { display_name: 'Fable' } } },
  ],
};

test('parseUsage maps session and weekly limits', () => {
  const u = parseUsage(SAMPLE);
  assert.deepEqual(u.session, { pct: 23, resetsAt: Date.parse('2026-11-23T23:00:00+00:00') });
  assert.deepEqual(u.weekly.map((w) => [w.label, w.pct]), [['All models', 14], ['Fable', 13]]);
  assert.equal(u.weekly[0].resetsAt, Date.parse('2026-11-27T05:59:59+00:00'));
});

test('parseUsage: no active 5-hour window gives session null', () => {
  assert.equal(parseUsage({ ...SAMPLE, five_hour: null }).session, null);
});

test('parseUsage falls back to seven_day when limits is missing', () => {
  const u = parseUsage({ five_hour: null, seven_day: { utilization: 40, resets_at: '2026-11-27T05:59:59+00:00' } });
  assert.deepEqual(u.weekly.map((w) => [w.label, w.pct]), [['All models', 40]]);
});

const token = (expiresAt) => async () => ({ accessToken: 'tok', expiresAt });
const okFetch = (calls) => async (url, init) => { calls.push({ url, init }); return { status: 200, json: async () => SAMPLE }; };

test('poller fetches with bearer token and beta header', async () => {
  const calls = [];
  const p = new UsagePoller({ readToken: token(Date.now() + 1e6), fetchImpl: okFetch(calls) });
  await p.poll(1000);
  assert.equal(calls[0].url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  assert.equal(calls[0].init.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(p.current.status, 'ok');
  assert.equal(p.current.session.pct, 23);
  assert.equal(p.current.fetchedAt, 1000);
});

test('poller skips the call when the token has expired', async () => {
  const calls = [];
  const p = new UsagePoller({ readToken: token(Date.now() - 1), fetchImpl: okFetch(calls) });
  await p.poll(1000);
  assert.equal(calls.length, 0);
  assert.equal(p.current.status, 'expired');
});

test('poller keeps last good numbers on failure and marks them stale', async () => {
  let fail = false;
  const p = new UsagePoller({ readToken: token(Date.now() + 1e6),
    fetchImpl: async () => (fail ? { status: 500, json: async () => ({}) } : { status: 200, json: async () => SAMPLE }) });
  await p.poll(1000);
  fail = true;
  await p.poll(2000);
  assert.equal(p.current.status, 'error');
  assert.equal(p.current.session.pct, 23);
  assert.equal(p.current.fetchedAt, 1000);
});

test('poller reports missing credentials and network errors', async () => {
  const p = new UsagePoller({ readToken: async () => null, fetchImpl: async () => { throw new Error('x'); } });
  await p.poll(1);
  assert.equal(p.current.status, 'no-login');
  const p2 = new UsagePoller({ readToken: token(Date.now() + 1e6), fetchImpl: async () => { throw new Error('offline'); } });
  await p2.poll(1);
  assert.equal(p2.current.status, 'error');
});

test('poller never exposes the token in its state', async () => {
  const p = new UsagePoller({ readToken: token(Date.now() + 1e6), fetchImpl: okFetch([]) });
  await p.poll(1);
  assert.equal(JSON.stringify(p.current).includes('tok'), false);
});

const res429 = (retryAfter) => ({ status: 429, headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? retryAfter : null) }, json: async () => ({}) });

test('429 backs off: no further calls until the wait has passed', async () => {
  let calls = 0;
  let limited = true;
  const p = new UsagePoller({ readToken: token(Date.now() + 1e9),
    fetchImpl: async () => { calls++; return limited ? res429(null) : { status: 200, json: async () => SAMPLE }; } });
  await p.poll(0);
  assert.equal(p.current.status, 'rate-limited');
  await p.poll(60_000);
  assert.equal(calls, 1);           // still inside the 2-minute backoff
  limited = false;
  await p.poll(120_001);
  assert.equal(calls, 2);
  assert.equal(p.current.status, 'ok');
});

test('429 honours Retry-After and doubles the backoff up to 15 minutes', async () => {
  let calls = 0;
  const p = new UsagePoller({ readToken: token(Date.now() + 1e9), fetchImpl: async () => { calls++; return res429('600'); } });
  await p.poll(0);
  await p.poll(599_000);
  assert.equal(calls, 1);
  await p.poll(600_001);
  assert.equal(calls, 2);
  const p2 = new UsagePoller({ readToken: token(Date.now() + 1e9), fetchImpl: async () => { calls++; return res429(null); } });
  let t = 0;
  for (let i = 0; i < 6; i++) { await p2.poll(t); t = p2.nextAllowedAt; }
  assert.equal(p2.backoffMs, 15 * 60_000); // 2 → 4 → 8 → 15 (capped)
});
