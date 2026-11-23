import fs from 'node:fs/promises';
import { DEFAULT_WINDOW, LARGE_WINDOW } from './config.js';

const CHUNK = 1 << 20;

// Models whose default context window is 1M (claude-api skill model table, 2026-11-03).
const LARGE_WINDOW_MODELS = /^claude-(fable|mythos|opus-5|sonnet-5|haiku-5|opus-4-[6-9]|sonnet-4-6)/;

export function contextWindow(used, model = null) {
  if (used > DEFAULT_WINDOW) return LARGE_WINDOW;
  return model && LARGE_WINDOW_MODELS.test(model) ? LARGE_WINDOW : DEFAULT_WINDOW;
}

export function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
}

function toolSummary(input = {}) {
  const s = input.description ?? input.command ?? input.file_path ?? input.pattern ?? input.url ?? '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 60);
}

export class TranscriptTail {
  constructor(path) {
    this.path = path;
    this.reset();
  }

  reset() {
    this.offset = 0;
    this.remainder = '';
    this.seen = new Set();
    this.model = null;
    this.contextUsed = 0;
    this.tokensByModel = {};
    this.lastActivity = null;
    this.recentTools = [];
  }

  async poll() {
    let fh;
    try {
      fh = await fs.open(this.path, 'r');
    } catch {
      return;
    }
    try {
      const { size } = await fh.stat();
      if (size < this.offset) this.reset();
      const buf = Buffer.alloc(CHUNK);
      while (this.offset < size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - this.offset), this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        const text = this.remainder + buf.toString('utf8', 0, bytesRead);
        const lines = text.split('\n');
        this.remainder = lines.pop();
        for (const line of lines) this.ingest(line);
      }
    } finally {
      await fh.close();
    }
  }

  ingest(line) {
    if (!line) return;
    let e;
    try { e = JSON.parse(line); } catch { return; }
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (!Number.isNaN(ts) && (this.lastActivity === null || ts > this.lastActivity)) this.lastActivity = ts;
    if (e.type !== 'assistant' || !e.message) return;
    const m = e.message;
    for (const block of Array.isArray(m.content) ? m.content : []) {
      if (block?.type === 'tool_use') {
        this.recentTools.push({ name: block.name, summary: toolSummary(block.input), ts });
        if (this.recentTools.length > 5) this.recentTools.shift();
      }
    }
    const u = m.usage;
    if (!u) return;
    const write = u.cache_creation_input_tokens ?? 0;
    const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + write;
    if (!e.isSidechain) {
      this.contextUsed = used;
      if (m.model && m.model !== '<synthetic>') this.model = m.model;
    }
    const key = m.id ?? e.requestId ?? e.uuid;
    if (key && this.seen.has(key)) return;
    if (key) this.seen.add(key);
    const model = m.model ?? 'unknown';
    if (model === '<synthetic>') return;
    const t = (this.tokensByModel[model] ??= emptyTokens());
    t.input += u.input_tokens ?? 0;
    t.output += u.output_tokens ?? 0;
    t.cacheRead += u.cache_read_input_tokens ?? 0;
    t.cacheWrite += write - write1h;
    t.cacheWrite1h += write1h;
  }

  summary() {
    return {
      model: this.model,
      contextUsed: this.contextUsed,
      tokensByModel: this.tokensByModel,
      lastActivity: this.lastActivity,
      recentTools: [...this.recentTools],
    };
  }
}
