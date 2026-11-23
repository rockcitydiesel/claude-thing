import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/http.js';
import { tmpDir } from './helpers.js';

async function start(overrides = {}) {
  const webDir = await tmpDir();
  await fs.writeFile(path.join(webDir, 'index.html'), '<h1>hi</h1>');
  await fs.writeFile(path.join(webDir, 'app.js'), 'x=1');
  const snap = { now: 1, sessions: [{ id: 's1', pid: 42 }] };
  const focused = [];
  const app = createApp({
    getSnapshot: () => snap,
    focus: async (pid) => { focused.push(pid); return overrides.focusResult ?? true; },
    webDir,
  });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, server, base, focused, close: () => { app.close(); server.close(); } };
}

function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function readEvents(base, n) {
  const res = await fetch(base + '/events');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events = [];
  const next = async (want = n) => {
    while (events.length < want) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(chunk)?.[1];
        const data = /^data: (.*)$/m.exec(chunk)?.[1];
        if (ev) events.push({ ev, data: JSON.parse(data) });
      }
    }
    return events;
  };
  return { next, cancel: () => reader.cancel() };
}

test('GET /state returns snapshot', async () => {
  const t = await start();
  const body = await (await fetch(t.base + '/state')).json();
  assert.equal(body.sessions[0].id, 's1');
  t.close();
});

test('GET / serves index.html and /web/* static files', async () => {
  const t = await start();
  assert.equal(await (await fetch(t.base + '/')).text(), '<h1>hi</h1>');
  const js = await fetch(t.base + '/web/app.js');
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  t.close();
});

test('path traversal is rejected', async () => {
  const t = await start();
  const res = await new Promise((resolve) => http.get(t.base + '/web/../package.json', resolve));
  assert.equal(res.statusCode, 404);
  const res2 = await new Promise((resolve) => http.get(t.base + '/web/%2e%2e/%2e%2e/etc/passwd', resolve));
  assert.equal(res2.statusCode, 404);
  t.close();
});

test('SSE: snapshot on connect, input broadcast, 400 on bad key', async () => {
  const t = await start();
  const r = await readEvents(t.base, 1);
  let ev = await r.next();
  assert.equal(ev[0].ev, 'snapshot');
  assert.equal(ev[0].data.sessions[0].id, 's1');
  const r2 = await readEvents(t.base, 2);
  await r2.next(1); // wait for initial snapshot
  const ok = await post(t.base + '/input', { key: 'RIGHT' });
  assert.equal(ok.status, 204);
  ev = await r2.next();
  assert.deepEqual(ev[1], { ev: 'input', data: { key: 'RIGHT' } });
  assert.equal((await post(t.base + '/input', { key: 'X' })).status, 400);
  assert.equal((await fetch(t.base + '/input', { method: 'POST', body: 'nope' })).status, 400);
  r.cancel(); r2.cancel(); t.close();
});

test('broadcastSnapshot only sends when JSON changes', async () => {
  const t = await start();
  const r = await readEvents(t.base, 2);
  await new Promise((res) => setTimeout(res, 30));
  t.app.broadcastSnapshot({ now: 1, sessions: [{ id: 's1', pid: 42 }] });
  t.app.broadcastSnapshot({ now: 2, sessions: [] });
  const ev = await r.next();
  assert.equal(ev[1].ev, 'snapshot');
  assert.deepEqual(ev[1].data.sessions, []);
  r.cancel(); t.close();
});

test('POST /action/focus', async () => {
  const t = await start();
  assert.equal((await post(t.base + '/action/focus', { sessionId: 's1' })).status, 204);
  assert.deepEqual(t.focused, [42]);
  assert.equal((await post(t.base + '/action/focus', { sessionId: 'nope' })).status, 404);
  t.close();
  const t2 = await start({ focusResult: false });
  assert.equal((await post(t2.base + '/action/focus', { sessionId: 's1' })).status, 503);
  t2.close();
});
