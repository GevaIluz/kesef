import puppeteer from 'puppeteer';

/**
 * Interactive IBI reader. There is NO scraper library for Israeli investment houses, so we drive
 * a real browser: kesef opens IBI's portal, YOU log in yourself (no credentials are ever stored),
 * open the screen that shows your portfolio total, and press Enter. We then read the numbers off
 * that page and propose the most likely "total" for you to confirm. Everything stays on your machine.
 */

/** Parse an Israeli-formatted money string (₪ / ש"ח, comma thousands, dot decimal) → number | null. */
export function parseShekel(s: string): number | null {
  if (!s) return null;
  const normalized = s
    .replace(/[−‒–—]/g, '-') // unicode minus / dashes → ASCII '-'
    .replace(/[^\d.,\-]/g, '')                    // drop ₪, ש"ח, spaces, letters
    .replace(/,/g, '');                           // comma = thousands separator
  if (!/\d/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export interface TotalCandidate { value: number; text: string; context: string; }

// Words that, when near a number, suggest it's the portfolio total (he + en).
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

export interface IbiScrapeDeps {
  url: string;
  /** Resolves when the user signals (e.g. presses Enter) that the portfolio total is on screen. */
  waitForUser: () => Promise<unknown>;
  navTimeoutMs?: number;
  headless?: boolean;
}

export interface IbiScrapeResult { candidates: TotalCandidate[]; best: TotalCandidate | null; }

/** Open IBI, wait for the user to log in + navigate, then read currency figures off the page. */
export async function scrapeIbiInteractive(deps: IbiScrapeDeps): Promise<IbiScrapeResult> {
  const browser = await puppeteer.launch({
    headless: deps.headless ?? false,
    defaultViewport: null,
    args: ['--start-maximized'],
  });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? await browser.newPage();
    await page.goto(deps.url, { waitUntil: 'domcontentloaded', timeout: deps.navTimeoutMs ?? 60_000 });

    await deps.waitForUser(); // human logs in + opens the portfolio screen, then continues

    // Collect leaf elements whose visible text looks like money, plus nearby label text for context.
    const raw = await page.evaluate(() => {
      const results: { text: string; context: string }[] = [];
      const moneyish = /[₪]|ש"ח|\d{1,3}(,\d{3})+(\.\d+)?|\d+\.\d{2}\b/;
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (el.children.length) continue;                 // leaf nodes only
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 40) continue;
        if (text.includes('%')) continue;                 // skip percentages / yields
        if (!moneyish.test(text)) continue;
        const parent = el.parentElement;
        const context = [
          el.getAttribute('aria-label') || '',
          el.previousElementSibling?.textContent || '',
          parent?.getAttribute('aria-label') || '',
          parent?.textContent || '',
        ].join(' | ').replace(/\s+/g, ' ').trim().slice(0, 140);
        results.push({ text, context });
      }
      return results;
    });

    // Parse + rank in Node (so parseShekel/pickTotal stay unit-testable).
    const seen = new Set<string>();
    const candidates: TotalCandidate[] = [];
    for (const r of raw) {
      const value = parseShekel(r.text);
      if (value === null) continue;
      const key = `${value}|${r.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ value, text: r.text, context: r.context });
    }
    candidates.sort((a, b) => b.value - a.value);
    return { candidates, best: pickTotal(candidates) };
  } finally {
    await browser.close();
  }
}
