import { fetchText, browserHtml } from '../http.js';
import { decodeHtmlEntities, absUrl, looksLikeImage, walk, tryJson, dedupe } from '../util.js';

export const id = 'yandex';
export const label = 'Яндекс Картинки';

const searchUrl = (q) => `https://yandex.ru/images/search?text=${encodeURIComponent(q)}`;
const jsonUrl = (q) =>
  `https://yandex.ru/images/search?format=json&request=${encodeURIComponent(
    JSON.stringify({ blocks: [{ block: 'serp-list_infinite_yes', params: {}, version: 2 }] })
  )}&text=${encodeURIComponent(q)}`;

function itemFrom(obj) {
  // New layout: { origUrl, image, snippet: { url, title }, width, height, ... }
  // Old layout (data-bem serp-item): { img_href, thumb: { url }, snippet: { url, title }, preview: [...] }
  const url = absUrl(obj.origUrl || obj.img_href || obj.origin?.url);
  if (!looksLikeImage(url)) return null;
  const thumb =
    absUrl(obj.image) ||
    absUrl(obj.thumb?.url) ||
    absUrl(typeof obj.thumb === 'string' ? obj.thumb : null) ||
    absUrl(obj.preview?.[0]?.url) ||
    url;
  return {
    url,
    thumb,
    page: absUrl(obj.snippet?.url) || absUrl(obj.url !== obj.origUrl ? obj.url : null) || null,
    title: obj.snippet?.title || obj.alt || '',
    width: Number(obj.origWidth || obj.width || obj.origin?.w) || undefined,
    height: Number(obj.origHeight || obj.height || obj.origin?.h) || undefined,
  };
}

function collect(json, out) {
  walk(json, (o) => {
    if (o.origUrl || o.img_href) {
      const it = itemFrom(o);
      if (it) out.push(it);
    }
  });
}

export function parseYandex(html) {
  const items = [];
  // JSON hidden in data-state / data-bem attributes.
  for (const m of html.matchAll(/data-(?:state|bem)=(?:"([^"]*)"|'([^']*)')/g)) {
    const raw = decodeHtmlEntities(m[1] ?? m[2]);
    if (!/origUrl|img_href/.test(raw)) continue;
    const json = tryJson(raw);
    if (json) collect(json, items);
  }
  // Fallback: plain regex over the (entity-decoded) page.
  if (!items.length) {
    const text = decodeHtmlEntities(html);
    for (const m of text.matchAll(/"(?:origUrl|img_href)":"(https?:[^"]+)"/g)) {
      const url = m[1].replace(/\\\//g, '/');
      if (looksLikeImage(url)) items.push({ url, thumb: url, page: null, title: '' });
    }
  }
  return dedupe(items);
}

export function parseYandexJson(text) {
  const json = tryJson(text);
  if (!json) return [];
  const htmlParts = [];
  walk(json, (o) => {
    if (typeof o.html === 'string') htmlParts.push(o.html);
  });
  const items = htmlParts.flatMap(parseYandex);
  collect(json, items);
  return dedupe(items);
}

const isCaptcha = (res) => /showcaptcha|captcha/i.test(res.url) || /SmartCaptcha|checkbox-captcha/i.test(res.text.slice(0, 30000));

export async function search(query, limit) {
  const notes = [];
  const attempts = [
    async () => {
      const res = await fetchText(searchUrl(query));
      if (isCaptcha(res)) throw new Error('Яндекс показал капчу');
      return parseYandex(res.text);
    },
    async () => {
      const res = await fetchText(jsonUrl(query), { headers: { Accept: 'application/json' } });
      if (isCaptcha(res)) throw new Error('Яндекс показал капчу (json)');
      return parseYandexJson(res.text);
    },
    async () => {
      const res = await browserHtml(searchUrl(query));
      if (!res) return [];
      if (isCaptcha(res)) throw new Error('Яндекс показал капчу (браузер)');
      return parseYandex(res.text);
    },
  ];
  for (const attempt of attempts) {
    try {
      const items = await attempt();
      if (items.length) return { items: items.slice(0, limit) };
    } catch (e) {
      notes.push(e.message);
    }
  }
  return { items: [], error: [...new Set(notes)].join('; ') || 'ничего не найдено' };
}
