import os from 'node:os';
import path from 'node:path';

export const CLAUDE_DIR = process.env.CLAUDE_DIR ?? path.join(os.homedir(), '.claude');
export const PORT = Number(process.env.PORT ?? 7777);
export const USB_ADDR = '192.168.7.1';
export const YOUR_TURN_MS = 600_000;
export const AUTOJUMP_IDLE_MS = 30_000;
export const POLL_MS = 1000;
export const DEFAULT_WINDOW = 200_000;
export const LARGE_WINDOW = 1_000_000;
export const STALE_AGENT_MS = 600_000;
