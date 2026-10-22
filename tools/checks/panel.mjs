import {watchPage} from '../lib/failures.mjs';

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

  // One fresh context per scenario; any page error or failed request of ours fails it, with the scenario named. A failing
  // scenario does not stop the others: one broken behaviour often breaks several, and the report should show them all.
  const failures = [];
  async function scenario(name, options, run) {
    try { await runScenario(name, options, run); } catch (e) { failures.push(e.message); }
  }
  async function runScenario(name, {url = baseUrl, wide = true, ...contextOptions} = {}, run) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, ...contextOptions});
    const ok = (cond, what, detail) => { if (!cond) throw new Error(`panel check "${name}": ${what}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };
    try {
      const page = await context.newPage();
      const problems = watchPage(page, origin);
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

    await scenario('the board viewer', {}, async (page, ok) => {
      await page.click('[data-item=arm] .open'); await panelSettled(page);
      const view = () => page.evaluate(() => { const v = document.querySelector('.pcb svg')?.getAttribute('viewBox'); return v && v.split(' ').map(Number); });
      await until(page, () => document.querySelector('.bubble-report .pcb svg g[data-layer]'));   // (the report moves the viewer into its text when it arrives: wait for that)
      let s = await page.evaluate(() => ({shown: !document.querySelector('.pcb').hidden, boards: [...document.querySelectorAll('.pcb-boards button')].map(b => b.textContent), side: document.querySelector('.pcb svg').dataset.side}));
      ok(s.shown && s.boards.length === 2 && s.side === 'top', 'the arm should show two boards, top side first', s);
      const before = await view();
      await page.click('.pcb-zoom [data-z=in]');
      const zoomed = await view();
      ok(zoomed[2] < before[2], 'the zoom button should narrow the view', {before, zoomed});
      const frame = await page.locator('.pcb-frame').boundingBox();
      await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2); await page.mouse.down(); await page.mouse.move(frame.x + frame.width / 2 - 80, frame.y + frame.height / 2); await page.mouse.up();
      const moved = await view();
      ok(moved[0] > zoomed[0], 'dragging left should move the view right along the board', {zoomed, moved});
      await page.click('.pcb-zoom [data-z=fit]');
      ok((await view())[2] === before[2], 'fit should bring the whole board back');
      await page.click('.pcb-side [data-side=bot]');
      s = await page.evaluate(() => { const g = document.querySelector('.pcb svg g[data-layer=cu-bot]'); return {side: document.querySelector('.pcb svg').dataset.side, cuBot: getComputedStyle(g).display, cuTop: getComputedStyle(document.querySelector('.pcb svg .cu-top')).display}; });
      ok(s.side === 'bot' && s.cuBot !== 'none' && s.cuTop === 'none', 'the bottom side should show the bottom copper', s);
      await page.click('.pcb-boards button:nth-child(2)'); await until(page, () => document.querySelector('.pcb-boards button[aria-pressed=true]')?.textContent === 'Graphite');
      await page.close();
    });
    await scenario('a project with a report shows it in the panel', {}, async (page, ok) => {
      await page.click('[data-item=quant] .open'); await panelSettled(page);
      await until(page, () => document.querySelector('.bubble-report article.report .stat'));
      const r = await page.evaluate(() => ({title: document.querySelector('#bubble-title').textContent, stats: document.querySelectorAll('.bubble-report .stat').length, charts: document.querySelectorAll('.bubble-report svg.chart').length, text: document.querySelector('.bubble-report').innerText, summaryHidden: document.querySelector('.bubble-summary').hidden}));
      ok(r.title === 'Statistical arbitrage model' && r.stats === 4 && r.charts === 2 && r.summaryHidden, 'the report should replace the summary, with its tiles and two charts', {title: r.title, stats: r.stats, charts: r.charts});
      ok(['+$130.97', '$154.44'].every(x => r.text.includes(x)), "the report's numbers should match the log");
    });
    await scenario('the schematic viewer lights up a net and names a part', {}, async (page, ok) => {
      await page.click('[data-item=baja-sensor] .open'); await panelSettled(page);
      await until(page, () => document.querySelector('.bubble-report svg.sch [data-ref=U302]'));
      const sheets = await page.evaluate(() => [...document.querySelectorAll('.sch-sheets button')].map(b => b.textContent));
      ok(sheets.length === 2, 'the board has two schematic sheets', sheets);
      await page.click('.sch-places button:nth-child(3)');             // Accelerometer
      const at = await page.evaluate(() => {
        const svg = document.querySelector('svg.sch'), t = [...svg.querySelectorAll('text')].find(t => t.textContent === 'IMU_SDA');
        const w = svg.querySelector(`.wire[data-net="${t.closest('[data-net]').dataset.net}"]`), p = w.getAttribute('points').split(' ').map(s => s.split(',').map(Number));
        const q = new DOMPoint((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2).matrixTransform(svg.getScreenCTM());
        return [q.x, q.y];
      });
      await page.mouse.move(at[0], at[1]);
      await until(page, () => document.querySelector('svg.sch.hot') && document.querySelector('.sch-info').textContent.includes('IMU_SDA'));
      let s = await page.evaluate(() => ({text: document.querySelector('.sch-info').textContent, lit: document.querySelectorAll('svg.sch .on').length}));
      ok(s.text.includes('U302 SDA') && s.text.includes('U304 PB7') && s.lit >= 3, 'pointing at the IMU_SDA wire should light the net and list its pins', s);
      await page.mouse.move(10, 10);
      const part = await page.evaluate(() => { const r = document.querySelector('svg.sch [data-ref=U302] .body').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
      await page.mouse.click(part[0], part[1]);
      await until(page, () => document.querySelector('.sch-info').textContent.includes('MPU-6050'));
      s = await page.evaluate(() => ({text: document.querySelector('.sch-info').textContent, sel: !!document.querySelector('svg.sch .part.sel')}));
      ok(s.sel && s.text.includes('SDA → IMU_SDA'), 'clicking the accelerometer should select it and say what it connects to', s);
    });
    await scenario('a project without boards hides the viewer', {}, async (page, ok) => {
      await page.click('[data-item=foundry] .open'); await panelSettled(page); await settle(page);
      ok(await page.evaluate(() => document.querySelector('.pcb').hidden), 'foundry has no boards, so no viewer');
    });
  } finally { await browser.close(); }
  if (failures.length) throw new Error(failures.join('; '));
}
