// Pure navigation state for the knob and buttons. Shared by the page and node tests.
export const AUTOJUMP_IDLE_MS = 30_000;
export const ALERT_MS = 3000;

export function initialNav() {
  return { view: 'home', sessionId: null, dim: false, lastInputAt: 0, alerts: {} };
}

const home = (nav) => ({ ...nav, view: 'home', sessionId: null });
const show = (nav, id) => (id ? { ...nav, view: 'session', sessionId: id } : nav);

function move(nav, snap, step) {
  const ids = [null, ...snap.sessions.map((s) => s.id)];
  const i = Math.max(0, ids.indexOf(nav.view === 'home' ? null : nav.sessionId));
  const id = ids[(i + step + ids.length) % ids.length];
  return id === null ? home(nav) : show(nav, id);
}

function pick(sessions, better) {
  return sessions.reduce((best, s) => (best === null || better(s, best) ? s : best), null)?.id;
}

export function onKey(nav, key, snap, now) {
  let n = { ...nav, lastInputAt: now };
  const effects = [];
  const sessions = snap?.sessions ?? [];
  switch (key) {
    case 'RIGHT': n = move(n, { sessions }, 1); break;
    case 'LEFT': n = move(n, { sessions }, -1); break;
    case 'ENTER':
      if (n.view === 'session') n = { ...n, view: 'detail' };
      else if (n.view === 'home') n = show(n, sessions[0]?.id);
      break;
    case 'ESC':
      n = n.view === 'detail' ? { ...n, view: 'session' } : home(n);
      break;
    case '1': {
      const waiting = sessions.filter((s) => s.status === 'your_turn');
      if (waiting.length) {
        const order = sessions.map((s) => s.id);
        const cur = order.indexOf(n.sessionId);
        const after = waiting.find((s) => order.indexOf(s.id) > cur) ?? waiting[0];
        n = show(n, after.id);
      }
      break;
    }
    case '2':
      n = show(n, pick(sessions, (s, b) => s.agentCount > b.agentCount ||
        (s.agentCount === b.agentCount && (s.lastActivity ?? 0) > (b.lastActivity ?? 0))));
      break;
    case '3':
      n = show(n, pick(sessions, (s, b) => (s.lastActivity ?? 0) > (b.lastActivity ?? 0)));
      break;
    case '4':
      if (n.view !== 'home' && n.sessionId) effects.push({ type: 'focus', sessionId: n.sessionId });
      break;
    case 'm': n = { ...n, dim: !n.dim }; break;
    default: break;
  }
  return { nav: n, effects };
}

export function onSnapshot(nav, prevSnap, snap, now) {
  let n = { ...nav, alerts: { ...nav.alerts } };
  const ids = new Set(snap.sessions.map((s) => s.id));
  if (n.view !== 'home' && !ids.has(n.sessionId)) n = home(n);
  for (const [id, until] of Object.entries(n.alerts)) if (until <= now || !ids.has(id)) delete n.alerts[id];
  if (!prevSnap) return n;
  const before = new Map(prevSnap.sessions.map((s) => [s.id, s.status]));
  for (const s of snap.sessions) {
    if (s.status !== 'your_turn' || !before.has(s.id) || before.get(s.id) === 'your_turn') continue;
    n.alerts[s.id] = now + ALERT_MS;
    if (now - n.lastInputAt > AUTOJUMP_IDLE_MS) n = show(n, s.id);
  }
  return n;
}
