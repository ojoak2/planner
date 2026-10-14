import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collect, MAX_REFS, SOURCES } from './lib/collect.js';
import { fetchImage, extFor } from './lib/image.js';
import { makeZip } from './lib/zip.js';
import { hasBrowser } from './lib/http.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, max = 1e6) {
  let size = 0;
  const parts = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new Error('body too large');
    parts.push(c);
  }
  return Buffer.concat(parts).toString('utf8');
}

const safeName = (s) =>
  (s || 'refs').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'refs';

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/config') {
    return sendJson(res, 200, {
      max: MAX_REFS,
      browser: await hasBrowser(),
      sources: Object.values(SOURCES).map((s) => ({ id: s.id, label: s.label })),
    });
  }

  if (url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return sendJson(res, 400, { error: 'Пустой запрос' });
    if (q.length > 200) return sendJson(res, 400, { error: 'Слишком длинный запрос' });
    const sources = (url.searchParams.get('sources') || Object.keys(SOURCES).join(',')).split(',').filter(Boolean);
    try {
      const started = Date.now();
      const result = await collect(q, { sources, limit: url.searchParams.get('limit') });
      console.log(`[search] "${q}" → ${result.items.length} шт. за ${Date.now() - started} мс`,
        Object.entries(result.stats).map(([k, v]) => `${k}:${v.found}${v.error ? '(' + v.error + ')' : ''}`).join(' '));
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/image') {
    const target = url.searchParams.get('url');
    if (!target) return sendJson(res, 400, { error: 'no url' });
    try {
      const { data, type } = await fetchImage(target);
      const headers = { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' };
      const dl = url.searchParams.get('download');
      if (dl !== null) {
        const name = `${safeName(dl)}.${extFor(type, target)}`;
        headers['Content-Disposition'] = `attachment; filename="ref.${extFor(type, target)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
      }
      res.writeHead(200, headers);
      return res.end(data);
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  if (url.pathname === '/api/zip' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'bad json' });
    }
    const list = Array.isArray(body.items) ? body.items.slice(0, MAX_REFS) : [];
    if (!list.length) return sendJson(res, 400, { error: 'Нет картинок' });
    const base = safeName(body.query);
    const files = [];
    const links = [];
    await Promise.all(
      list.map(async (it, i) => {
        const n = String(i + 1).padStart(2, '0');
        for (const candidate of [it.url, it.thumb].filter(Boolean)) {
          try {
            const { data, type } = await fetchImage(candidate);
            files[i] = { name: `${base}/${n}_${it.source || 'ref'}.${extFor(type, candidate)}`, data };
            break;
          } catch { /* try next candidate */ }
        }
        links[i] = `${n}\t${it.source || ''}\t${it.url}${it.page ? '\t' + it.page : ''}`;
      })
    );
    const ok = files.filter(Boolean);
    if (!ok.length) return sendJson(res, 502, { error: 'Не удалось скачать ни одной картинки' });
    ok.push({ name: `${base}/sources.txt`, data: Buffer.from(links.join('\n') + '\n', 'utf8') });
    const zip = makeZip(ok);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': zip.length,
      'Content-Disposition': `attachment; filename="refs.zip"; filename*=UTF-8''${encodeURIComponent(base + '.zip')}`,
    });
    return res.end(zip);
  }

  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      return res.end(data);
    } catch {
      /* fall through */
    }
  }
  sendJson(res, 404, { error: 'not found' });
}

http
  .createServer((req, res) =>
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    })
  )
  .listen(PORT, HOST, () => console.log(`Референсы: http://${HOST}:${PORT}`));
