import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TranscriptTail, contextWindow } from '../server/transcript.js';
import { tmpDir, assistantLine, usage } from './helpers.js';

async function setup(content) {
  const dir = await tmpDir();
  const file = path.join(dir, 't.jsonl');
  await fs.writeFile(file, content);
  return file;
}

test('dedupes usage by message.id', async () => {
  const u = usage(10, 100, 5, 7);
  const file = await setup(assistantLine({ id: 'm1', usage: u }) + assistantLine({ id: 'm1', usage: u }));
  const t = new TranscriptTail(file);
  await t.poll();
  assert.deepEqual(t.summary().tokensByModel['claude-opus-5-5'],
    { input: 10, output: 7, cacheRead: 100, cacheWrite: 5, cacheWrite1h: 0 });
});

test('splits 1h cache writes from 5m cache writes', async () => {
  const file = await setup(assistantLine({ id: 'm1', usage: usage(1, 0, 50, 1, 30) }));
  const t = new TranscriptTail(file);
  await t.poll();
  const tok = t.summary().tokensByModel['claude-opus-5-5'];
  assert.equal(tok.cacheWrite, 20);
  assert.equal(tok.cacheWrite1h, 30);
});

test('context comes from latest main-chain assistant', async () => {
  const file = await setup(
    assistantLine({ id: 'a', usage: usage(100, 800, 100, 1) }) +
    assistantLine({ id: 'b', usage: usage(1000, 1500, 500, 1) }) +
    assistantLine({ id: 'c', usage: usage(9999, 0, 0, 1), sidechain: true }));
  const t = new TranscriptTail(file);
  await t.poll();
  assert.equal(t.summary().contextUsed, 3000);
  assert.equal(t.summary().model, 'claude-opus-5-5');
});

test('buffers partial trailing line', async () => {
  const line = assistantLine({ id: 'p', usage: usage(10, 0, 0, 1) });
  const file = await setup(line.slice(0, 40));
  const t = new TranscriptTail(file);
  await t.poll();
  assert.equal(t.summary().tokensByModel['claude-opus-5-5'], undefined);
  await fs.appendFile(file, line.slice(40));
  await t.poll();
  assert.equal(t.summary().tokensByModel['claude-opus-5-5'].input, 10);
  await t.poll();
  assert.equal(t.summary().tokensByModel['claude-opus-5-5'].input, 10);
});

test('incremental: only new lines are counted', async () => {
  const file = await setup(assistantLine({ id: 'x', usage: usage(10, 0, 0, 1) }));
  const t = new TranscriptTail(file);
  await t.poll();
  await t.poll();
  assert.equal(t.summary().tokensByModel['claude-opus-5-5'].input, 10);
  await fs.appendFile(file, assistantLine({ id: 'y', usage: usage(5, 0, 0, 1) }));
  await t.poll();
  assert.equal(t.summary().tokensByModel['claude-opus-5-5'].input, 15);
});

test('recentTools keeps the last 5 with summaries', async () => {
  let s = '';
  for (let i = 0; i < 7; i++) {
    s += assistantLine({ id: 't' + i, usage: usage(1, 0, 0, 1), ts: `2026-11-23T20:00:0${i}.000Z`,
      content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo ' + i + ' '.repeat(80) + 'tail' } }] });
  }
  const file = await setup(s);
  const t = new TranscriptTail(file);
  await t.poll();
  const tools = t.summary().recentTools;
  assert.equal(tools.length, 5);
  assert.equal(tools[4].summary.startsWith('echo 6'), true);
  assert.equal(tools[0].summary.startsWith('echo 2'), true);
  assert.ok(tools[4].summary.length <= 60);
  assert.equal(tools[4].name, 'Bash');
});

test('ignores malformed lines', async () => {
  const file = await setup('not json\n' + assistantLine({ id: 'ok', usage: usage(3, 0, 0, 1) }));
  const t = new TranscriptTail(file);
  await t.poll();
  assert.equal(t.summary().tokensByModel['claude-opus-5-5'].input, 3);
});

test('lastActivity is newest timestamp', async () => {
  const file = await setup(assistantLine({ id: 'a', usage: usage(1, 0, 0, 1), ts: '2026-11-23T20:00:05.000Z' }));
  const t = new TranscriptTail(file);
  await t.poll();
  assert.equal(t.summary().lastActivity, Date.parse('2026-11-23T20:00:05.000Z'));
});

test('missing file yields empty summary', async () => {
  const t = new TranscriptTail('/nonexistent/x.jsonl');
  await t.poll();
  assert.equal(t.summary().contextUsed, 0);
  assert.equal(t.summary().model, null);
});

test('contextWindow picks 200k or 1M', () => {
  assert.equal(contextWindow(150_000), 200_000);
  assert.equal(contextWindow(250_000), 1_000_000);
});

test('contextWindow uses the model window when known', () => {
  assert.equal(contextWindow(192_000, 'claude-opus-5-5'), 1_000_000);
  assert.equal(contextWindow(50_000, 'claude-haiku-4-5'), 200_000);
  assert.equal(contextWindow(250_000, 'claude-haiku-4-5'), 1_000_000);
});
