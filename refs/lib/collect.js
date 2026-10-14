import * as pinterest from './sources/pinterest.js';
import * as google from './sources/google.js';
import * as yandex from './sources/yandex.js';

export const MAX_REFS = 20;
export const SOURCES = { pinterest, google, yandex };

const withTimeout = (p, ms, msg) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

// Queries every selected source in parallel, then interleaves the results
// round-robin so the final set (≤ MAX_REFS) mixes all sources evenly.
// If one source returns fewer images, the others fill the remaining slots.
export async function collect(query, { sources = Object.keys(SOURCES), limit = MAX_REFS } = {}) {
  limit = Math.max(1, Math.min(MAX_REFS, Number(limit) || MAX_REFS));
  const ids = [...new Set(sources)].filter((s) => SOURCES[s]);
  if (!ids.length) throw new Error('Не выбран ни один источник');

  const results = await Promise.all(
    ids.map(async (sid) => {
      try {
        const r = await withTimeout(SOURCES[sid].search(query, limit), 45000, 'таймаут');
        return { id: sid, ...r };
      } catch (e) {
        return { id: sid, items: [], error: e.message };
      }
    })
  );

  const queues = results.map((r) => r.items.map((it) => ({ ...it, source: r.id })));
  const seen = new Set();
  const items = [];
  while (items.length < limit && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (items.length >= limit) break;
      while (q.length) {
        const it = q.shift();
        if (seen.has(it.url)) continue;
        seen.add(it.url);
        items.push(it);
        break;
      }
    }
  }

  const stats = Object.fromEntries(
    results.map((r) => [
      r.id,
      {
        label: SOURCES[r.id].label,
        found: r.items.length,
        used: items.filter((i) => i.source === r.id).length,
        error: r.items.length ? undefined : r.error,
        warning: r.warning,
      },
    ])
  );
  return { query, limit, items, stats };
}
