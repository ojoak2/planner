// Network helpers: plain fetch with browser-like headers, plus an optional
// headless-browser fallback (used only if the `playwright` package is installed).

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
};

export async function fetchText(url, { headers = {}, timeout = 15000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { ...BASE_HEADERS, ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error('сайт не ответил вовремя');
    throw new Error(`нет соединения с ${new URL(url).hostname}${e.cause?.code ? ' (' + e.cause.code + ')' : ''}`);
  }
  return { status: res.status, url: res.url, text: await res.text() };
}

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      let pw;
      try {
        pw = await import('playwright');
      } catch {
        return null; // playwright is optional
      }
      const chromium = pw.chromium ?? pw.default?.chromium;
      return chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
    })().catch((err) => {
      console.warn('[browser] не удалось запустить Chromium:', err.message);
      return null;
    });
  }
  return browserPromise;
}

export async function hasBrowser() {
  return Boolean(await getBrowser());
}

// Opens the page in headless Chromium, scrolls a bit so lazy content loads,
// and returns the serialized DOM. Returns null when no browser is available.
export async function browserHtml(url, { scrolls = 2 } = {}) {
  const browser = await getBrowser();
  if (!browser) return null;
  const ctx = await browser.newContext({ userAgent: UA, locale: 'ru-RU', viewport: { width: 1366, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1200);
    for (let i = 0; i < scrolls; i++) {
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(800);
    }
    return { status: 200, url: page.url(), text: await page.content() };
  } finally {
    await ctx.close();
  }
}

export async function closeBrowser() {
  const b = await browserPromise;
  if (b) await b.close();
}
