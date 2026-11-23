import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readLiveSessions, pidMatches, transcriptPath } from '../server/sessions.js';
import { readAgents } from '../server/agents.js';
import { tmpDir } from './helpers.js';

async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj));
}

test('skips dead and non-interactive sessions', async () => {
  const dir = await tmpDir();
  const base = { cwd: '/x', name: 'n', status: 'busy', procStart: '1' };
  await writeJson(`${dir}/sessions/1.json`, { ...base, pid: 1, sessionId: 'alive', kind: 'interactive' });
  await writeJson(`${dir}/sessions/2.json`, { ...base, pid: 2, sessionId: 'dead', kind: 'interactive' });
  await writeJson(`${dir}/sessions/3.json`, { ...base, pid: 3, sessionId: 'sdk', kind: 'sdk' });
  await fs.writeFile(`${dir}/sessions/4.json`, '{broken');
  const got = await readLiveSessions(dir, (pid) => pid !== 2);
  assert.deepEqual(got.map((s) => s.sessionId), ['alive']);
});

test('missing sessions dir yields []', async () => {
  assert.deepEqual(await readLiveSessions('/nonexistent-claude-dir'), []);
});

test('pidMatches compares /proc start time', async () => {
  const stat = await fs.readFile('/proc/self/stat', 'utf8');
  const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  assert.equal(pidMatches(process.pid, start), true);
  assert.equal(pidMatches(process.pid, '1'), false);
  assert.equal(pidMatches(999_999_999, start), false);
});

test('transcriptPath maps cwd to project dir', () => {
  assert.equal(transcriptPath('/c', '/home/you/code', 'abc'), '/c/projects/-home-you-code/abc.jsonl');
});

test('readAgents reads meta files with finished flags', async () => {
  const dir = await tmpDir();
  await writeJson(`${dir}/subagents/agent-a1.meta.json`, { agentType: 'Explore', description: 'find x', finished: true });
  await writeJson(`${dir}/subagents/agent-a2.meta.json`, { agentType: 'general-purpose', description: 'build y', finished: false });
  await fs.writeFile(`${dir}/subagents/agent-a2.jsonl`, '');
  const agents = (await readAgents(dir)).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(agents.length, 2);
  assert.deepEqual(agents.map((a) => [a.id, a.type, a.description, a.finished]),
    [['agent-a1', 'Explore', 'find x', true], ['agent-a2', 'general-purpose', 'build y', false]]);
  assert.equal(agents[1].transcript, `${dir}/subagents/agent-a2.jsonl`);
  assert.equal(typeof agents[1].startedAt, 'number');
});

test('readAgents without subagents dir yields []', async () => {
  assert.deepEqual(await readAgents('/nonexistent-session-dir'), []);
});

test('transcriptPath replaces every non-alphanumeric character like Claude Code', () => {
  assert.equal(transcriptPath('/c', '/home/u/code/app/.claude/worktrees/agent-a1', 's'),
    '/c/projects/-home-u-code-app--claude-worktrees-agent-a1/s.jsonl');
  assert.equal(transcriptPath('/c', '/home/u/my_app.v2', 's'), '/c/projects/-home-u-my-app-v2/s.jsonl');
});
