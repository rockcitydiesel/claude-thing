// Renders the dashboard at the Car Thing's 800x480 with headless Chromium.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:7777/';
const out = path.resolve('shots');
fs.mkdirSync(out, { recursive: true });

const shots = {
  'home': '?fixture=demo',
  'home-high-usage': '?fixture=demo-high',
  'home-no-session-window': '?fixture=demo-nosession',
  'session-working': '?fixture=demo&view=session&i=0',
  'session-your-turn-alert': '?fixture=demo&view=session&i=1&alert',
  'session-idle-redline': '?fixture=demo&view=session&i=2',
  'detail': '?fixture=demo&view=detail&i=0',
  'empty': '?fixture=empty',
  'live-home': '',
};

for (const [name, query] of Object.entries(shots)) {
  const file = path.join(out, `${name}.png`);
  execFileSync('/usr/bin/chromium', [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=800,480', '--timeout=2500', `--screenshot=${file}`, BASE + query,
  ], { stdio: 'ignore' });
  console.log(file);
}
