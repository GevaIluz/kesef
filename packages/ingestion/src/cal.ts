import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { mapScrapeResult, type ScrapeResult } from './map.js';

export interface CalCreds { username: string; password: string; }
export interface CalScrapeDeps {
  scraperFactory?: typeof createScraper;
  startDate?: Date; now: string;
  showBrowser?: boolean; verbose?: boolean; failureScreenshotPath?: string; timeoutMs?: number;
}
export interface CalOutcome { ok: boolean; errorType?: string; errorMessage?: string; data?: ReturnType<typeof mapScrapeResult>; }

export async function scrapeCal(creds: CalCreds, deps: CalScrapeDeps): Promise<CalOutcome> {
  const factory = deps.scraperFactory ?? createScraper;
  const startDate = deps.startDate ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 90);
  const timeout = deps.timeoutMs ?? 90000;
  const scraper = factory({
    companyId: CompanyTypes.visaCal, startDate, combineInstallments: false,
    timeout, defaultTimeout: timeout,
    showBrowser: deps.showBrowser ?? false, verbose: deps.verbose ?? false,
    storeFailureScreenShotPath: deps.failureScreenshotPath,
  });
  const result = await scraper.scrape(creds) as ScrapeResult & { errorType?: string; errorMessage?: string };
  if (!result.success) return { ok: false, errorType: result.errorType, errorMessage: result.errorMessage };
  return { ok: true, data: mapScrapeResult(result, { institution: 'cal', accountType: 'credit_card', now: deps.now }) };
}
