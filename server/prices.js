// USD per million tokens. Source: claude-api skill (cached 2026-11-03), read 2026-11-23.
// cacheWrite = 5-minute TTL write, cacheWrite1h = 1-hour TTL write.
// Haiku 5.5 uses its <=100K-prompt rate card.
export const PRICES = {
  'claude-fable-5-2':  { input: 8,    output: 40,   cacheWrite: 10,    cacheWrite1h: 16,  cacheRead: 0.20 },
  'claude-mythos-5-2': { input: 8,    output: 40,   cacheWrite: 10,    cacheWrite1h: 16,  cacheRead: 0.20 },
  'claude-fable-5-1':  { input: 10,   output: 50,   cacheWrite: 12.5,  cacheWrite1h: 20,  cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10,   output: 50,   cacheWrite: 12.5,  cacheWrite1h: 20,  cacheRead: 0.25 },
  'claude-fable-5':    { input: 10,   output: 50,   cacheWrite: 12.5,  cacheWrite1h: 20,  cacheRead: 1 },
  'claude-mythos-5':   { input: 10,   output: 50,   cacheWrite: 12.5,  cacheWrite1h: 20,  cacheRead: 1 },
  'claude-opus-5-5':   { input: 4,    output: 20,   cacheWrite: 5,     cacheWrite1h: 8,   cacheRead: 0.20 },
  'claude-opus-5':     { input: 5,    output: 25,   cacheWrite: 6.25,  cacheWrite1h: 10,  cacheRead: 0.50 },
  'claude-opus-4':     { input: 5,    output: 25,   cacheWrite: 6.25,  cacheWrite1h: 10,  cacheRead: 0.50 },
  'claude-sonnet-5-5': { input: 2,    output: 10,   cacheWrite: 2.5,   cacheWrite1h: 4,   cacheRead: 0.10 },
  'claude-sonnet-5':   { input: 2,    output: 10,   cacheWrite: 2.5,   cacheWrite1h: 4,   cacheRead: 0.20 },
  'claude-sonnet-4':   { input: 3,    output: 15,   cacheWrite: 3.75,  cacheWrite1h: 6,   cacheRead: 0.30 },
  'claude-haiku-5-5':  { input: 0.10, output: 0.50, cacheWrite: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01 },
  'claude-haiku-4':    { input: 1,    output: 5,    cacheWrite: 1.25,  cacheWrite1h: 2,   cacheRead: 0.10 },
};

const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);
const MOST_EXPENSIVE = Object.values(PRICES).reduce((a, b) => (b.output > a.output ? b : a));

export function priceFor(model) {
  const key = KEYS.find((k) => model?.startsWith(k));
  return key ? PRICES[key] : MOST_EXPENSIVE;
}

export function estimateCostUsd(tokensByModel) {
  let usd = 0;
  for (const [model, t] of Object.entries(tokensByModel)) {
    const p = priceFor(model);
    usd += (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead +
      t.cacheWrite * p.cacheWrite + t.cacheWrite1h * p.cacheWrite1h) / 1e6;
  }
  return usd;
}
