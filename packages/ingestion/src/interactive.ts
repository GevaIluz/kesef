import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Account } from '@kesef/core';
import { mapScrapeResult, type ScrapeResult } from './map.js';

/** Prefer the user's already-installed, signed Chrome over puppeteer's bundled "Chrome for Testing".
 *  Some Macs (e.g. with endpoint security) quarantine or strip the unsigned test build, so it fails to
 *  launch ("Framework … no such file"). The real Chrome sidesteps that. Override with KESEF_CHROME. */
function systemChromePath(): string | undefined {
  const candidates = [
    process.env.KESEF_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter((p): p is string => !!p);
  return candidates.find(p => { try { return existsSync(p); } catch { return false; } });
}

/**
 * Interactive (manual) login: the scraper opens the bank's real login page in a visible browser and
 * the USER logs in themselves — no credentials are stored or typed in the terminal. We achieve this by
 * overriding the scraper's `getLoginOptions` so it fills nothing and clicks nothing; the library's own
 * post-login wait + URL-pattern check then detect when the user has logged in and proceed to scrape.
 */
export interface InteractiveTarget {
  companyId: CompanyTypes;
  institution: Account['institution'];
  accountType: Account['type'];
}
export interface InteractiveDeps {
  scraperFactory?: typeof createScraper;
  startDate?: Date;
  now: string;
  timeoutMs?: number; // how long the user has to log in manually (default 3 min)
  verbose?: boolean;
  failureScreenshotPath?: string;
  loginUrl?: string;  // override the library's login page — e.g. the bank's QR / app-login entry
}
export interface InteractiveOutcome {
  ok: boolean;
  errorType?: string;
  errorMessage?: string;
  data?: ReturnType<typeof mapScrapeResult>;
}

// Minimal shape of what we override; the real scraper instance has getLoginOptions at runtime
// (it lives on BaseScraperWithBrowser) even though the public Scraper type doesn't expose it.
interface PatchableScraper {
  getLoginOptions: (credentials: unknown) => Record<string, unknown>;
}

/**
 * Replace auto-fill/auto-submit with "do nothing" so the human logs in by hand — by password OR by
 * scanning the bank's QR / approving in the phone app, whichever the login page offers. Preserves
 * everything else (postAction + possibleResults still detect success by URL). An optional loginUrl
 * override opens the bank's app-login page instead of the library's default password page.
 */
export function patchForManualLogin(scraper: PatchableScraper, loginUrl?: string): void {
  const original = scraper.getLoginOptions.bind(scraper);
  scraper.getLoginOptions = (credentials: unknown) => {
    const opts = original(credentials);
    return {
      ...opts,
      ...(loginUrl ? { loginUrl } : {}),
      fields: [], // do not type anything — the user fills the form (or scans the QR / approves in the app)
      submitButtonSelector: async () => {
        /* no-op: the user logs in the bank's own way; the library's postAction /
           possibleResults then waits for and detects success by URL */
      },
    };
  };
}

export async function scrapeInteractive(target: InteractiveTarget, deps: InteractiveDeps): Promise<InteractiveOutcome> {
  const factory = deps.scraperFactory ?? createScraper;
  // Pull ~12 months of history by default (banks cap how far back they expose; we fetch what's available).
  const historyDays = Number(process.env.KESEF_HISTORY_DAYS) || 365;
  const startDate = deps.startDate ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * historyDays);
  const timeout = deps.timeoutMs ?? 180000; // 3 minutes for the human to log in
  const chrome = systemChromePath();
  const scraper = factory({
    companyId: target.companyId,
    startDate,
    combineInstallments: false,
    timeout,
    defaultTimeout: timeout,
    showBrowser: true, // must be visible — the user logs in here
    verbose: deps.verbose ?? false,
    storeFailureScreenShotPath: deps.failureScreenshotPath,
    ...(chrome ? { executablePath: chrome } : {}), // use the real signed Chrome when present
  });
  patchForManualLogin(scraper as unknown as PatchableScraper, deps.loginUrl);
  // credentials must be a truthy object (login() guards on it) but are never used — fields is [].
  const result = await scraper.scrape({ username: '', password: '' } as never) as ScrapeResult & {
    errorType?: string; errorMessage?: string;
  };
  if (!result.success) return { ok: false, errorType: result.errorType, errorMessage: result.errorMessage };
  return { ok: true, data: mapScrapeResult(result, { institution: target.institution, accountType: target.accountType, now: deps.now }) };
}
