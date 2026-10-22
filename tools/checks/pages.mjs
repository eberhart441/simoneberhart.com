import {watchPage} from '../lib/failures.mjs';

// The pages that carry claims: the trading log must show the numbers recorded in the log PDF (they are the evidence behind a
// row on the main page), and the résumé page must still load. Nothing here depends on layout.
export default async function ({baseUrl, launch}) {
  const browser = await launch();
  const origin = new URL(baseUrl).origin;
  const failures = [];
  try {
    for (const [name, path, expect] of [
      ['trading log', 'trading-log/', async page => {
        const t = await page.evaluate(() => ({text: document.body.innerText, rows: document.querySelectorAll('tbody tr').length, chart: !!document.querySelector('svg.chart path.net')}));
        const missing = ['$130.97', '+18.11%', '$288.00', '+39.84%', '$154.44'].filter(s => !t.text.includes(s));
        if (missing.length) throw new Error(`the log's totals are missing: ${missing.join(', ')}`);
        if (t.rows !== 61) throw new Error(`the table should list the log's 61 trades, it has ${t.rows}`);
        if (!t.chart) throw new Error('the chart is missing');
        const pdf = await page.request.get(new URL('trading-log/BuyIn-trading-log.pdf', baseUrl).href);
        if (!pdf.ok()) throw new Error(`the original log PDF should be downloadable (HTTP ${pdf.status()})`);
      }],
      ['résumé', 'resume/', async page => {
        const t = await page.evaluate(() => ({imgs: [...document.querySelectorAll('.page img')].map(i => i.complete && i.naturalWidth > 0)}));
        if (!t.imgs.length || t.imgs.includes(false)) throw new Error('the résumé pages should both load');
      }],
    ]) {
      const context = await browser.newContext({viewport: {width: 1280, height: 900}}), page = await context.newPage();
      const problems = watchPage(page, origin);
      try {
        await page.goto(new URL(path, baseUrl).href, {waitUntil: 'load'});
        await page.waitForTimeout(500);
        await expect(page);
        if (problems.length) throw new Error(`page errors: ${[...new Set(problems)].join('; ')}`);
      } catch (e) { failures.push(`pages check "${name}": ${e.message.split('\n')[0]}`); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  if (failures.length) throw new Error(failures.join('; '));
}
