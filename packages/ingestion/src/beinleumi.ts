import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { mapScrapeResult, type ScrapeResult } from './map';

// Beinleumi (v6.7.5) authenticates with username + password only — NO OTP.
export interface BeinleumiCreds { username: string; password: string; }
export interface ScrapeDeps {
  scraperFactory?: typeof createScraper; // injectable for tests; defaults to the real library
  startDate?: Date;
  now: string;
  // diagnostics (opt-in): watch the login live, log verbosely, and screenshot the page if scraping fails
  showBrowser?: boolean;
  verbose?: boolean;
  failureScreenshotPath?: string;
  timeoutMs?: number; // nav + selector budget; Beinleumi's multi-redirect login is slow (default 90s)
}
export interface ScrapeOutcome {
  ok: boolean; errorType?: string; errorMessage?: string;
  data?: ReturnType<typeof mapScrapeResult>;
}

export async function scrapeBeinleumi(creds: BeinleumiCreds, deps: ScrapeDeps): Promise<ScrapeOutcome> {
  const factory = deps.scraperFactory ?? createScraper;
  const startDate = deps.startDate ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 90); // ~90 days
  const timeout = deps.timeoutMs ?? 90000; // 30s default flakes on Beinleumi's slow multi-redirect login
  const scraper = factory({
    companyId: CompanyTypes.beinleumi, startDate, combineInstallments: false,
    timeout, defaultTimeout: timeout,
    showBrowser: deps.showBrowser ?? false,
    verbose: deps.verbose ?? false,
    storeFailureScreenShotPath: deps.failureScreenshotPath,
  });
  const result = await scraper.scrape(creds) as ScrapeResult & { errorType?: string; errorMessage?: string };
  if (!result.success) return { ok: false, errorType: result.errorType, errorMessage: result.errorMessage };
  return { ok: true, data: mapScrapeResult(result, { now: deps.now }) };
}
