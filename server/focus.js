import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function readPpid(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  } catch {
    return null;
  }
}

export function terminalPidFor(pid, ppidOf, windowPids) {
  let p = pid;
  for (let i = 0; i < 15 && p && p > 1; i++) {
    if (windowPids.has(p)) return p;
    const next = ppidOf(p);
    if (next === p) return null;
    p = next;
  }
  return null;
}

export async function findHyprSignature(runtimeDir) {
  let names;
  try { names = await fs.readdir(`${runtimeDir}/hypr`); } catch { return null; }
  let best = null;
  for (const n of names) {
    try {
      await fs.access(`${runtimeDir}/hypr/${n}/.socket.sock`);
      const st = await fs.stat(`${runtimeDir}/hypr/${n}`);
      if (!best || st.mtimeMs > best.t) best = { n, t: st.mtimeMs };
    } catch { /* no socket */ }
  }
  return best?.n ?? null;
}

// Looked up at press time: the server may start at boot before Hyprland exists.
export async function focusSession(pid) {
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`;
  const sig = await findHyprSignature(runtimeDir);
  if (!sig) return false;
  const env = { ...process.env, HYPRLAND_INSTANCE_SIGNATURE: sig, XDG_RUNTIME_DIR: runtimeDir };
  try {
    const { stdout } = await run('hyprctl', ['-j', 'clients'], { env });
    const windowPids = new Set(JSON.parse(stdout).map((c) => c.pid));
    const target = terminalPidFor(pid, readPpid, windowPids);
    if (!target) return false;
    await run('hyprctl', ['dispatch', 'focuswindow', `pid:${target}`], { env });
    return true;
  } catch (err) {
    console.error('focus failed', err.message);
    return false;
  }
}
