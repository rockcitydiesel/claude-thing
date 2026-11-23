import fs from 'node:fs/promises';
import path from 'node:path';

export async function readAgents(sessionDir) {
  const dir = path.join(sessionDir, 'subagents');
  let names;
  try { names = await fs.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.meta.json')) continue;
    const file = path.join(dir, name);
    try {
      const transcript = path.join(dir, `${name.slice(0, -'.meta.json'.length)}.jsonl`);
      const [raw, st, tst] = await Promise.all([
        fs.readFile(file, 'utf8'), fs.stat(file), fs.stat(transcript).catch(() => null)]);
      const meta = JSON.parse(raw);
      const id = name.slice(0, -'.meta.json'.length);
      out.push({
        id,
        type: meta.agentType ?? 'agent',
        description: meta.description || (meta.parentAgentId ? 'nested agent' : ''),
        finished: meta.finished === true,
        startedAt: Math.round(st.birthtimeMs || st.mtimeMs),
        transcript,
        modifiedAt: Math.round(tst?.mtimeMs ?? st.mtimeMs),
      });
    } catch { /* skip */ }
  }
  return out;
}
