// Plan usage limits (the numbers Claude Code's /usage shows), polled from Anthropic.
// The OAuth token is read fresh from Claude Code's credentials file on every poll and
// only ever sent to api.anthropic.com. We never refresh it ourselves: refreshing can
// rotate the stored login out from under Claude Code.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const USAGE_POLL_MS = 60_000;

const ts = (s) => (s ? Date.parse(s) : null);

export function parseUsage(j) {
  const session = j?.five_hour?.utilization != null
    ? { pct: Math.round(j.five_hour.utilization), resetsAt: ts(j.five_hour.resets_at) }
    : null;
  let weekly = (j?.limits ?? [])
    .filter((l) => l.group === 'weekly' && l.percent != null)
    .map((l) => ({
      label: l.kind === 'weekly_all' ? 'All models' : (l.scope?.model?.display_name ?? 'Scoped'),
      pct: Math.round(l.percent),
      resetsAt: ts(l.resets_at),
    }));
  if (!weekly.length && j?.seven_day?.utilization != null) {
    weekly = [{ label: 'All models', pct: Math.round(j.seven_day.utilization), resetsAt: ts(j.seven_day.resets_at) }];
  }
  return { session, weekly };
}

export async function readClaudeToken(file = path.join(os.homedir(), '.claude', '.credentials.json')) {
  try {
    const c = JSON.parse(await fs.readFile(file, 'utf8')).claudeAiOauth;
    return c?.accessToken ? { accessToken: c.accessToken, expiresAt: c.expiresAt ?? 0 } : null;
  } catch {
    return null;
  }
}

export class UsagePoller {
  constructor({ readToken = readClaudeToken, fetchImpl = fetch } = {}) {
    this.readToken = readToken;
    this.fetchImpl = fetchImpl;
    this.current = { status: 'pending', session: null, weekly: [], fetchedAt: null };
  }

  async poll(now = Date.now()) {
    const keep = { session: this.current.session, weekly: this.current.weekly, fetchedAt: this.current.fetchedAt };
    const tok = await this.readToken();
    if (!tok) { this.current = { ...keep, status: 'no-login' }; return; }
    if (tok.expiresAt && tok.expiresAt <= Date.now()) { this.current = { ...keep, status: 'expired' }; return; }
    try {
      const res = await this.fetchImpl(USAGE_URL, {
        headers: { authorization: `Bearer ${tok.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status !== 200) {
        if (this.lastLogged !== res.status) console.error(`usage poll: HTTP ${res.status}`);
        this.lastLogged = res.status;
        this.current = { ...keep, status: 'error' };
        return;
      }
      this.lastLogged = 200;
      this.current = { status: 'ok', ...parseUsage(await res.json()), fetchedAt: now };
    } catch (err) {
      console.error(`usage poll failed: ${err.name}`);
      this.current = { ...keep, status: 'error' };
    }
  }
}
