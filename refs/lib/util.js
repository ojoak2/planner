// Small parsing helpers shared by the source scrapers.

export function decodeJsString(s) {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\\//g, '/');
  }
}

export function decodeHtmlEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&');
}

export function absUrl(u) {
  if (!u || typeof u !== 'string') return null;
  if (u.startsWith('//')) u = 'https:' + u;
  return /^https?:\/\//i.test(u) ? u : null;
}

export function looksLikeImage(u) {
  if (!u) return false;
  if (/\.svg(\?|$)/i.test(u)) return false;
  return /^https?:\/\//i.test(u);
}

// Depth-first walk over parsed JSON, calling fn on every plain object.
export function walk(node, fn, depth = 0) {
  if (depth > 60 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const v of node) walk(v, fn, depth + 1);
    return;
  }
  fn(node);
  for (const v of Object.values(node)) walk(v, fn, depth + 1);
}

export function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    if (!it.url || seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
}
