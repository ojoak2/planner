import { fetchText, browserHtml } from '../http.js';
import { decodeJsString, decodeHtmlEntities, looksLikeImage, dedupe } from '../util.js';

export const id = 'google';
export const label = 'Google Картинки';

const COOKIE = 'CONSENT=YES+cb; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg';

const searchUrl = (q, basic = false) =>
  `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=isch&hl=ru` + (basic ? '&gbv=1' : '&udm=2');

const isThumbHost = (u) => /gstatic\.com|googleusercontent\.com\/.*=s\d/.test(u);

// Full results page: image data sits in inline scripts as
//   ["<thumb>",h,w],["<original>",h,w] ... "2003":[null,"<id>","<page url>","<title>"
export function parseGoogle(html) {
  const items = [];
  const pair = /\["(https?:\/\/[^"]+?)",(\d+),(\d+)\]\s*,\s*\["(https?:\/\/[^"]+?)",(\d+),(\d+)\]/g;
  let m;
  while ((m = pair.exec(html))) {
    const thumb = decodeJsString(m[1]);
    const url = decodeJsString(m[4]);
    if (!isThumbHost(thumb) || isThumbHost(url) || !looksLikeImage(url)) continue;
    const tail = html.slice(pair.lastIndex, pair.lastIndex + 4000);
    const meta = /"2003":\[null,"[^"]*","(https?:\/\/[^"]+)","([^"]*)"/.exec(tail);
    items.push({
      url,
      thumb,
      width: Number(m[6]),
      height: Number(m[5]),
      page: meta ? decodeJsString(meta[1]) : null,
      title: meta ? decodeJsString(meta[2]) : '',
    });
  }
  return dedupe(items);
}

// Basic (gbv=1) page: only thumbnails, each wrapped in a /url?q=<page> link.
export function parseGoogleBasic(html) {
  const items = [];
  const re = /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>(?:(?!<\/a>)[\s\S])*?<img[^>]+src="(https:\/\/encrypted-tbn[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const thumb = decodeHtmlEntities(m[2]);
    items.push({ url: thumb, thumb, page: decodeURIComponent(decodeHtmlEntities(m[1])), title: '', thumbOnly: true });
  }
  if (!items.length) {
    for (const t of html.matchAll(/<img[^>]+src="(https:\/\/encrypted-tbn[^"]+)"/g)) {
      const thumb = decodeHtmlEntities(t[1]);
      items.push({ url: thumb, thumb, page: null, title: '', thumbOnly: true });
    }
  }
  return dedupe(items);
}

function blocked(res) {
  return /\/sorry\//.test(res.url) || /unusual traffic|captcha/i.test(res.text.slice(0, 20000));
}

export async function search(query, limit) {
  const notes = [];
  try {
    const res = await fetchText(searchUrl(query), { headers: { Cookie: COOKIE } });
    if (blocked(res)) notes.push('Google показал капчу');
    else {
      const items = parseGoogle(res.text);
      if (items.length) return { items: items.slice(0, limit) };
    }
  } catch (e) {
    notes.push(e.message);
  }

  try {
    const res = await browserHtml(searchUrl(query));
    if (res) {
      const items = parseGoogle(res.text);
      if (items.length) return { items: items.slice(0, limit) };
    }
  } catch (e) {
    notes.push('браузер: ' + e.message);
  }

  try {
    const res = await fetchText(searchUrl(query, true), {
      headers: { Cookie: COOKIE, 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:40.0) Gecko/20100101 Firefox/40.0' },
    });
    const items = parseGoogleBasic(res.text);
    if (items.length) return { items: items.slice(0, limit), warning: 'только превью (упрощённая выдача Google)' };
  } catch (e) {
    notes.push(e.message);
  }
  return { items: [], error: [...new Set(notes)].join('; ') || 'ничего не найдено' };
}
