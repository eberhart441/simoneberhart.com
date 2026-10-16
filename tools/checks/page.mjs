// Loads the real page in a headless browser and scrolls it end to end; any uncaught error or failed request fails the check.
export default async function ({baseUrl, launch}) {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const origin = new URL(baseUrl).origin, problems = [];
    page.on('pageerror', e => problems.push(`page error: ${e.message}`));
    page.on('requestfailed', r => {
      const url = r.url(), why = r.failure()?.errorText;
      if (!url.startsWith(origin)) return;                              // fonts etc.: not ours, and offline must not block publishing
      if (/\.webm(\?|$)/.test(url) && why === 'net::ERR_ABORTED') return;   // deliberate: videos cancel on fast scrolling
      problems.push(`request failed: ${url} (${why})`);
    });
    page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) problems.push(`request failed: ${r.url()} (HTTP ${r.status()})`); });

    await page.goto(baseUrl, {waitUntil: 'load'});
    await page.waitForTimeout(1000);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 600) { await page.evaluate(y => scrollTo(0, y), y); await page.waitForTimeout(80); }
    await page.waitForTimeout(1000);

    if (problems.length) throw new Error(`page load: ${[...new Set(problems)].join('; ')}`);
  } finally { await browser.close(); }
}
