// Fetches a remote image on behalf of the browser (bypasses hotlink protection
// and lets us offer downloads). Refuses non-public addresses.
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { UA } from './http.js';

const MAX_BYTES = 25 * 1024 * 1024;

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  const addrs = await lookup(u.hostname, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('blocked host');
}

function refererFor(url) {
  const h = new URL(url).hostname;
  if (h.endsWith('pinimg.com')) return 'https://www.pinterest.com/';
  if (h.includes('yandex')) return 'https://yandex.ru/';
  if (h.includes('gstatic.com')) return 'https://www.google.com/';
  return undefined;
}

export async function fetchImage(url, { timeout = 20000 } = {}) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current);
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        ...(refererFor(current) ? { Referer: refererFor(current) } : {}),
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error('not an image');
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('too large');
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_BYTES) throw new Error('too large');
    return { data, type };
  }
  throw new Error('too many redirects');
}

export function extFor(type, url) {
  const t = type.split(';')[0].trim();
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
  if (map[t]) return map[t];
  const m = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.exec(url);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}
