import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyStatus, SnapshotBuilder } from '../server/snapshot.js';
import { tmpDir, assistantLine, usage } from './helpers.js';

const NOW = 1_800_000_000_000;

test('classifyStatus', () => {
  assert.equal(classifyStatus('busy', 0, NOW), 'working');
  assert.equal(classifyStatus('shell', NOW - 599_999, NOW), 'your_turn');
  assert.equal(classifyStatus('shell', NOW - 600_000, NOW), 'idle');
  assert.equal(classifyStatus('whatever', NOW - 10, NOW), 'your_turn');
});

async function makeSession(dir, { pid, sessionId, cwd, startedAt = NOW - 1000, status = 'busy' }) {
  await fs.mkdir(`${dir}/sessions`, { recursive: true });
  await fs.writeFile(`${dir}/sessions/${pid}.json`, JSON.stringify({
    pid, sessionId, cwd, name: 'name-' + sessionId, status, statusUpdatedAt: NOW - 5000,
    startedAt, kind: 'interactive', procStart: '1',
  }));
  const proj = `${dir}/projects/${cwd.replaceAll('/', '-')}`;
  await fs.mkdir(proj, { recursive: true });
  return proj;
}

test('snapshot sums subagent cost and lists only running agents', async () => {
  const dir = await tmpDir();
  const proj = await makeSession(dir, { pid: 10, sessionId: 's1', cwd: '/home/v/alpha' });
  await fs.writeFile(`${proj}/s1.jsonl`, assistantLine({ id: 'm', usage: usage(1_000_000, 0, 0, 0) }));
  const sub = `${proj}/s1/subagents`;
  await fs.mkdir(sub, { recursive: true });
  await fs.writeFile(`${sub}/agent-done.meta.json`, JSON.stringify({ agentType: 'Explore', description: 'old', finished: true }));
  await fs.writeFile(`${sub}/agent-done.jsonl`, assistantLine({ id: 'sm', usage: usage(1_000_000, 0, 0, 0), sidechain: true }));
  await fs.writeFile(`${sub}/agent-run.meta.json`, JSON.stringify({ agentType: 'general-purpose', description: 'live', finished: false }));
  await fs.writeFile(`${sub}/agent-run.jsonl`, assistantLine({ id: 'sr', usage: usage(10, 5000, 0, 1), sidechain: true }));

  const now = Date.now(); // agent liveness compares against real file mtimes
  const snap = await new SnapshotBuilder(dir, { isAlive: () => true }).build(now);
  assert.equal(snap.now, now);
  const s = snap.sessions[0];
  assert.equal(s.cost.tokens.input, 2_000_010);
  assert.ok(s.cost.usd > 7.9);
  assert.equal(s.folder, 'alpha');
  assert.equal(s.status, 'working');
  assert.equal(s.model, 'claude-opus-5-5');
  assert.deepEqual(s.context, { used: 1_000_000, window: 1_000_000, pct: 100 });
  assert.deepEqual(s.agents.map((a) => a.description), ['live']);
  assert.equal(s.agentCount, 1);
  assert.equal(s.agents[0].context.used, 5010);
});

test('snapshot orders by folder then startedAt', async () => {
  const dir = await tmpDir();
  await makeSession(dir, { pid: 1, sessionId: 'z', cwd: '/w/zeta' });
  await makeSession(dir, { pid: 2, sessionId: 'a2', cwd: '/w/alpha', startedAt: NOW - 10 });
  await makeSession(dir, { pid: 3, sessionId: 'a1', cwd: '/w/alpha', startedAt: NOW - 20 });
  const snap = await new SnapshotBuilder(dir, { isAlive: () => true }).build(NOW);
  assert.deepEqual(snap.sessions.map((s) => s.id), ['a1', 'a2', 'z']);
});

test('snapshot drops sessions that disappear', async () => {
  const dir = await tmpDir();
  await makeSession(dir, { pid: 1, sessionId: 'gone', cwd: '/w/g' });
  const b = new SnapshotBuilder(dir, { isAlive: () => true });
  assert.equal((await b.build(NOW)).sessions.length, 1);
  await fs.rm(`${dir}/sessions/1.json`);
  assert.equal((await b.build(NOW)).sessions.length, 0);
  assert.equal(b.tails.size, 0);
});

test('unfinished agents with stale transcripts are not running', async () => {
  const dir = await tmpDir();
  const proj = await makeSession(dir, { pid: 10, sessionId: 's1', cwd: '/home/v/alpha' });
  const sub = `${proj}/s1/subagents`;
  await fs.mkdir(sub, { recursive: true });
  const now = Date.now();
  await fs.writeFile(`${sub}/agent-old.meta.json`, JSON.stringify({ agentType: 'general-purpose', description: 'killed days ago' }));
  await fs.writeFile(`${sub}/agent-old.jsonl`, '');
  const old = new Date(now - 11 * 60_000);
  await fs.utimes(`${sub}/agent-old.jsonl`, old, old);
  await fs.writeFile(`${sub}/agent-new.meta.json`, JSON.stringify({ agentType: 'general-purpose', parentAgentId: 'x' }));
  await fs.writeFile(`${sub}/agent-new.jsonl`, '');
  const snap = await new SnapshotBuilder(dir, { isAlive: () => true }).build(now);
  assert.deepEqual(snap.sessions[0].agents.map((a) => a.id), ['agent-new']);
  assert.equal(snap.sessions[0].agents[0].description, 'nested agent');
});
