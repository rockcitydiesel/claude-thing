# Claude Thing — Car Thing dashboard for Claude Code sessions

Date: 2026-11-23 · Status: ready for approval

## Intent

Vinh has a discontinued Spotify Car Thing (800×480 touchscreen, rotary knob
with press, 4 top preset buttons + a mic/mute button, a back button). Rather
than landfill it, turn it into a desk display that shows **what each running
Claude Code session is doing at a glance**, built on the community firmware
work, with the knob and buttons doing useful things.

Success: glance at the Car Thing and know, per session, whether it's working,
idle, or waiting on you, how full its context is, and which agents it has
running — and flip between sessions with the knob.

## Goals

- One screen per live Claude Code session; knob turns between them.
- Per session: session name, project folder, status, model, context usage
  (bar + % + tokens/window), running agents (type, description, elapsed
  time), time since last activity.
- Knob press opens a detail view; back returns.
- Preset buttons do useful jumps / actions (mapping below).
- Updates live (≤ ~2 s latency) without touching any Claude Code session.
- Server starts automatically when the laptop boots — no manual step.
- Per-session cumulative tokens and **estimated $ cost**, shown everywhere
  (home list, session screen, detail screen). Includes the session's
  subagents' usage. Estimate from a per-model price table (input, output,
  cache write, cache read).

**Display decisions (Vinh, 2026-11-23):**
- Placement: flat on the desk next to the monitor, landscape, arm's length →
  flash the **landscape** image; size type for ~60–70 cm viewing.
- **Home list** is the first knob position: one row per session (status
  dot, folder, context %, running-agent count, est. $). Turning right goes
  into per-session screens.
- Session title: **project folder big**, session name smaller underneath.
- Alerts: when a session enters YOUR TURN, brighten + pulse an amber border;
  if the knob/buttons haven't been touched for 30 s, auto-jump to that
  session.
- Screen: **always on**, no auto-sleep or auto-dim. (Mic button still
  toggles a manual dim.)

**Status meaning (decided):** Vinh runs every session with
`--dangerously-skip-permissions`, so sessions never block on permission
prompts. Status therefore has three states:
- **WORKING** (green) — session `status: busy`.
- **YOUR TURN** (amber) — finished its turn, waiting for the next prompt,
  for less than 10 minutes.
- **IDLE** (gray) — finished and untouched for 10+ minutes.

**Scope (decided):** only Claude Code sessions on this laptop
(`~/.claude`). Remote machines (e.g. vinhPN) are out. Non-interactive
sessions (`kind` ≠ `interactive`, SDK/headless runs) are hidden.

## Non-goals

- Controlling Claude from the device (no approving permissions, no sending
  prompts). Read-only on Claude's side.
- Account-level billing or rate-limit tracking (per-session cost estimates
  ARE in scope, see below).
- Wi-Fi, music, or any other app on the device. It is a single-purpose
  Claude dashboard.
- Backing up the stock firmware (Vinh explicitly declined).

## Anti-goals

- Anything that slows down or interferes with running Claude sessions
  (e.g. reparsing multi-MB transcripts every tick from the start).
- Exposing transcript data to the LAN — the server must only be reachable
  from the laptop and the Car Thing's USB link.
- A UI that's sluggish on the device: Chromium there has **no GPU
  acceleration**, so no blur, heavy shadows, or continuous animations.

## Constraints and facts (verified 2026-11-23)

**Device / connection**
- Car Thing enumerates on this laptop (Arch, Omarchy/Hyprland) as
  `1b8e:c003 Amlogic GX-CHIP` in burn mode on the same USB-A cable/port used
  for the Android work. Avoid hubs for flashing.
- Firmware: `bishopdynamics/superbird-debian-kiosk` v2.0
  (`debian_bullseye_arm64_v2.0.0-94c2e46_landscape_2025-09-29.tar.gz`),
  flashed with superbird-tool (`--restore_device <folder>`), needs root.
- The kiosk README says a Raspberry Pi Zero 2 W is the only supported host;
  that's enforced by the *host* setup scripts (`prep_host.sh`), not the
  device image. The device brings up USB RNDIS as `192.168.7.2` with default
  route via `192.168.7.1`. **The laptop plays the host role**: give the
  RNDIS interface `192.168.7.1/24` persistently (whatever network manager
  Omarchy uses). No NAT/internet for the device is required.
- Device access: SSH `superbird@192.168.7.2` (password `superbird` — change
  it or switch to key auth). Chromium URL is set via the on-device config
  (`config_schema.py` key `url`; also via its WebUI).
- Buttons are read on-device from `/dev/input/event0` (buttons) and
  `/dev/input/event1` (knob, `EV_REL` code 6) by the kiosk's `mod_buttons.py`,
  which sends them to Home Assistant — **not** to Chromium. Key names it
  uses: `1 2 3 4 m ENTER ESC LEFT RIGHT` (`m` = top mic button, `ENTER` =
  knob press, `ESC` = back).

**Claude Code data (all local, read-only)**
- Live sessions: `~/.claude/sessions/<pid>.json` — `pid`, `sessionId`,
  `cwd`, `name`, `status` (seen: `busy`, `shell`), `updatedAt`. Files can be
  stale; confirm the pid is alive.
- Transcript: `~/.claude/projects/<cwd with / → ->/<sessionId>.jsonl`.
  Assistant lines carry `message.model` and `message.usage`; context used =
  `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` of
  the latest main-chain (`isSidechain: false`) assistant message.
- Agents: `<project dir>/<sessionId>/subagents/agent-*.meta.json` has
  `agentType`, `description`, `toolUseId`, `requestShape` (e.g.
  `background`), `finished`. Running = `finished: false`. The paired
  `agent-*.jsonl` gives the agent's own usage/last activity.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | superbird-debian-kiosk on device + small dashboard server on the laptop serving one 800×480 page | Fewest moving parts, fully owned; device is single-purpose |
| B | DeskThing (Electron desktop app + its client firmware), dashboard as a DeskThing app | App ecosystem and built-in button mapping, but desktop app must run and we follow its app format |
| — | Nocturne | Dropped: it's a Spotify-player replacement |

Vinh picked A.

## Calls made by Claude (Vinh to check)

- Node with no dependencies; SSE for live updates.
- Button forwarder on device → laptop → page (one place for navigation).
- Preset 3 = most recently active; mic button = screen dim.
- 10-minute threshold from YOUR TURN to IDLE.
- Server bound to localhost + USB link only.

## Design

```
 laptop (192.168.7.1)                               Car Thing (192.168.7.2)
 ┌───────────────────────────────┐   USB RNDIS   ┌─────────────────────────┐
 │ claude-thing server           │◀────────────▶│ Chromium kiosk → page   │
 │  - watches ~/.claude/sessions │  HTTP + SSE   │ button-forwarder (new)  │
 │  - tails transcripts/subagents│◀──────────────│  evdev → POST /input    │
 │  - serves page, SSE state     │               └─────────────────────────┘
 │  - runs desktop actions       │
 └───────────────────────────────┘
```

**Server (laptop)** — my call: Node, no dependencies, run as an enabled
`systemd --user` service with user lingering on (`loginctl enable-linger`)
so it starts at boot, before login. Restart on failure. Because it may start
before Hyprland exists, the focus action looks up the Hyprland instance
socket under `$XDG_RUNTIME_DIR/hypr/` at the time of the press, not at
startup. It must also start cleanly when the USB link (`192.168.7.1`) isn't
up yet: bind to localhost immediately and attach to the USB address when the
interface appears (or bind `0.0.0.0` and firewall to lo + the RNDIS iface —
builder's call, but LAN must not reach it).
- Binds to `192.168.7.1` and `127.0.0.1` only.
- Builds a state snapshot: list of live sessions with the fields above.
  Reads transcripts incrementally (remember byte offset; on first sight
  read only the tail) to stay cheap.
- Pushes state to the page over Server-Sent Events; `GET /` serves the page.
- `POST /input {key}` receives button events from the device and rebroadcasts
  them to the page over SSE (so navigation logic lives in one place: the page).
- `POST /action/focus {sessionId}` focuses that session's terminal window in
  Hyprland (walk the session pid's parents to the terminal window, then
  `hyprctl dispatch focuswindow pid:<pid>`).

**Button forwarder (device)** — small Python (stdlib) systemd service on the
Car Thing that reads event0/event1 and POSTs key names to
`http://192.168.7.1:<port>/input`. Disable the kiosk's Home Assistant button
handling so it doesn't log errors / act on presses. Touch also works on the
page as a fallback.

**Page (device)** — single HTML file, plain JS/CSS, dark theme, large type
readable from arm's length, 800×480 landscape.

Home list (knob position 0):
```
┌──────────────────────────────────────────────┐
│ CLAUDE · 3 sessions                   13:21  │
│ ● tempovelo        61%   ⟳2        $4.12     │
│ ● claude-thing     34%   ⟳1        $1.08     │
│ ○ jiffer           12%             $0.31     │
└──────────────────────────────────────────────┘
```

Session screen (positions 1..N):
```
┌──────────────────────────────────────────────┐
│ ● tempovelo                            2 / 3 │
│   ops-automation-approve-gated-agents        │
│ WORKING · opus 5.5 · $4.12    last 12s ago   │
│ context ████████████░░░░░░  61%  122k/200k   │
│ ─ agents (2 running) ─────────────────────── │
│  ⟳ Explore: find auth middleware      0:42   │
│  ⟳ code-reviewer: review diff         2:10   │
└──────────────────────────────────────────────┘
```
Detail screen (knob press): full agent list incl. each agent's own context
and last activity, plus the session's last few tool calls.

Empty state: "No Claude sessions running" with clock.
Server-unreachable state: clear "laptop disconnected" message, auto-retry.

**Controls** (my proposal; Vinh didn't object, may revise after screenshots)

| Input | Action |
|---|---|
| Knob turn | previous / next position (home list, then sessions) |
| Knob press | open detail view |
| Back | detail → session screen; session screen → home list |
| 1 | jump to next session in YOUR TURN |
| 2 | jump to busiest session (most running agents) |
| 3 | jump to most recently active session |
| 4 | focus this session's terminal on the desktop |
| Mic button | toggle screen dim |

## Order of work

1. Build server + page against real `~/.claude` data; render 800×480
   screenshots in a desktop browser; **Vinh approves the look** (per his
   CLAUDE.md) before anything touches the device.
2. Flash kiosk firmware; set up the laptop side of the USB network.
3. Point Chromium at the server; install the button forwarder; verify every
   input on real hardware.

## Left to the builder

- Context window per model (200k default; 1M variants) — find the right
  source or a small lookup table.
- Exact mapping of `sessions/*.json` `status` values (seen: `busy`,
  `shell`) to WORKING / YOUR TURN / IDLE; time-since-turn-end comes from
  `statusUpdatedAt` or the last transcript timestamp.
- Exact port, file layout, and network-manager config for the RNDIS link.
- Per-model price table source (pull current prices; keep it in one
  editable file).
- Ordering of sessions on the knob (proposal: by project, stable order so
  the knob feels predictable).
