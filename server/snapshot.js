import path from 'node:path';
import { CLAUDE_DIR, YOUR_TURN_MS, STALE_AGENT_MS } from './config.js';
import { readLiveSessions, pidMatches, transcriptPath } from './sessions.js';
import { readAgents } from './agents.js';
import { TranscriptTail, contextWindow, emptyTokens } from './transcript.js';
import { estimateCostUsd } from './prices.js';

export function classifyStatus(rawStatus, statusUpdatedAt, now) {
  if (rawStatus === 'busy') return 'working';
  return now - (statusUpdatedAt ?? 0) < YOUR_TURN_MS ? 'your_turn' : 'idle';
}

function ctx(used, model) {
  const window = contextWindow(used, model);
  return { used, window, pct: Math.round((used / window) * 100) };
}

function addTokens(into, byModel) {
  for (const [model, t] of Object.entries(byModel)) {
    const acc = (into[model] ??= emptyTokens());
    for (const k of Object.keys(acc)) acc[k] += t[k];
  }
}

export class SnapshotBuilder {
  constructor(claudeDir = CLAUDE_DIR, { isAlive = pidMatches } = {}) {
    this.claudeDir = claudeDir;
    this.isAlive = isAlive;
    this.tails = new Map();
  }

  tail(file, opts) {
    let t = this.tails.get(file);
    if (!t) { t = new TranscriptTail(file, opts); this.tails.set(file, t); }
    return t;
  }

  async build(now) {
    const raws = await readLiveSessions(this.claudeDir, this.isAlive);
    const used = new Set();
    const sessions = [];
    for (const r of raws) {
      const main = transcriptPath(this.claudeDir, r.cwd, r.sessionId);
      const mt = this.tail(main);
      used.add(main);
      await mt.poll();
      const ms = mt.summary();
      const tokensByModel = {};
      addTokens(tokensByModel, ms.tokensByModel);
      let lastActivity = ms.lastActivity;
      const agents = [];
      for (const a of await readAgents(main.slice(0, -'.jsonl'.length))) {
        const at = this.tail(a.transcript, { agent: true });
        used.add(a.transcript);
        await at.poll();
        const as = at.summary();
        addTokens(tokensByModel, as.tokensByModel);
        if (as.lastActivity && (!lastActivity || as.lastActivity > lastActivity)) lastActivity = as.lastActivity;
        // `finished` is only written on clean exit; killed/nested agents never get it.
        if (!a.finished && now - a.modifiedAt < STALE_AGENT_MS) {
          agents.push({ id: a.id, type: a.type, description: a.description, startedAt: a.startedAt,
            lastActivity: as.lastActivity, context: ctx(as.contextUsed, as.model ?? ms.model) });
        }
      }
      const tokens = emptyTokens();
      for (const t of Object.values(tokensByModel)) for (const k of Object.keys(tokens)) tokens[k] += t[k];
      agents.sort((a, b) => a.startedAt - b.startedAt);
      sessions.push({
        id: r.sessionId, pid: r.pid, folder: path.basename(r.cwd), cwd: r.cwd, name: r.name ?? '',
        status: classifyStatus(r.status, r.statusUpdatedAt, now), statusSince: r.statusUpdatedAt ?? null,
        startedAt: r.startedAt ?? 0, model: ms.model, context: ctx(ms.contextUsed, ms.model),
        cost: { usd: estimateCostUsd(tokensByModel), tokens },
        agents, agentCount: agents.length, lastActivity, recentTools: ms.recentTools,
      });
    }
    for (const k of this.tails.keys()) if (!used.has(k)) this.tails.delete(k);
    sessions.sort((a, b) => a.folder.localeCompare(b.folder) || a.startedAt - b.startedAt);
    return { now, sessions };
  }
}
