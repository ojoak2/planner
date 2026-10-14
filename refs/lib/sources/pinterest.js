import { fetchText, browserHtml } from '../http.js';
import { decodeJsString, walk, tryJson, dedupe } from '../util.js';

export const id = 'pinterest';
export const label = 'Pinterest';

const apiUrl = (q) => {
  const data = { options: { query: q, scope: 'pins', page_size: 25, rs: 'typed' }, context: {} };
  return (
    'https://www.pinterest.com/resource/BaseSearchResource/get/' +
    `?source_url=${encodeURIComponent(`/search/pins/?q=${encodeURIComponent(q)}`)}` +
    `&data=${encodeURIComponent(JSON.stringify(data))}`
  );
};
const pageUrl = (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`;

function itemFromPin(pin) {
  const imgs = pin.images;
  const orig = imgs.orig || imgs['736x'] || imgs['474x'];
  if (!orig?.url) return null;
  return {
    url: orig.url,
    thumb: (imgs['474x'] || imgs['236x'] || orig).url,
    width: orig.width,
    height: orig.height,
    page: pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : null,
    title: (pin.grid_title || pin.title || pin.description || '').trim(),
  };
}

export function parsePinterestJson(json) {
  const items = [];
  walk(json, (o) => {
    if (o.images && typeof o.images === 'object' && !Array.isArray(o.images) && (o.images.orig || o.images['474x'])) {
      // skip boards/users' cover images: real pins carry an id and usually a type
      if (o.type && o.type !== 'pin') return;
      const it = itemFromPin(o);
      if (it) items.push(it);
    }
  });
  return dedupe(items);
}

export function parsePinterestHtml(html) {
  for (const m of html.matchAll(/<script[^>]+id="(?:__PWS_INITIAL_PROPS__|__PWS_DATA__)"[^>]*>([\s\S]*?)<\/script>/g)) {
    const json = tryJson(m[1]);
    if (json) {
      const items = parsePinterestJson(json);
      if (items.length) return items;
    }
  }
  // Fallback: any pinimg URL on the page, upgraded to the original size.
  const items = [];
  for (const m of html.matchAll(/https?:(?:\\\/|\/){2}i\.pinimg\.com(?:\\\/|\/)(\d+x|originals)(?:\\\/|\/)([0-9a-f\\\/]+\.(?:jpe?g|png|webp|gif))/gi)) {
    const rest = decodeJsString(m[2]);
    items.push({
      url: `https://i.pinimg.com/originals/${rest}`,
      thumb: `https://i.pinimg.com/474x/${rest}`,
      page: null,
      title: '',
    });
  }
  return dedupe(items);
}

export async function search(query, limit) {
  const notes = [];
  try {
    const res = await fetchText(apiUrl(query), {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Pinterest-AppState': 'active',
        'X-Pinterest-PWS-Handler': 'www/search/[scope].js',
        'X-Pinterest-Source-Url': `/search/pins/?q=${encodeURIComponent(query)}`,
        Referer: 'https://www.pinterest.com/',
      },
    });
    const json = tryJson(res.text);
    const results = json?.resource_response?.data?.results ?? json?.resource_response?.data;
    if (results) {
      const items = parsePinterestJson(results);
      if (items.length) return { items: items.slice(0, limit) };
    } else notes.push(`API ответил ${res.status}`);
  } catch (e) {
    notes.push(e.message);
  }

  for (const get of [() => fetchText(pageUrl(query)), () => browserHtml(pageUrl(query))]) {
    try {
      const res = await get();
      if (!res) continue;
      const items = parsePinterestHtml(res.text);
      if (items.length) return { items: items.slice(0, limit) };
    } catch (e) {
      notes.push(e.message);
    }
  }
  return { items: [], error: [...new Set(notes)].join('; ') || 'ничего не найдено' };
}
