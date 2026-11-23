import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function pidMatches(pid, procStart) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] === String(procStart);
  } catch {
    return false;
  }
}

export function transcriptPath(claudeDir, cwd, sessionId) {
  return path.join(claudeDir, 'projects', cwd.replaceAll('/', '-'), `${sessionId}.jsonl`);
}

export async function readLiveSessions(claudeDir, isAlive = pidMatches) {
  const dir = path.join(claudeDir, 'sessions');
  let names;
  try { names = await fs.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const s = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      if (s.kind !== 'interactive' || !s.sessionId || !s.cwd) continue;
      if (!isAlive(s.pid, s.procStart)) continue;
      out.push(s);
    } catch { /* unreadable or half-written: skip this tick */ }
  }
  return out;
}
