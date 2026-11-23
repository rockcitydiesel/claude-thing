import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { terminalPidFor, findHyprSignature } from '../server/focus.js';
import { tmpDir } from './helpers.js';

test('terminalPidFor walks parents to a window pid', () => {
  const ppid = { 100: 90, 90: 80, 80: 1 };
  assert.equal(terminalPidFor(100, (p) => ppid[p] ?? null, new Set([80])), 80);
  assert.equal(terminalPidFor(100, (p) => ppid[p] ?? null, new Set([7])), null);
});

test('terminalPidFor stops on cycles and depth', () => {
  assert.equal(terminalPidFor(5, () => 5, new Set([9])), null);
});

test('findHyprSignature picks newest dir with a socket', async () => {
  const run = await tmpDir();
  await fs.mkdir(`${run}/hypr/old`, { recursive: true });
  await fs.writeFile(`${run}/hypr/old/.socket.sock`, '');
  await fs.mkdir(`${run}/hypr/new`, { recursive: true });
  await fs.writeFile(`${run}/hypr/new/.socket.sock`, '');
  const past = new Date(Date.now() - 60_000);
  await fs.utimes(`${run}/hypr/old`, past, past);
  await fs.mkdir(`${run}/hypr/nosock`, { recursive: true });
  assert.equal(await findHyprSignature(run), 'new');
});

test('findHyprSignature without hypr dir is null', async () => {
  assert.equal(await findHyprSignature(await tmpDir()), null);
});
