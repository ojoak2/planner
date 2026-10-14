import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogle, parseGoogleBasic } from '../lib/sources/google.js';
import { parseYandex, parseYandexJson } from '../lib/sources/yandex.js';
import { parsePinterestJson, parsePinterestHtml } from '../lib/sources/pinterest.js';
import { collect, SOURCES, MAX_REFS } from '../lib/collect.js';
import { makeZip, crc32 } from '../lib/zip.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('google: thumb/original pairs with page metadata', () => {
  const html = `<script>var x=[1,[0,"abc",["https://encrypted-tbn0.gstatic.com/images?q\\u003dtbn:AAA",194,259],` +
    `["https://example.com/img/kitchen.jpg?w\\u003d1200",900,1200],null,0,"rgb(1,2,3)",null,0,` +
    `{"2003":[null,"id1","https://example.com/post/kitchen","Скандинавская кухня"]}]];` +
    `[1,[0,"def",["https://encrypted-tbn0.gstatic.com/images?q\\u003dtbn:BBB",100,100],["https://cdn.site.org/a.png",500,600]]]</script>`;
  const items = parseGoogle(html);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    url: 'https://example.com/img/kitchen.jpg?w=1200',
    thumb: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:AAA',
    width: 1200, height: 900,
    page: 'https://example.com/post/kitchen', title: 'Скандинавская кухня',
  });
  assert.equal(items[1].url, 'https://cdn.site.org/a.png');
});

test('google basic: thumbnails with /url?q= links', () => {
  const html = `<a href="/url?q=https://site.com/page&amp;sa=U"><div><img class="t" src="https://encrypted-tbn0.gstatic.com/images?q=tbn:X&amp;s=1"></div></a>`;
  const [it] = parseGoogleBasic(html);
  assert.equal(it.thumb, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:X&s=1');
  assert.equal(it.page, 'https://site.com/page');
});

test('yandex: data-state JSON (new layout)', () => {
  const state = { initialState: { serpList: { items: { entities: {
    a: { origUrl: 'https://img.ru/1.jpg', image: '//avatars.mds.yandex.net/i?id=1', origWidth: 800, origHeight: 600, snippet: { url: 'https://img.ru/post', title: 'Кухня' } },
    b: { origUrl: 'https://img.ru/2.webp', image: '//avatars.mds.yandex.net/i?id=2' },
  } } } } };
  const html = `<div data-state="${JSON.stringify(state).replace(/"/g, '&quot;')}"></div>`;
  const items = parseYandex(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://img.ru/1.jpg');
  assert.equal(items[0].thumb, 'https://avatars.mds.yandex.net/i?id=1');
  assert.equal(items[0].page, 'https://img.ru/post');
  assert.equal(items[0].width, 800);
});

test('yandex: data-bem serp-item (old layout) and json format', () => {
  const bem = { 'serp-item': { img_href: 'https://x.com/a.jpg', thumb: { url: '//avatars.mds.yandex.net/i?id=9' }, snippet: { url: 'https://x.com/', title: 'T' } } };
  const html = `<div class="serp-item" data-bem='${JSON.stringify(bem)}'></div>`;
  assert.equal(parseYandex(html)[0].thumb, 'https://avatars.mds.yandex.net/i?id=9');
  const json = JSON.stringify({ blocks: [{ name: { block: 'serp-list' }, html }] });
  assert.equal(parseYandexJson(json)[0].url, 'https://x.com/a.jpg');
});

test('pinterest: API results', () => {
  const results = [
    { type: 'pin', id: '123', grid_title: 'Pin A', images: { '236x': { url: 'https://i.pinimg.com/236x/aa/a.jpg' }, '474x': { url: 'https://i.pinimg.com/474x/aa/a.jpg' }, orig: { url: 'https://i.pinimg.com/originals/aa/a.jpg', width: 1000, height: 1500 } } },
    { type: 'board', id: 'b1', images: { orig: { url: 'https://i.pinimg.com/originals/bb/board.jpg' } } },
    { type: 'pin', id: '456', images: { orig: { url: 'https://i.pinimg.com/originals/cc/c.jpg' } } },
  ];
  const items = parsePinterestJson(results);
  assert.equal(items.length, 2);
  assert.equal(items[0].page, 'https://www.pinterest.com/pin/123/');
  assert.equal(items[0].thumb, 'https://i.pinimg.com/474x/aa/a.jpg');
  assert.equal(items[0].title, 'Pin A');
});

test('pinterest: HTML fallback upgrades to originals', () => {
  const html = `<img src="https://i.pinimg.com/236x/1a/2b/3c/1a2b3c.jpg"><script>"url":"https:\\/\\/i.pinimg.com\\/736x\\/4d\\/5e.png"</script>`;
  const items = parsePinterestHtml(html);
  assert.deepEqual(items.map((i) => i.url), ['https://i.pinimg.com/originals/1a/2b/3c/1a2b3c.jpg', 'https://i.pinimg.com/originals/4d/5e.png']);
});

test('collect: never more than 20, interleaves and backfills', async () => {
  const fake = (name, n) => ({ id: name, label: name, search: async (_q, limit) => ({ items: Array.from({ length: Math.min(n, limit) }, (_, i) => ({ url: `https://${name}/${i}.jpg` })) }) });
  const orig = { ...SOURCES };
  Object.assign(SOURCES, { pinterest: fake('pinterest', 50), google: fake('google', 50), yandex: { id: 'yandex', label: 'y', search: async () => ({ items: [], error: 'капча' }) } });
  try {
    const r = await collect('test', { limit: 100 });
    assert.equal(r.items.length, MAX_REFS);
    assert.deepEqual(r.items.slice(0, 4).map((i) => i.source), ['pinterest', 'google', 'pinterest', 'google']);
    assert.equal(r.stats.yandex.error, 'капча');

    Object.assign(SOURCES, { google: fake('google', 3) });
    const r2 = await collect('test', { limit: 10, sources: ['pinterest', 'google'] });
    assert.equal(r2.items.length, 10);
    assert.equal(r2.stats.google.used, 3);
    assert.equal(r2.stats.pinterest.used, 7);
  } finally {
    Object.assign(SOURCES, orig);
  }
});

test('zip: valid archive', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const dir = mkdtempSync(path.join(tmpdir(), 'zip-'));
  const file = path.join(dir, 't.zip');
  writeFileSync(file, makeZip([{ name: 'кухня/01.txt', data: Buffer.from('hello') }, { name: 'кухня/02.txt', data: Buffer.from('world') }]));
  const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(",".join(z.namelist()), z.read(z.namelist()[1]).decode())', file]).toString();
  assert.equal(out.trim(), 'кухня/01.txt,кухня/02.txt world');
});
