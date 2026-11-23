# Claude Thing Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Spotify Car Thing into a desk dashboard that shows every live Claude Code session on this laptop (status, context, agents, cost), navigated with its knob and buttons.

**Architecture:** A dependency-free Node server on the laptop reads `~/.claude` (session registry, transcripts, subagent metadata) incrementally, builds a JSON snapshot, and serves an 800×480 page plus an SSE stream. The Car Thing runs superbird-debian-kiosk (Chromium kiosk) pointed at the server over USB RNDIS; a small Python forwarder on the device POSTs button events to the server, which relays them to the page.

**Tech Stack:** Node 25 (ESM, `node:test`, no npm deps), plain HTML/CSS/JS, Python 3 stdlib on device, systemd (user unit on laptop, system unit on device), systemd-networkd, superbird-tool.

**Spec:** `docs/superpowers/specs/2026-11-23-claude-thing-dashboard-design.md`

## Global Constraints

- No npm dependencies in server or page; device forwarder is Python stdlib only.
- Read-only on `~/.claude`: never write, lock, or truncate anything there.
- Server listens on `127.0.0.1:7777` always, and on `192.168.7.1:7777` whenever that address exists. Never `0.0.0.0`.
- Laptop USB address `192.168.7.1/24`; device `192.168.7.2`.
- Status states exactly: `working` (raw `busy`), `your_turn` (not busy, < 10 min since status change), `idle` (not busy, ≥ 10 min). Labels: WORKING (green), YOUR TURN (amber), IDLE (gray).
- Only sessions with `kind === "interactive"` and a live pid whose `/proc/<pid>/stat` start time equals `procStart`.
- Page is 800×480 landscape, dark, no blur/box-shadow/filter, no continuous animation except the YOUR TURN alert pulse (≤ 3 s, then static).
- Screen always on; mic button (`m`) toggles manual dim only.
- Auto-jump to a session entering YOUR TURN only if no input for 30 000 ms.
- Session title = basename of `cwd` (large), session `name` small beneath.
- Cost (est. $) and tokens shown on home list, session screen, and detail screen; session totals include its subagents.
- `sudo` needs Vinh's password: every root step is a command for Vinh to run with `! <command>`.

## Review Focus

1. **Duplicate usage lines** — Claude Code writes one JSONL line per content block, each repeating the same `message.usage`; cost must count each `message.id` once. (Test in Task 1.)
2. **Half-written last line** — a transcript being appended may end mid-line; the reader must buffer it, not crash or drop it. (Test in Task 1.)
3. **Stale / reused pid** — `sessions/*.json` outlives crashed sessions and pids get reused; such sessions must not appear. (Test in Task 2.)
4. **Session list changes under the knob** — a session ending while selected must not leave the UI on a blank or wrong screen; selection is by session id, falling back to home. (Test in Task 4.)
5. **Server up before USB / Hyprland** — at boot neither the RNDIS address nor Hyprland exists; server must start, later bind the USB address, and the focus action must find Hyprland at press time. (Tests in Task 3.)

---

## File Structure

```
claude-thing/
  package.json                 type:module, "test": "node --test"
  server/
    config.js                  constants + paths (claudeDir, port, thresholds)
    prices.js                  per-model price table, estimateCostUsd()
    transcript.js              incremental JSONL tail + usage/context aggregation
    sessions.js                live session registry reader, pid liveness
    agents.js                  subagent meta + transcript reader
    snapshot.js                classifyStatus(), buildSnapshot()
    focus.js                   Hyprland focus by session pid
    http.js                    HTTP routes, SSE hub
    main.js                    poll loop, listeners, wiring
  web/
    index.html  style.css  app.js
    nav.js                     pure navigation reducer (shared by browser + tests)
  device/
    claude-buttons.py          evdev → POST /input forwarder
    claude-buttons.service
  deploy/
    claude-thing.service       systemd --user unit
    10-carthing.network        systemd-networkd for RNDIS link
    flash.sh                   download image + run superbird-tool
  scripts/
    screenshot.mjs             headless chromium 800×480 screenshots
  test/
    fixtures/                  sample sessions/, projects/ trees
    *.test.js
```

---

### Task 1: Transcript reader, context, and cost

**Files:**
- Create: `package.json`, `.gitignore` (`node_modules/`, `.tools/`, `shots/`), `server/config.js`, `server/prices.js`, `server/transcript.js`
- Test: `test/transcript.test.js`, `test/prices.test.js`

**Interfaces:**
- Produces:
  - `config.js`: `export const CLAUDE_DIR` (default `~/.claude`, env `CLAUDE_DIR` override), `PORT = 7777`, `USB_ADDR = '192.168.7.1'`, `YOUR_TURN_MS = 600_000`, `AUTOJUMP_IDLE_MS = 30_000`, `POLL_MS = 1000`, `DEFAULT_WINDOW = 200_000`, `LARGE_WINDOW = 1_000_000`.
  - `prices.js`: `PRICES: Record<modelPrefix, {input, output, cacheWrite, cacheRead}>` ($/MTok); `estimateCostUsd(tokensByModel: Record<model, Tokens>) -> number`. `Tokens = {input, output, cacheRead, cacheWrite}`. Unknown model → priced as the most expensive known model (overestimate, never $0).
  - `transcript.js`: `class TranscriptTail { constructor(path); poll(): Promise<void>; summary(): TranscriptSummary }` where `TranscriptSummary = { model: string|null, contextUsed: number, tokensByModel: Record<string,Tokens>, lastActivity: number|null /*ms*/, recentTools: Array<{name, summary, ts}> /*last 5*/ }`. `contextWindow(used: number) -> number` (`DEFAULT_WINDOW` unless `used > DEFAULT_WINDOW`, then `LARGE_WINDOW`).

- [ ] **Step 1: Get current prices.** Load the `claude-api` skill and copy current per-MTok prices (input, output, cache write 1h/5m — use the 5m-write price for `cacheWrite` unless the usage line's `cache_creation.ephemeral_1h_input_tokens` is non-zero, then price that portion at the 1h rate) for every current Claude model into `PRICES`. Note the source and date in a comment.

- [ ] **Step 2: Write failing tests** (`test/transcript.test.js`, temp files via `fs.mkdtemp`):
  - `dedupes usage by message.id`: two assistant lines sharing `message.id: "m1"` with `usage {input_tokens:10, cache_read_input_tokens:100, cache_creation_input_tokens:5, output_tokens:7}` → `tokensByModel['claude-opus-5-5']` equals `{input:10, output:7, cacheRead:100, cacheWrite:5}`.
  - `context comes from latest main-chain assistant`: lines with `isSidechain:false` usage summing 1000, then 3000 → `contextUsed === 3000`; a later `isSidechain:true` line with 9999 does not change it.
  - `buffers partial trailing line`: write `{"type":"assistant",...` without newline, `poll()`, then append rest + `\n`, `poll()` → counted exactly once.
  - `incremental`: after first `poll()`, appending one line and polling again reads only new bytes (assert via counting — a second `poll()` with no change leaves totals equal).
  - `recentTools`: 7 `tool_use` blocks → last 5 kept, newest last, `summary` = `input.description ?? input.command ?? input.file_path ?? ''` truncated to 60 chars.
  - `ignores malformed lines`: a line `not json` is skipped, no throw.
  - `contextWindow(150_000) === 200_000`, `contextWindow(250_000) === 1_000_000`.
  - `test/prices.test.js`: `estimateCostUsd({'claude-opus-5-5': {input:1e6, output:0, cacheRead:0, cacheWrite:0}})` equals `PRICES` opus input price; unknown model `'claude-mystery-9'` returns > 0.

- [ ] **Step 3: Run** `npm test` — Expected: FAIL (modules missing).

- [ ] **Step 4: Implement** `config.js`, `prices.js`, `transcript.js`. Reader keeps `offset` and a `remainder` string; reads `[offset, size)` with `fs.promises.open`/`read`; if `size < offset` (file replaced) reset to 0 and clear aggregates. `lastActivity` = max `timestamp` (ISO → ms) of any line.

- [ ] **Step 5: Run** `npm test` — Expected: PASS.

- [ ] **Step 6: Smoke on real data:** `node -e "import('./server/transcript.js').then(async m=>{const t=new m.TranscriptTail(process.argv[1]);await t.poll();console.log(t.summary())})" ~/.claude/projects/-home-vinh-code/2a713018-ac7f-4cc7-8a7c-f307b7b35bdd.jsonl` — Expected: `model: 'claude-opus-5-5'`, `contextUsed` in the tens of thousands, non-empty `recentTools`.

- [ ] **Step 7: Commit** `feat: incremental transcript reader with context and cost`

---

### Task 2: Sessions, agents, snapshot

**Files:**
- Create: `server/sessions.js`, `server/agents.js`, `server/snapshot.js`, `test/fixtures/` (built in-test is fine)
- Test: `test/sessions.test.js`, `test/snapshot.test.js`

**Interfaces:**
- Consumes: `TranscriptTail`, `contextWindow`, `estimateCostUsd`, config constants (Task 1).
- Produces:
  - `sessions.js`: `readLiveSessions(claudeDir, isAlive = pidMatches) -> Promise<RawSession[]>`; `RawSession` = the JSON file contents (`pid, sessionId, cwd, name, status, statusUpdatedAt, startedAt, kind, procStart`). `pidMatches(pid, procStart) -> boolean` (reads `/proc/<pid>/stat`, field 22 after the `)`-terminated comm, compares as string). `transcriptPath(claudeDir, cwd, sessionId)` = `${claudeDir}/projects/${cwd.replaceAll('/', '-')}/${sessionId}.jsonl`.
  - `agents.js`: `readAgents(sessionDir) -> Promise<AgentRaw[]>` from `subagents/agent-*.meta.json` (`id` = file stem, `agentType`, `description`, `finished`, `startedAt` = meta file birthtime/mtime-at-first-sight ms, `transcript` path to sibling `.jsonl`).
  - `snapshot.js`: `classifyStatus(rawStatus, statusUpdatedAt, now) -> 'working'|'your_turn'|'idle'`; `class SnapshotBuilder { constructor(claudeDir, deps?); build(now) : Promise<Snapshot> }` caching one `TranscriptTail` per transcript path and dropping tails for vanished sessions.
  - `Snapshot = { now, sessions: Session[] }`; `Session = { id, pid, folder, cwd, name, status, statusSince, model, context:{used, window, pct}, cost:{usd, tokens}, agents: Agent[] /*running only*/, agentCount, lastActivity, recentTools }`; `Agent = { id, type, description, startedAt, lastActivity, context:{used, window, pct} }`. `tokens` = sum over session + all its subagents (finished included). Sessions sorted by `folder`, then `startedAt`.

- [ ] **Step 1: Write failing tests:**
  - `classifyStatus('busy', 0, 1e9) === 'working'`; `classifyStatus('shell', now-599_999, now) === 'your_turn'`; `classifyStatus('shell', now-600_000, now) === 'idle'`; any unknown raw status behaves like `'shell'`.
  - `skips dead and non-interactive`: fixture with 3 session files (alive interactive, dead pid, `kind:"sdk"`) and stub `isAlive` → only the first returned.
  - `pidMatches(process.pid, <real procStart from /proc/self/stat>) === true`, and with `'1'` → false.
  - `readAgents` on fixture with one finished and one running meta → both returned with `finished` flags; missing `subagents/` dir → `[]`.
  - `snapshot sums subagent cost`: session transcript 1M opus input tokens + one finished subagent 1M → `cost.tokens.input === 2_000_000`; `agents` lists only unfinished.
  - `snapshot ordering`: folders `zeta`, `alpha` → `alpha` first.

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Smoke:** `node -e "import('./server/snapshot.js').then(async m=>console.dir(await new m.SnapshotBuilder(process.env.HOME+'/.claude').build(Date.now()),{depth:4}))"` — Expected: both live sessions (`code`, `tempovelo`) with plausible context/cost.
- [ ] **Step 6: Commit** `feat: session registry, agents, and snapshot builder`

---

### Task 3: HTTP server, SSE, input relay, focus, autostart

**Files:**
- Create: `server/http.js`, `server/focus.js`, `server/main.js`, `deploy/claude-thing.service`
- Test: `test/http.test.js`, `test/focus.test.js`

**Interfaces:**
- Consumes: `SnapshotBuilder` (Task 2).
- Produces (HTTP, used by Tasks 5 and 7):
  - `GET /` → `web/index.html`; `GET /web/*` static (no path traversal outside `web/`).
  - `GET /state` → current `Snapshot` JSON.
  - `GET /events` → SSE; events `snapshot` (data = Snapshot JSON, sent on connect and whenever JSON changes) and `input` (data = `{"key":"RIGHT"}`); comment heartbeat every 15 s.
  - `POST /input` body `{"key": K}`, K ∈ `1 2 3 4 m ENTER ESC LEFT RIGHT` → 204 and broadcast; else 400.
  - `POST /action/focus` body `{"sessionId"}` → 204 on success, 404 unknown session, 503 if Hyprland not found.
- `http.js`: `createApp({ getSnapshot, focus, webDir }) -> { handler(req,res), broadcastSnapshot(snap) }`.
- `focus.js`: `findHyprSignature(runtimeDir) -> string|null` (newest dir in `${runtimeDir}/hypr/` containing `.socket.sock`); `terminalPidFor(pid, readPpid, windowPids) -> number|null` (walk ppid chain up to 15 levels until a pid in `windowPids`); `focusSession(pid) -> Promise<boolean>` (runs `hyprctl -j clients` and `hyprctl dispatch focuswindow pid:<n>` with `HYPRLAND_INSTANCE_SIGNATURE` set).
- `main.js`: polls `build(Date.now())` every `POLL_MS`; listens on `127.0.0.1:PORT` immediately; every 5 s, if `os.networkInterfaces()` has `USB_ADDR` and no USB listener, starts one; if that listener errors/closes, clears it to retry.

- [ ] **Step 1: Write failing tests:**
  - `http.test.js` (start handler on ephemeral port with stub snapshot): `GET /state` returns stub; `POST /input {"key":"RIGHT"}` → 204 and an open `/events` client receives `event: input` with `{"key":"RIGHT"}`; `{"key":"X"}` → 400; `GET /web/../package.json` → 404; `/events` first event is `snapshot`.
  - `focus.test.js`: `terminalPidFor(100, ppidMap {100:90, 90:80, 80:1}, new Set([80])) === 80`; no match → `null`; `findHyprSignature` on temp dir with two signature dirs (only newer has `.socket.sock`) → newer; missing `hypr/` → `null`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** `http.js`, `focus.js`, `main.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Write** `deploy/claude-thing.service`: `ExecStart=/home/vinh/.local/share/mise/installs/node/25.2.1/bin/node /home/vinh/code/claude-thing/server/main.js`, `Restart=on-failure`, `RestartSec=3`, `WantedBy=default.target`. (Linger is already `yes`, so it starts at boot.)
- [ ] **Step 6: Install + verify:** `ln -sf ~/code/claude-thing/deploy/claude-thing.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now claude-thing` then `curl -s localhost:7777/state | head -c 300` — Expected: JSON with `sessions`. Also verify focus manually: `curl -s -XPOST localhost:7777/action/focus -d '{"sessionId":"<tempovelo id>"}' -w '%{http_code}'` → `204` and that terminal comes to front.
- [ ] **Step 7: Commit** `feat: dashboard server with SSE, input relay, focus action, user service`

---

### Task 4: Navigation reducer

**Files:**
- Create: `web/nav.js`
- Test: `test/nav.test.js`

**Interfaces:**
- Consumes: `Snapshot` shape (Task 2).
- Produces: `initialNav() -> Nav`; `Nav = { view:'home'|'session'|'detail', sessionId:string|null, dim:boolean, lastInputAt:number, alerts: Record<sessionId, number /*alert-until ms*/> }`; `onKey(nav, key, snap, now) -> { nav, effects: Array<{type:'focus', sessionId}> }`; `onSnapshot(nav, prevSnap, snap, now) -> nav`. Positions = `[home, ...snap.sessions]`.

- [ ] **Step 1: Write failing tests** (snapshot fixture with sessions A, B, C):
  - `RIGHT` from home → session A; `RIGHT` from C → home (wraps); `LEFT` from home → C.
  - `ENTER` on session → `detail`; `ENTER` on home → session A; `ESC` detail → session; `ESC` session → home.
  - `1` from A with B `idle`, C `your_turn` → C; no `your_turn` sessions → unchanged.
  - `2` → session with most `agentCount` (tie → latest `lastActivity`); `3` → latest `lastActivity`.
  - `4` on session B → effects `[{type:'focus', sessionId:'B'}]`; on home → `[]`.
  - `m` toggles `dim`.
  - every key sets `lastInputAt = now`.
  - `onSnapshot`: selected session disappears → `view:'home'`, `sessionId:null`.
  - `onSnapshot`: B goes `working → your_turn`, `now - lastInputAt = 30_001` → selects B, view `session`, `alerts.B === now + 3000`; same at `29_999` → selection unchanged but `alerts.B` still set.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** `web/nav.js` (pure ESM, no DOM).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: knob/button navigation reducer`

---

### Task 5: Page UI + screenshots (APPROVAL GATE)

**Files:**
- Create: `web/index.html`, `web/style.css`, `web/app.js`, `scripts/screenshot.mjs`, `test/fixtures/demo-snapshot.json`

**Interfaces:**
- Consumes: `/events`, `/action/focus` (Task 3); `onKey`, `onSnapshot`, `initialNav` (Task 4).
- Produces: page served at `/`. `?fixture=<name>` loads `/web/fixtures/<name>.json` instead of SSE (copy demo fixture into `web/fixtures/`), `?view=home|session|detail&i=<n>` forces a view (for screenshots).

Screens (layouts from spec): **home list** (header "CLAUDE · N sessions" + clock; row per session: status dot, folder, context %, `⟳n` agents, `$x.xx`); **session** (folder large, name small, `k / N`, status label + model + `$` + "last Xs ago", context bar with `pct% used/window` in k, running agents with type: description and `m:ss` elapsed); **detail** (all running agents with own context %, last activity; last 5 tool calls; tokens breakdown in/out/cache); **empty** ("No Claude sessions running" + clock); **disconnected** ("Laptop disconnected — retrying" when SSE errors). Alert: amber 4px border pulse for the 3 s in `nav.alerts`. Dim: whole page `opacity: .35`. Touch: tap left third = `LEFT`, right third = `RIGHT`, middle = `ENTER`. Keyboard arrows/Enter/Escape/1-4/m map to the same keys (desktop testing).

Type: system sans; folder title ≥ 44px, body ≥ 22px, nothing < 18px. Colors: bg `#0d0f12`, text `#e8e6e3`, WORKING `#3fb950`, YOUR TURN `#f0a020`, IDLE `#6e7681`. Long names ellipsize; > 4 agents on session screen shows "+N more".

- [ ] **Step 1: Write** `demo-snapshot.json`: 4 sessions covering working w/ 3 agents (one description 80+ chars), your_turn, idle, and one at 92% context; costs from $0.04 to $27.50.
- [ ] **Step 2: Implement** page files.
- [ ] **Step 3: Write** `scripts/screenshot.mjs`: for each of `home`, `session&i=0`, `session&i=1`, `detail&i=0`, empty fixture, and live (no fixture), run `/usr/bin/chromium --headless --disable-gpu --hide-scrollbars --window-size=800,480 --screenshot=shots/<name>.png "http://127.0.0.1:7777/?..."` → PNGs in `shots/`.
- [ ] **Step 4: Run** `node scripts/screenshot.mjs` and open each PNG with Read to self-check: nothing clipped, text readable, matches spec layouts.
- [ ] **Step 5: GATE — show Vinh the screenshots** (paths + images) and get approval. Iterate on feedback before continuing. Do not start Task 6 without approval.
- [ ] **Step 6: Commit** `feat: dashboard page with home, session, detail views`

---

### Task 6: USB network + flash the Car Thing

**Files:**
- Create: `deploy/10-carthing.network`, `deploy/flash.sh`

**Interfaces:**
- Produces: device reachable at `192.168.7.2` from laptop at `192.168.7.1`.

- [ ] **Step 1: Write** `deploy/10-carthing.network`: `[Match] Driver=rndis_host cdc_ether` / `[Link] RequiredForOnline=no` / `[Network] Address=192.168.7.1/24`, `LinkLocalAddressing=no`, `IPv6AcceptRA=no`. (Sorts before `20-ethernet.network`, which would otherwise DHCP it.)
- [ ] **Step 2: Write** `deploy/flash.sh` (run as root): clone `https://github.com/bishopdynamics/superbird-tool` into `.tools/superbird-tool` if absent, create `.tools/venv` with `pyusb`; download and extract `debian_bullseye_arm64_v2.0.0-94c2e46_landscape_2025-09-29.tar.gz` from the v2.0 release into `.tools/image/`; run `superbird_tool.py --find_device` then `--restore_device .tools/image/<folder>`. Abort with a clear message if `--find_device` doesn't see the device. Before running, read superbird-tool's README to confirm flags are unchanged.
- [ ] **Step 3: Vinh runs** (device in burn mode: hold 1+4 while plugging in, no hub): `! sudo cp ~/code/claude-thing/deploy/10-carthing.network /etc/systemd/network/ && sudo networkctl reload` then `! sudo bash ~/code/claude-thing/deploy/flash.sh`. Expected: restore completes without error.
- [ ] **Step 4: Vinh replugs normally.** Verify: `ip -br addr | grep 192.168.7.1` shows the RNDIS interface, `ping -c2 192.168.7.2` succeeds, `ssh superbird@192.168.7.2 true` (password `superbird`) works. If the interface appears but no address, check `networkctl status <iface>` for the driver name and adjust `Driver=`.
- [ ] **Step 5: Commit** `feat: USB network config and flash script`

---

### Task 7: Device setup — URL, credentials, button forwarder, end-to-end

**Files:**
- Create: `device/claude-buttons.py`, `device/claude-buttons.service`

**Interfaces:**
- Consumes: `POST /input` (Task 3); device evdev: `/dev/input/event0` buttons (`EV_KEY` value 1; codes `2:'1' 3:'2' 4:'3' 5:'4' 50:'m' 28:'ENTER' 1:'ESC'`), `/dev/input/event1` knob (`EV_REL` code 6; value `1` → `RIGHT`, `-1`/`4294967295` → `LEFT`); struct format `'llHHI'`.

- [ ] **Step 1: Implement** `claude-buttons.py`: one thread per device, translate, POST `{"key":K}` to `http://192.168.7.1:7777/input` with 1 s timeout; on failure log once per minute and keep reading (never crash on server down). Unit-test `translate(etype, code, value)` with `python3 -m doctest` examples for all 9 keys + an unmapped code → `None`.
- [ ] **Step 2: Write** `claude-buttons.service`: `After=network-online.target`, `ExecStart=/usr/bin/python3 /opt/claude-buttons.py`, `Restart=always`, `WantedBy=multi-user.target`.
- [ ] **Step 3: Install on device:** set up SSH key auth (`ssh-copy-id superbird@192.168.7.2`) and change the password; `scp` both files; `sudo install` to `/opt` and `/etc/systemd/system`; `sudo systemctl enable --now claude-buttons`. Set `/etc/kiosk/config.json` `"url": "http://192.168.7.1:7777/"`, clear Home Assistant fields, `sudo systemctl restart kiosk`.
- [ ] **Step 4: Verify HA button handler is harmless:** press each button, check `journalctl -u kiosk -n 50` on device. If it errors per press or acts, disable it by guarding the `Buttons(...)` construction in `/scripts/kiosk.py` (keep a `.orig` copy) and restart kiosk.
- [ ] **Step 5: End-to-end on hardware** (photo or VNC screenshot for Vinh): page shows live sessions; knob turns move through home → sessions; press opens detail; back returns; 1/2/3 jump; 4 focuses the terminal on the laptop; `m` dims; start a short prompt in a session and watch WORKING → YOUR TURN with pulse and auto-jump after 30 s idle.
- [ ] **Step 6: Reboot check:** reboot laptop (Vinh's call when convenient) → `systemctl --user is-active claude-thing` is `active` before login-dependent features; replug Car Thing → dashboard reappears without manual steps.
- [ ] **Step 7: Commit** `feat: device button forwarder and setup`
