// Drives the project panel the way a visitor does (clicks, Escape, resizing, deep links) and asserts only what they can see:
// whether the panel is shown, which row is marked open, the address, whether the panel's glass is drawn (Liquid.debug(), read-only)
// and where the panel sits next to the text card. Each scenario was written for one bug from the sweep and failed against the old code.
const WAIT = 15000;   // generous: it only costs time when something is wrong

export default async function ({baseUrl, launch}) {
  const browser = await launch();
  const origin = new URL(baseUrl).origin;
  const state = page => page.evaluate(() => ({
    hidden: document.querySelector('#bubble').hidden,
    expanded: [...document.querySelectorAll('.open[aria-expanded=true]')].map(e => e.closest('article').dataset.item),
    panelBodies: window.Liquid?.active ? Liquid.debug().filter(d => d.frost === 1 && d.w > 100).length : -1,
    title: document.querySelector('#bubble-title').textContent, origin: location.origin, hash: location.hash,
  }));
  const until = (page, fn, arg) => page.waitForFunction(fn, arg, {timeout: WAIT});
  // the opening has finished once the title has focus (the last thing it does); an Escape before that is a different case
  const panelSettled = page => until(page, () => document.activeElement?.id === 'bubble-title');
  const panelHidden = page => until(page, () => document.querySelector('#bubble').hidden);
  const panelShown = page => until(page, () => !document.querySelector('#bubble').hidden);
  // Waits for n panel-sized glass bodies; a timeout is not itself the failure, the assertion after it reports what was seen.
  const glass = (page, n) => until(page, n => window.Liquid?.active && Liquid.debug().filter(d => d.frost === 1 && d.w > 100).length === n, n).catch(() => {});
  const settle = page => page.waitForTimeout(600);   // for "nothing else happens afterwards", which has no condition to wait for

  // One fresh context per scenario; any page error or failed request of ours fails it, with the scenario named.
  async function scenario(name, {url = baseUrl, wide = true, ...contextOptions} = {}, run) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, ...contextOptions});
    const problems = [];
    const ok = (cond, what, detail) => { if (!cond) throw new Error(`panel check "${name}": ${what}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };
    try {
      const page = await context.newPage();
      page.on('pageerror', e => problems.push(`page error: ${e.message}`));
      page.on('requestfailed', r => {
        const u = r.url(), why = r.failure()?.errorText;
        if (!u.startsWith(origin) || (/\.webm(\?|$)/.test(u) && why === 'net::ERR_ABORTED')) return;
        problems.push(`request failed: ${u} (${why})`);
      });
      await page.goto(url, {waitUntil: 'load'});
      try {
        if (wide) await until(page, () => window.Liquid?.active);
        await run(page, ok);
      } catch (e) {
        throw e.message.startsWith('panel check') ? e : new Error(`panel check "${name}": ${e.message.split('\n')[0]}`);
      }
      ok(!problems.length, 'page errors', problems);
    } finally {
      // a page that left the site (the bug some scenarios catch) can take a minute to tear down; browser.close() below ends it anyway
      await Promise.race([context.close(), new Promise(r => setTimeout(r, 5000))]);
    }
  }

  try {
    await scenario('narrowing while a panel opens', {}, async (page, ok) => {
      await page.click('[data-item=arm] .open');
      await page.setViewportSize({width: 900, height: 900});
      await settle(page);
      let s = await state(page);
      ok(!s.hidden, 'panel should still be open as a sheet', s);
      await page.keyboard.press('Escape'); await panelHidden(page);
      await page.setViewportSize({width: 1440, height: 900});
      await until(page, () => window.Liquid?.active);
      await page.click('[data-item=quant] .open'); await panelSettled(page); await glass(page, 1);
      s = await state(page);
      ok(!s.hidden && s.panelBodies === 1 && s.expanded.join() === 'quant', 'rows should work after widening again', s);
    });

    await scenario('Escape twice', {}, async (page, ok) => {
      await page.click('[data-item=arm] .open'); await panelSettled(page); await glass(page, 1);
      // both in one task, as a fast double tap can arrive before the page has handled the first
      await page.evaluate(() => { for (let i = 0; i < 2; i++) dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); });
      await panelHidden(page); await settle(page);
      const s = await state(page);
      ok(s.origin === origin && s.hidden && !s.hash, 'should stay on the page, closed', s);
    });

    await scenario('Escape twice while opening', {}, async (page, ok) => {
      await page.click('[data-item=arm] .open'); await page.waitForTimeout(350);   // mid-animation: the opening has not finished
      await page.evaluate(() => { for (let i = 0; i < 2; i++) dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); });
      await page.waitForTimeout(3000);
      const s = await state(page);
      ok(s.origin === origin && s.hidden && !s.hash, 'should stay on the page, closed', s);
    });

    await scenario('reduced motion', {reducedMotion: 'reduce'}, async (page, ok) => {
      await page.click('[data-item=arm] .open'); await panelSettled(page); await glass(page, 1);
      let s = await state(page);
      ok(!s.hidden && s.panelBodies === 1, 'panel glass should be drawn', s);
      await page.keyboard.press('Escape'); await panelHidden(page); await glass(page, 0);
      s = await state(page);
      ok(s.hidden && s.panelBodies === 0, 'should close and the glass go', s);
    });

    await scenario('rapid row clicks', {}, async (page, ok) => {
      await page.click('[data-item=arm] .open'); await page.waitForTimeout(120);
      await page.click('[data-item=recycler] .open'); await page.waitForTimeout(60);
      await page.click('[data-item=foundry] .open');
      await until(page, () => /foundry/i.test(document.querySelector('#bubble-title').textContent)).catch(() => {});
      await glass(page, 1); await settle(page);
      let s = await state(page);
      ok(!s.hidden && s.expanded.join() === 'foundry' && /foundry/i.test(s.title) && s.panelBodies === 1, 'last row should show, with one glass body', s);
      await page.keyboard.press('Escape'); await panelHidden(page);
    });

    await scenario('widening while open', {viewport: {width: 900, height: 900}, wide: false}, async (page, ok) => {
      await page.click('[data-item=arm] .open'); await panelShown(page);
      await page.setViewportSize({width: 1440, height: 900});
      await glass(page, 1);
      let s = await state(page);
      ok(!s.hidden && s.panelBodies === 1, 'panel should get its liquid glass body', s);
      await page.keyboard.press('Escape'); await panelHidden(page); await glass(page, 0);
      s = await state(page);
      ok(s.hidden && s.panelBodies === 0, 'should close cleanly', s);
    });

    await scenario('resizing during the opening animation', {}, async (page, ok) => {
      await page.click('[data-item=arm] .open'); await page.waitForTimeout(200);
      await page.setViewportSize({width: 1280, height: 760});
      await panelSettled(page); await settle(page);   // the resize is re-applied just after the opening ends
      const r = await page.evaluate(() => {
        const c = document.querySelector('main').getBoundingClientRect(), bb = document.querySelector('#bubble').getBoundingClientRect();
        return {cardRight: Math.round(document.documentElement.clientWidth - c.right), panelLeft: Math.round(bb.left), cardH: Math.round(c.height), panelH: Math.round(bb.height)};
      });
      ok(Math.abs(r.cardRight - r.panelLeft) < 2 && Math.abs(r.cardH - r.panelH) < 2, 'panel should mirror the card', r);
    });

    await scenario('deep link and Escape', {url: baseUrl + '?x=1#foundry'}, async (page, ok) => {
      await panelSettled(page); await glass(page, 1);
      let s = await state(page);
      ok(!s.hidden && s.expanded.join() === 'foundry', '#foundry should open it', s);
      await page.keyboard.press('Escape'); await panelHidden(page); await settle(page);
      s = await state(page);
      ok(s.hidden && s.origin === origin, 'Escape should close it and stay on the page', s);
    });
  } finally { await browser.close(); }
}
