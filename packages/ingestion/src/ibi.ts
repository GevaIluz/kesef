import puppeteer, { type Page } from 'puppeteer';

/**
 * Interactive IBI reader. No scraper library covers Israeli investment houses, and trading
 * screens (SPARK/OrderNet) are full of market figures — so we don't guess. You log in yourself
 * (no credentials are ever stored), then CLICK your portfolio total once: kesef captures exactly
 * that value and a selector for it, so next time it can read the number automatically. Everything
 * stays on your machine.
 */

/** Parse an Israeli-formatted money string (₪ / ש"ח, comma thousands, dot decimal) → number | null. */
export function parseShekel(s: string): number | null {
  if (!s) return null;
  const normalized = s
    .replace(/[−‒–—]/g, '-')        // unicode minus / dashes → ASCII '-'
    .replace(/[^\d.,\-]/g, '')      // drop ₪, ש"ח, spaces, letters
    .replace(/,/g, '');             // comma = thousands separator
  if (!/\d/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export interface TotalCandidate { value: number; text: string; context: string; }

const TOTAL_KEYWORDS = [
  'שווי תיק', 'שווי כולל', 'שווי נכסים', 'סה"כ', 'סהכ', 'שווי', 'יתרה', 'נכסים',
  'total', 'portfolio', 'balance', 'net worth', 'holdings value',
];

/** Choose the most likely portfolio total: prefer a labelled candidate, else the largest positive. */
export function pickTotal(cands: TotalCandidate[]): TotalCandidate | null {
  const positive = cands.filter(c => c.value > 0);
  if (positive.length === 0) return null;
  const labelled = positive.filter(c =>
    TOTAL_KEYWORDS.some(k => c.context.toLowerCase().includes(k.toLowerCase())),
  );
  const pool = labelled.length ? labelled : positive;
  return pool.reduce((best, c) => (c.value > best.value ? c : best));
}

export interface IbiReadDeps {
  url: string;
  /** Resolves once the user has logged in and the portfolio screen is on display. */
  waitForLogin: () => Promise<unknown>;
  /** Tell the user to click their portfolio total in the browser (no await — the click resolves it). */
  promptClick: () => void;
  /** A selector taught on a previous run — try to read it automatically first. */
  savedSelector?: string | undefined;
  navTimeoutMs?: number;
  clickTimeoutMs?: number;
  autoTimeoutMs?: number;   // how long to poll for the saved selector (waits out login)
  headless?: boolean;
}

export interface IbiReadResult {
  value: number | null;
  selector: string | null;
  rawText: string | null;
  mode: 'auto' | 'taught' | 'none';
}

/** Open IBI; read the portfolio total automatically (saved selector) or by letting the user click it. */
export async function readIbiTotal(deps: IbiReadDeps): Promise<IbiReadResult> {
  const browser = await puppeteer.launch({
    headless: deps.headless ?? false,
    defaultViewport: null,
    args: ['--start-maximized'],
  });
  try {
    const page = (await browser.pages())[0] ?? await browser.newPage();
    // esbuild/tsx wraps named functions with a __name() helper; that helper doesn't exist in the
    // browser, so injected page functions throw "__name is not defined". Shim it on every document.
    await page.evaluateOnNewDocument(() => { (globalThis as Record<string, unknown>)['__name'] ||= ((f: unknown) => f); });
    await page.goto(deps.url, { waitUntil: 'domcontentloaded', timeout: deps.navTimeoutMs ?? 60_000 });

    await deps.waitForLogin(); // human logs in + opens the portfolio screen

    // 1) Auto: poll a previously-taught selector (waits out login / SPA render).
    if (deps.savedSelector) {
      const deadline = Date.now() + (deps.autoTimeoutMs ?? 8_000);
      while (Date.now() < deadline) {
        const txt = await page.$eval(deps.savedSelector, el => (el.textContent || '').trim()).catch(() => null);
        const v = txt ? parseShekel(txt) : null;
        if (v !== null) return { value: v, selector: deps.savedSelector, rawText: txt, mode: 'auto' };
        await new Promise(r => { setTimeout(r, 500); });
      }
      // selector never resolved (page changed / still logging in) → fall through to teach
    }

    // 2) Teach: capture the element the user clicks.
    const captured = await captureClick(page, deps.promptClick, deps.clickTimeoutMs ?? 180_000);
    if (!captured) return { value: null, selector: null, rawText: null, mode: 'none' };
    return { value: parseShekel(captured.text), selector: captured.selector, rawText: captured.text, mode: 'taught' };
  } finally {
    await browser.close();
  }
}

/** Wait for the user to click an element in the page; return its text + a best-effort CSS selector. */
async function captureClick(
  page: Page,
  promptClick: () => void,
  timeoutMs: number,
): Promise<{ text: string; selector: string } | null> {
  // Install a one-shot click listener that stashes the result on window; poll it from Node.
  await page.evaluate(() => {
    const w = window as unknown as { __kesefCaptured: { text: string; selector: string } | null };
    w.__kesefCaptured = null;
    // Banner so the user knows to click their total — right in the IBI window (no terminal).
    const banner = document.createElement('div');
    banner.id = '__kesef_banner';
    banner.textContent = '👆 kesef — click your portfolio total (the ₪ number)';
    banner.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0C7A66;color:#fff;font:600 15px system-ui,sans-serif;padding:11px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.3)');
    if (document.body) document.body.appendChild(banner);
    const selectorFor = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node.nodeType === 1 && parts.length < 6) {
        const id = (node as HTMLElement).id;
        if (id) { parts.unshift('#' + CSS.escape(id)); break; }
        let part = node.tagName.toLowerCase();
        const cls = typeof node.className === 'string'
          ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(c => '.' + CSS.escape(c)).join('')
          : '';
        if (cls) part += cls;
        const parent: Element | null = node.parentElement;
        if (parent) {
          const sibs = Array.from(parent.children).filter(c => c.tagName === node!.tagName);
          if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const handler = (e: Event) => {
      const el = e.target as Element | null;
      if (!el || (el as HTMLElement).id === '__kesef_banner') return; // ignore clicks on our banner
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      document.removeEventListener('click', handler, true);
      e.preventDefault(); e.stopPropagation();
      banner.remove();
      w.__kesefCaptured = { text, selector: selectorFor(el) };
    };
    document.addEventListener('click', handler, true);
  });

  promptClick();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const got = await page
      .evaluate(() => (window as unknown as { __kesefCaptured: { text: string; selector: string } | null }).__kesefCaptured)
      .catch(() => null);
    if (got) return got;
    await new Promise(r => { setTimeout(r, 300); });
  }
  return null;
}
