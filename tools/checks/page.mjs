import {watchPage} from '../lib/failures.mjs';

// Loads the real page in a headless browser and scrolls it end to end; any uncaught error or failed request fails the check.
export default async function ({baseUrl, launch}) {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const problems = watchPage(page, new URL(baseUrl).origin);

    await page.goto(baseUrl, {waitUntil: 'load'});
    await page.waitForTimeout(1000);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 600) { await page.evaluate(y => scrollTo(0, y), y); await page.waitForTimeout(80); }
    await page.waitForTimeout(1000);

    if (problems.length) throw new Error(`page load: ${[...new Set(problems)].join('; ')}`);
  } finally { await browser.close(); }
}
