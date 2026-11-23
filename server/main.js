import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_DIR, PORT, USB_ADDR, POLL_MS } from './config.js';
import { SnapshotBuilder } from './snapshot.js';
import { createApp } from './http.js';
import { focusSession } from './focus.js';
import { UsagePoller, USAGE_POLL_MS } from './usage.js';

export function hasAddress(ifaces, addr) {
  return Object.values(ifaces).some((list) => list?.some((i) => i.address === addr));
}

function listen(handler, host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(PORT, host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

async function main() {
  const builder = new SnapshotBuilder(CLAUDE_DIR);
  const usage = new UsagePoller();
  await usage.poll();
  setInterval(() => usage.poll(), USAGE_POLL_MS);
  const withPlan = (snap) => ({ ...snap, plan: usage.current });
  let snapshot = withPlan(await builder.build(Date.now()));
  const app = createApp({
    getSnapshot: () => snapshot,
    focus: focusSession,
    webDir: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web'),
  });

  await listen(app.handler, '127.0.0.1');
  console.log(`claude-thing on http://127.0.0.1:${PORT}`);

  // The USB link (and its address) comes and goes with the cable; attach whenever it's present.
  let usb = null;
  const attachUsb = async () => {
    if (usb || !hasAddress(os.networkInterfaces(), USB_ADDR)) return;
    try {
      usb = await listen(app.handler, USB_ADDR);
      console.log(`claude-thing on http://${USB_ADDR}:${PORT}`);
      usb.on('close', () => { usb = null; });
      usb.on('error', (err) => { console.error('usb listener error', err.message); usb?.close(); usb = null; });
    } catch (err) {
      console.error('usb listen failed', err.message);
    }
  };
  await attachUsb();
  setInterval(attachUsb, 5000);

  let building = false;
  setInterval(async () => {
    if (building) return;
    building = true;
    try {
      snapshot = withPlan(await builder.build(Date.now()));
      app.broadcastSnapshot(snapshot);
    } catch (err) {
      console.error('snapshot failed', err);
    } finally {
      building = false;
    }
  }, POLL_MS);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
