import {watchPage} from '../lib/failures.mjs';

// The narrow layout on a phone (390x844, touch): what a visitor can do and see. Taps are real touch taps and the swipe is
// real touch input (CDP), never clicks. Each scenario states one thing the polish promises.
const WAIT = 15000;
const PHONE = {viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2};
const NOTCH = {top: 0, left: 47, bottom: 21, right: 47};                 // the safe-area insets of a landscape phone with a cutout

export default async function ({baseUrl, launch}) {
  const browser = await launch();
  const origin = new URL(baseUrl).origin;
  const until = (page, fn, arg) => page.waitForFunction(fn, arg, {timeout: WAIT});
  const sheetShown = page => until(page, () => !document.querySelector('#bubble').hidden && document.activeElement?.id === 'bubble-title');
  const sheetHidden = page => until(page, () => document.querySelector('#bubble').hidden);
  const state = page => page.evaluate(() => ({hidden: document.querySelector('#bubble').hidden, title: document.querySelector('#bubble-title').textContent, origin: location.origin}));
  // a finger drag, as the browser sees it; `cancel` ends it as the system would (a cancelled touch, not a release)
  const swipe = async (page, from, to, {cancel = false} = {}) => {
    const cdp = await page.context().newCDPSession(page), pt = (x, y) => [{x, y}];
    try {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: pt(...from)});
      for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: pt(from[0] + (to[0] - from[0]) * i / 10, from[1] + (to[1] - from[1]) * i / 10)});
      await cdp.send('Input.dispatchTouchEvent', {type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: []});
    } finally { await cdp.detach(); }
  };
  const centre = (page, selector) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, selector);

  const failures = [];
  async function scenario(name, run, {context: contextOptions = PHONE, setup} = {}) {
    const context = await browser.newContext(contextOptions), page = await context.newPage();
    const problems = watchPage(page, origin);
    page.on('dialog', d => d.dismiss());
    const ok = (cond, what, detail) => { if (!cond) throw new Error(`mobile check "${name}": ${what}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };
    try {
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());   // links to other sites go nowhere
      if (setup) await setup(page, context);
      await page.goto(baseUrl, {waitUntil: 'load'});
      // the text rises into place on load: a tap measured before it has settled lands somewhere else
      await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running'), null, {timeout: WAIT});
      await run(page, ok);
      ok(!problems.length, 'page errors', problems);
    } catch (e) {
      failures.push(e.message.startsWith('mobile check') ? e.message : `mobile check "${name}": ${e.message.split('\n')[0]}`);
    } finally { await Promise.race([context.close(), new Promise(r => setTimeout(r, 5000))]); }
  }

  try {
    await scenario('tap targets', async (page, ok) => {
      // every link and button a thumb must hit is at least 44px high (invisible padding counts: it is part of the hit area).
      // Links inside a sentence are exempt, as in WCAG 2.2: padding them would steal taps from the text around them, and a
      // near miss opens the row, whose sheet lists the same links.
      const small = await page.evaluate(() => [...document.querySelectorAll('main a, main button, footer a')].filter(e => e.offsetParent && !e.closest('article p'))
        .map(e => ({t: (e.textContent || '').trim().slice(0, 24), h: Math.round(e.getClientRects()[0].height)})).filter(x => x.h < 44));
      ok(!small.length, 'every link and button should be at least 44px high', small);
    });

    await scenario('tapping a row anywhere opens its sheet', async (page, ok) => {
      const at = await centre(page, '[data-item=recycler] p');        // the description, not the title
      await page.touchscreen.tap(...at);
      await sheetShown(page);
      const s = await state(page);
      ok(!s.hidden && /recycler/i.test(s.title), 'the row\'s sheet should open', s);
    });

    await scenario('tapping a link inside a row does not open the sheet', async (page, ok) => {
      const at = await centre(page, '[data-item=quant] a');
      await page.touchscreen.tap(...at); await page.waitForTimeout(900);
      ok((await state(page)).hidden, 'the sheet should stay closed when a link is tapped');
    });

    await scenario('a tap beside a link opens the row, not the link', async (page, ok) => {
      // 10px above the "Transmission video" link (the browser snaps a tap within ~8px to a link anyway): its hit area must not reach that far
      // (measured on the link's text, not its box: the box includes any padding)
      const [x, y] = await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('[data-item=arm] p a')); const r = range.getBoundingClientRect(); return [r.left + 20, r.top - 10]; });
      await page.touchscreen.tap(x, y);
      await sheetShown(page);
      const s = await state(page);
      ok(!s.hidden && /single-motor/i.test(s.title), 'the row\'s sheet should open', s);
    });

    await scenario('the sheet dims and locks the page', async (page, ok) => {
      await page.evaluate(() => scrollTo(0, 400)); await page.waitForTimeout(300);
      const before = await page.evaluate(() => scrollY);
      await page.touchscreen.tap(...await centre(page, '[data-item=baja-sensor] p')); await sheetShown(page);
      const open = await page.evaluate(() => ({overflow: getComputedStyle(document.documentElement).overflow, scrim: +getComputedStyle(document.querySelector('.sheet-scrim')).opacity, y: scrollY}));
      ok(open.overflow === 'hidden', 'the page behind should not scroll', open);
      ok(open.scrim > .15, 'the page behind should be dimmed', open);
      await page.touchscreen.tap(195, 20); await sheetHidden(page); await page.waitForTimeout(900);
      ok((await state(page)).hidden, 'the tap that closes the sheet should not open the row under the finger');
      const after = await page.evaluate(() => ({y: scrollY, overflow: getComputedStyle(document.documentElement).overflow}));
      ok(Math.abs(after.y - before) < 2 && after.overflow !== 'hidden', 'closing should leave the page where it was, scrollable again', {before, ...after});
    });

    await scenario('dragging on the dimming does not close the sheet', async (page, ok) => {
      await page.touchscreen.tap(...await centre(page, '[data-item=recycler] p')); await sheetShown(page);
      await swipe(page, [195, 10], [195, 55]); await page.waitForTimeout(700);   // above the sheet: only the dimming is there
      ok(!(await state(page)).hidden, 'a drag that starts on the dimming should not close the sheet');
    });

    await scenario('swiping the sheet down closes it', async (page, ok) => {
      await page.touchscreen.tap(...await centre(page, '[data-item=recycler] p')); await sheetShown(page);
      await swipe(page, [195, 300], [195, 700]);
      await sheetHidden(page);
      ok((await state(page)).hidden, 'a swipe down should close the sheet');
    });

    await scenario('a short swipe springs back', async (page, ok) => {
      await page.touchscreen.tap(...await centre(page, '[data-item=recycler] p')); await sheetShown(page);
      await swipe(page, [195, 300], [195, 340]); await page.waitForTimeout(700);
      ok(!(await state(page)).hidden, 'a small drag should not close the sheet');
    });

    await scenario('a cancelled drag springs back', async (page, ok) => {
      await page.touchscreen.tap(...await centre(page, '[data-item=recycler] p')); await sheetShown(page);
      await swipe(page, [195, 300], [195, 450], {cancel: true}); await page.waitForTimeout(900);   // the system took the touch away
      ok(!(await state(page)).hidden, 'a drag the system cancels should not close the sheet');
    });

    await scenario('the sheet stays clear of the notch in landscape', async (page, ok) => {
      await page.locator('[data-item=recycler] p').scrollIntoViewIfNeeded();
      await page.touchscreen.tap(...await centre(page, '[data-item=recycler] p')); await sheetShown(page);
      const r = await page.evaluate(() => { const b = document.querySelector('#bubble').getBoundingClientRect(); return {left: Math.round(b.left), right: Math.round(innerWidth - b.right)}; });
      ok(r.left >= NOTCH.left - 1 && r.right >= NOTCH.right - 1, `the sheet should keep ${NOTCH.left}px clear of the notch on both sides`, r);
    }, {
      context: {viewport: {width: 667, height: 375}, hasTouch: true, isMobile: true, deviceScaleFactor: 2},   // a small landscape screen: the sheet spans it
      setup: async (page, context) => { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: NOTCH}); },
    });

    await scenario('the page looks finished', async (page, ok) => {
      const s = await page.evaluate(() => { const m = getComputedStyle(document.querySelector('main')), c = document.querySelector('.contact').getBoundingClientRect(), p = document.querySelector('#projects').getBoundingClientRect();
        return {bg: getComputedStyle(document.documentElement).backgroundColor, radius: m.borderTopLeftRadius, margin: m.marginLeft, gapToProjects: Math.round(p.top - c.bottom), gutter: getComputedStyle(document.documentElement).scrollbarGutter,
          viewport: document.querySelector('meta[name=viewport]').content, theme: [...document.querySelectorAll('meta[name=theme-color]')].map(e => e.content + '|' + (e.media || '')).join(' ')}; });
      ok(s.bg === 'rgb(220, 225, 217)', 'the page behind the card should be sage', s);
      ok(s.radius === '28px' && s.margin === '8px', 'the card should be tighter: 28px corners, 8px margin', s);
      ok(s.gapToProjects <= 64, 'the space above "Projects" should be tighter', s);
      ok(/viewport-fit=cover/.test(s.viewport), 'the page should cover the whole screen so safe areas can be respected', s);
      ok(s.gutter === 'stable', 'the scrollbar space should stay reserved, so locking the page behind a sheet does not shift it', s);
    });
  } finally { await browser.close(); }
  if (failures.length) throw new Error(failures.join('; '));
}
