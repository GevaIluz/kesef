import { describe, it, expect } from 'vitest';
import { scrapeBeinleumi } from '../src/beinleumi';

// A fake createScraper: captures the options it was constructed with, returns a canned result.
function fakeFactory(captured: { opts?: Record<string, unknown> }) {
  return ((opts: Record<string, unknown>) => {
    captured.opts = opts;
    return { scrape: async () => ({ success: true, accounts: [] }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

describe('scrapeBeinleumi options wiring', () => {
  it('passes a generous default timeout (90s) for the slow Beinleumi login', async () => {
    const captured: { opts?: Record<string, unknown> } = {};
    const res = await scrapeBeinleumi(
      { username: 'u', password: 'p' },
      { now: '2026-06-02', scraperFactory: fakeFactory(captured) },
    );
    expect(res.ok).toBe(true);
    expect(captured.opts!['companyId']).toBe('beinleumi');
    expect(captured.opts!['timeout']).toBe(90000);
    expect(captured.opts!['defaultTimeout']).toBe(90000);
    expect(captured.opts!['showBrowser']).toBe(false);
  });

  it('forwards an explicit timeout + diagnostics to the scraper', async () => {
    const captured: { opts?: Record<string, unknown> } = {};
    await scrapeBeinleumi(
      { username: 'u', password: 'p' },
      { now: '2026-06-02', scraperFactory: fakeFactory(captured), timeoutMs: 120000, showBrowser: true, verbose: true, failureScreenshotPath: '/tmp/x.png' },
    );
    expect(captured.opts!['timeout']).toBe(120000);
    expect(captured.opts!['showBrowser']).toBe(true);
    expect(captured.opts!['verbose']).toBe(true);
    expect(captured.opts!['storeFailureScreenShotPath']).toBe('/tmp/x.png');
  });

  it('reports failure (not throw) when the scraper returns success:false', async () => {
    const factory = ((/* opts */) => ({
      scrape: async () => ({ success: false, errorType: 'TIMEOUT', errorMessage: 'slow' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;
    const res = await scrapeBeinleumi({ username: 'u', password: 'p' }, { now: '2026-06-02', scraperFactory: factory });
    expect(res.ok).toBe(false);
    expect(res.errorType).toBe('TIMEOUT');
  });
});
