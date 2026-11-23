import fs from 'node:fs/promises';
import path from 'node:path';

const KEYS = new Set(['1', '2', '3', '4', 'm', 'ENTER', 'ESC', 'LEFT', 'RIGHT']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// Only answer requests addressed to us by name: blocks DNS-rebinding pages in the
// laptop's browser from reading session data, and cross-site POSTs.
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '192.168.7.1']);
const hostOf = (h) => (h ?? '').replace(/:\d+$/, '').toLowerCase();

export function requestAllowed(req) {
  if (!ALLOWED_HOSTS.has(hostOf(req.headers.host))) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return ALLOWED_HOSTS.has(new URL(origin).hostname); } catch { return false; }
}

async function readBody(req, limit = 4096) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('too large');
  }
  return JSON.parse(body);
}

export function createApp({ getSnapshot, focus, webDir }) {
  const clients = new Set();
  let lastJson = JSON.stringify(getSnapshot());
  const root = path.resolve(webDir);

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`);
  const broadcast = (event, data) => { for (const res of clients) send(res, event, data); };
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': hb\n\n'); }, 15_000);
  heartbeat.unref();

  async function serveFile(res, rel) {
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) return notFound(res);
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    } catch {
      notFound(res);
    }
  }
  const notFound = (res) => { res.writeHead(404); res.end(); };
  const status = (res, code) => { res.writeHead(code); res.end(); };

  async function handler(req, res) {
    if (!requestAllowed(req)) return status(res, 403);
    const url = new URL(req.url, 'http://x');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return notFound(res); }
    try {
      if (req.method === 'GET' && pathname === '/') return await serveFile(res, 'index.html');
      if (req.method === 'GET' && pathname.startsWith('/web/')) return await serveFile(res, pathname.slice(5));
      if (req.method === 'GET' && pathname === '/state') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(lastJson);
      }
      if (req.method === 'GET' && pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return send(res, 'snapshot', lastJson);
      }
      if (req.method === 'POST' && pathname === '/input') {
        let body;
        try { body = await readBody(req); } catch { return status(res, 400); }
        if (!KEYS.has(body?.key)) return status(res, 400);
        broadcast('input', JSON.stringify({ key: body.key }));
        return status(res, 204);
      }
      if (req.method === 'POST' && pathname === '/action/focus') {
        let body;
        try { body = await readBody(req); } catch { return status(res, 400); }
        const s = getSnapshot().sessions.find((x) => x.id === body?.sessionId);
        if (!s) return status(res, 404);
        return status(res, (await focus(s.pid)) ? 204 : 503);
      }
      notFound(res);
    } catch (err) {
      console.error('request failed', req.method, pathname, err);
      if (!res.headersSent) status(res, 500); else res.end();
    }
  }

  const keyOf = ({ now: _now, ...rest }) => JSON.stringify(rest);
  let lastKey = keyOf(getSnapshot());
  // `now` changes every tick; only push when something else changed.
  function broadcastSnapshot(snap) {
    const key = keyOf(snap);
    if (key === lastKey) return;
    lastKey = key;
    lastJson = JSON.stringify(snap);
    broadcast('snapshot', lastJson);
  }

  function close() {
    clearInterval(heartbeat);
    for (const res of clients) res.end();
    clients.clear();
  }

  return { handler, broadcastSnapshot, close };
}
