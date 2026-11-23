import { initialNav, onKey, onSnapshot } from './nav.js';

const params = new URLSearchParams(location.search);
const fixture = params.get('fixture');
const screen = document.getElementById('screen');

let nav = initialNav();
let snap = null;
let connected = !!fixture;

const STATUS = { working: 'Working', your_turn: 'Your turn', idle: 'Idle' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const now = () => (fixture && snap ? snap.now : Date.now());

function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id ?? '');
  if (!m) return id ?? '';
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
}
function kTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}
const usd = (v) => (v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`);
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function elapsed(ts) {
  const s = Math.max(0, Math.round((now() - ts) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
function clock() {
  return new Date(now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function segments(pct, count, cls = 'segments') {
  const lit = Math.min(count, Math.round((pct / 100) * count));
  const red = pct >= 90 ? ' red' : '';
  let html = `<div class="${cls}">`;
  for (let i = 0; i < count; i++) html += `<div class="seg${i < lit ? ' on' + red : ''}"></div>`;
  return html + '</div>';
}

const alerting = (id) => (nav.alerts[id] ?? 0) > now();

function renderHome() {
  const list = snap.sessions;
  const shown = list.slice(0, 5);
  const rows = shown.map((s) => `
    <li class="row ${s.status}${alerting(s.id) ? ' alert' : ''}">
      <span class="dot" title="${STATUS[s.status]}"></span>
      <span class="folder-sm ellipsis">${esc(s.folder)}</span>
      ${segments(s.context.pct, 10, 'mini')}
      <span class="pct-sm${s.context.pct >= 90 ? ' red' : ''}">${s.context.pct}%</span>
      <span class="num agents-n">${s.agentCount ? `${s.agentCount} agent${s.agentCount > 1 ? 's' : ''}` : ''}</span>
      <span class="num">${usd(s.cost.usd)}</span>
    </li>`).join('');
  const waiting = list.filter((s) => s.status === 'your_turn').length;
  return `<section class="home">
    <header class="home-head">
      <h1>${list.length} Claude session${list.length === 1 ? '' : 's'}${waiting ? `<span class="dim-text">, ${waiting} waiting on you</span>` : ''}</h1>
      <span class="clock">${clock()}</span>
    </header>
    <ul class="rows">${rows}</ul>
    ${list.length > shown.length ? `<div class="more">${list.length - shown.length} more, turn the knob</div>` : ''}
  </section>`;
}

function sessionHeader(s) {
  const i = snap.sessions.indexOf(s) + 1;
  return `<div class="head"><h1 class="folder ellipsis">${esc(s.folder)}</h1><span class="pos">${i} of ${snap.sessions.length}</span></div>
    <div class="name ellipsis">${esc(s.name)}</div>`;
}

function gauge(s) {
  const red = s.context.pct >= 90 ? ' red' : '';
  return `<div class="gauge">${segments(s.context.pct, 40)}
    <div class="gauge-legend"><span><span class="pct${red}">${s.context.pct}%</span> of context, ${kTokens(s.context.used)} of ${kTokens(s.context.window)}</span>
    <span>active ${ago(s.lastActivity)}</span></div></div>`;
}

function renderSession(s) {
  const max = 4;
  const agents = s.agents.slice(0, max).map((a) => `
    <div class="agent"><span class="ellipsis"><span class="type">${esc(shortType(a.type))}</span> ${esc(a.description)}</span><span class="time">${elapsed(a.startedAt)}</span></div>`).join('');
  return `<div class="lamp"></div><section class="body">
    ${sessionHeader(s)}
    <div class="readouts"><span class="status-text">${STATUS[s.status]}${s.status !== 'working' ? ` <span class="dim-text">${ago(s.statusSince)}</span>` : ''}</span>
      <span>${esc(modelName(s.model))}</span><span class="cost">${usd(s.cost.usd)}</span></div>
    ${gauge(s)}
    <div class="agents">
      ${s.agents.length ? `<h2>${s.agents.length} agent${s.agents.length > 1 ? 's' : ''} running</h2>${agents}
        ${s.agents.length > max ? `<div class="more">+${s.agents.length - max} more, press the knob</div>` : ''}`
        : `<p class="quiet">No agents running</p>`}
    </div></section>`;
}

const shortType = (t) => (t ?? '').split(':').pop();

function renderDetail(s) {
  const agents = s.agents.slice(0, 5).map((a) => `
    <div class="d-agent"><div class="line1 ellipsis">${esc(a.description || shortType(a.type))}</div>
    <div class="line2"><span>${esc(shortType(a.type))}</span><span>${a.context.pct}% context</span><span>${elapsed(a.startedAt)}</span><span>active ${ago(a.lastActivity)}</span></div></div>`).join('');
  const tools = [...s.recentTools].reverse().map((t) => `
    <div class="tool"><span class="tname">${esc(t.name)}</span><span class="ellipsis">${esc(t.summary)}</span></div>`).join('');
  const t = s.cost.tokens;
  return `<div class="lamp"></div><section class="body">
    ${sessionHeader(s)}
    <div class="detail-grid">
      <div><h2>Agents</h2>${agents || '<p class="quiet">No agents running</p>'}</div>
      <div><h2>Recent tool calls</h2>${tools || '<p class="quiet">None yet</p>'}</div>
    </div>
    <div class="tokens"><span><b>${usd(s.cost.usd)}</b> estimated</span><span>in <b>${kTokens(t.input)}</b></span><span>out <b>${kTokens(t.output)}</b></span>
      <span>cache read <b>${kTokens(t.cacheRead)}</b></span><span>cache write <b>${kTokens(t.cacheWrite + t.cacheWrite1h)}</b></span></div>
  </section>`;
}

function renderMessage(big, small) {
  return `<div class="message"><div class="big">${big}</div><div class="small">${small}</div></div>`;
}

function render() {
  document.body.classList.toggle('dim', nav.dim);
  screen.className = '';
  if (!connected) { screen.innerHTML = renderMessage('Laptop disconnected', 'Retrying every few seconds'); return; }
  if (!snap) { screen.innerHTML = ''; return; }
  if (!snap.sessions.length) { screen.innerHTML = renderMessage(clock(), 'No Claude sessions running'); return; }
  const s = snap.sessions.find((x) => x.id === nav.sessionId);
  if (nav.view === 'home' || !s) { screen.innerHTML = renderHome(); return; }
  screen.className = `${s.status}${alerting(s.id) ? ' alert' : ''}`;
  screen.innerHTML = nav.view === 'detail' ? renderDetail(s) : renderSession(s);
}

function applySnapshot(next) {
  nav = onSnapshot(nav, snap, next, now());
  snap = next;
  render();
}

function press(key) {
  const r = onKey(nav, key, snap, now());
  nav = r.nav;
  for (const e of r.effects) {
    if (e.type === 'focus' && !fixture) {
      fetch('/action/focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: e.sessionId }) })
        .catch(() => {});
    }
  }
  render();
}

// Desktop keyboard mirrors the device keys.
const KEYMAP = { ArrowRight: 'RIGHT', ArrowLeft: 'LEFT', Enter: 'ENTER', Escape: 'ESC', Backspace: 'ESC', 1: '1', 2: '2', 3: '3', 4: '4', m: 'm' };
addEventListener('keydown', (e) => { if (KEYMAP[e.key]) { e.preventDefault(); press(KEYMAP[e.key]); } });
// Touch: left third back a screen, right third forward, middle opens detail.
addEventListener('pointerup', (e) => press(e.clientX < 267 ? 'LEFT' : e.clientX > 533 ? 'RIGHT' : 'ENTER'));

function connect() {
  const es = new EventSource('/events');
  es.addEventListener('snapshot', (e) => { connected = true; applySnapshot(JSON.parse(e.data)); });
  es.addEventListener('input', (e) => press(JSON.parse(e.data).key));
  es.onopen = () => { connected = true; render(); };
  es.onerror = () => { connected = false; render(); }; // EventSource retries on its own
}

async function start() {
  if (fixture) {
    const data = await (await fetch(`/web/fixtures/${encodeURIComponent(fixture)}.json`)).json();
    snap = data;
    const view = params.get('view');
    const i = Number(params.get('i') ?? 0);
    if (view && view !== 'home') nav = { ...nav, view, sessionId: data.sessions[i]?.id ?? null };
    if (params.has('alert')) nav.alerts[data.sessions[i]?.id] = data.now + 3000;
    if (params.has('dim')) nav.dim = true;
    render();
    return;
  }
  connect();
  setInterval(render, 1000);
}
start();
