import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'claude-thing-test-'));
}

export function assistantLine({ id, model = 'claude-opus-5-5', usage, sidechain = false, ts = '2026-11-23T20:00:00.000Z', content = [] }) {
  return JSON.stringify({
    type: 'assistant', isSidechain: sidechain, timestamp: ts,
    message: { id, model, role: 'assistant', content, usage },
  }) + '\n';
}

export function usage(input, cacheRead, cacheWrite, output, oneHour = 0) {
  return {
    input_tokens: input, cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite, output_tokens: output,
    cache_creation: { ephemeral_5m_input_tokens: cacheWrite - oneHour, ephemeral_1h_input_tokens: oneHour },
  };
}
