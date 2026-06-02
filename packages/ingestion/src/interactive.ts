import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import type { Account } from '@kesef/core';
import { mapScrapeResult, type ScrapeResult } from './map.js';

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

/** Replace auto-fill/auto-submit with "do nothing" so the human logs in by hand. Preserves everything else. */
export function patchForManualLogin(scraper: PatchableScraper): void {
  const original = scraper.getLoginOptions.bind(scraper);
  scraper.getLoginOptions = (credentials: unknown) => {
    const opts = original(credentials);
    return {
      ...opts,
      fields: [], // do not type anything — the user fills the form
      submitButtonSelector: async () => {
        /* no-op: the user clicks the bank's own login button; the library's
           postAction / possibleResults then waits for and detects success */
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
  const scraper = factory({
    companyId: target.companyId,
    startDate,
    combineInstallments: false,
    timeout,
    defaultTimeout: timeout,
    showBrowser: true, // must be visible — the user logs in here
    verbose: deps.verbose ?? false,
    storeFailureScreenShotPath: deps.failureScreenshotPath,
  });
  patchForManualLogin(scraper as unknown as PatchableScraper);
  // credentials must be a truthy object (login() guards on it) but are never used — fields is [].
  const result = await scraper.scrape({ username: '', password: '' } as never) as ScrapeResult & {
    errorType?: string; errorMessage?: string;
  };
  if (!result.success) return { ok: false, errorType: result.errorType, errorMessage: result.errorMessage };
  return { ok: true, data: mapScrapeResult(result, { institution: target.institution, accountType: target.accountType, now: deps.now }) };
}
