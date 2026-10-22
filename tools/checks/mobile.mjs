import {watchPage} from '../lib/failures.mjs';

// The narrow layout on a phone (390x844, touch): what a visitor can do and see. Taps are real touch taps and the swipe is
// real touch input (CDP), never clicks. Each scenario states one thing the polish promises.
const WAIT = 15000;
const PHONE = {viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2};
const NOTCH = {top: 0, left: 47, bottom: 21, right: 47};                 // the safe-area insets of a landscape phone with a cutout

export default async function ({baseUrl, launch}) {
  const browser = await launch();
  const withScrollbars = await launch([], {ignoreDefaultArgs: ['--hide-scrollbars']});   // the usual headless browser has none
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
  // the middle of an element, scrolled into view first: a longer page puts rows below the screen, where a tap lands nowhere
  const centre = async (page, selector) => {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    return page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, selector);
  };

  const failures = [];
  async function scenario(name, run, {context: contextOptions = PHONE, setup, scrollbars = false} = {}) {
    const context = await (scrollbars ? withScrollbars : browser).newContext(contextOptions), page = await context.newPage();
    const problems = watchPage(page, origin);
    page.on('dialog', d => d.dismiss());
    const ok = (cond, what, detail) => { if (!cond) throw new Error(`mobile check "${name}": ${what}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };
    try {
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.fulfill({contentType: 'text/html', body: '<!doctype html><title>outside</title>'}));   // other sites: an empty stub
      if (setup) await setup(page, context);
      await page.goto(baseUrl, {waitUntil: 'load'});
      // the text rises into place on load: a tap measured before it has settled lands somewhere else
      await page.waitForFunction(() => !document.getAnimations().some(a => a.animationName === 'rise' && a.playState === 'running'), null, {timeout: WAIT});
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
      ok(!s.hidden && /winder/i.test(s.title), 'the row\'s sheet should open', s);
    });

    await scenario('tapping a link inside a row follows the link, not the row', async (page, ok) => {
      const at = await centre(page, '[data-item=arm] a');   // a lone outside link (links packed side by side get tap-snapped to each other)
      await page.touchscreen.tap(...at);
      const followed = await page.waitForURL(u => new URL(u).origin !== origin, {timeout: 5000}).then(() => true, () => false);
      ok(followed, 'the link should be followed', {url: page.url()});
      await page.goBack({waitUntil: 'load'}); await page.waitForTimeout(500);
      ok((await state(page)).hidden, 'the sheet should not have opened');
    });

    await scenario('a link inside a sentence answers a touch only on its own text', async (page, ok) => {
      // measured on the link's text, not its box (the box includes any padding): the lines around it belong to the row
      const hit = await page.evaluate(() => {
        const a = document.querySelector('[data-item=arm] p a'), range = document.createRange(); range.selectNodeContents(a);
        const r = range.getBoundingClientRect(), x = r.left + 20;
        return {above: [-14, -10, -6].filter(dy => document.elementFromPoint(x, r.top + dy) === a), below: [6, 10, 14].filter(dy => document.elementFromPoint(x, r.bottom + dy) === a), x, y: r.top - 20};
      });
      ok(!hit.above.length && !hit.below.length, 'points just outside the link\'s text should not be part of the link', hit);
      await page.touchscreen.tap(hit.x, hit.y);                          // the line above it: a tap there opens the row
      await sheetShown(page);
      const s = await state(page);
      ok(!s.hidden && /single-motor/i.test(s.title), 'a tap on the line above the link should open the row\'s sheet', s);
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

    await scenario('a drag released while the sheet is already closing springs back', async (page, ok) => {
      await page.touchscreen.tap(...await centre(page, '[data-item=recycler] p')); await sheetShown(page);
      await page.evaluate(() => { history.back = () => {}; });           // a slow browser history: the close is waiting for it
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      await swipe(page, [195, 300], [195, 600]); await page.waitForTimeout(700);
      const t = await page.evaluate(() => getComputedStyle(document.querySelector('#bubble')).transform);
      ok(t === 'none', 'a sheet that was dragged but not closed should be back in place', {t});
    });

    await scenario('with a classic scrollbar, opening a sheet does not move the page behind it', async (page, ok) => {
      const edges = () => page.evaluate(() => { const m = document.querySelector('main').getBoundingClientRect(); return {left: Math.round(m.left), right: Math.round(m.right)}; });
      const bar = await page.evaluate(() => innerWidth - document.documentElement.clientWidth);
      ok(bar > 0, 'this scenario needs a window with a classic scrollbar', {bar});
      const before = await edges();
      await page.click('[data-item=recycler] .open'); await sheetShown(page);
      // the page's width is the root element's box: innerWidth and clientWidth both include the reserved scrollbar space, which a fixed element cannot reach
      const open = await edges(), sheet = await page.evaluate(() => ({right: Math.round(document.querySelector('#bubble').getBoundingClientRect().right), width: Math.round(document.documentElement.getBoundingClientRect().width)}));
      ok(Math.abs(open.left - before.left) <= 1 && Math.abs(open.right - before.right) <= 1, 'the card behind the dimming should stay where it was', {before, open, bar});
      ok(sheet.right <= sheet.width - 7, 'the sheet should keep its margin from the window\'s edge', sheet);
      await page.keyboard.press('Escape'); await sheetHidden(page); await page.waitForTimeout(400);
      const after = await edges();
      ok(Math.abs(after.left - before.left) <= 1 && Math.abs(after.right - before.right) <= 1, 'closing should put the card back where it was', {before, after});
    }, {context: {viewport: {width: 600, height: 800}}, scrollbars: true});

    await scenario('the page looks finished', async (page, ok) => {
      const s = await page.evaluate(() => { const m = getComputedStyle(document.querySelector('main')), c = document.querySelector('.contact').getBoundingClientRect(), p = document.querySelector('#projects').getBoundingClientRect();
        return {bg: getComputedStyle(document.documentElement).backgroundColor, radius: m.borderTopLeftRadius, margin: m.marginLeft, gapToProjects: Math.round(p.top - c.bottom),
          viewport: document.querySelector('meta[name=viewport]').content, theme: [...document.querySelectorAll('meta[name=theme-color]')].map(e => e.content + '|' + (e.media || '')).join(' ')}; });
      ok(s.bg === 'rgb(220, 225, 217)', 'the page behind the card should be sage', s);
      ok(s.radius === '28px' && s.margin === '8px', 'the card should be tighter: 28px corners, 8px margin', s);
      ok(s.gapToProjects <= 64, 'the space above "Projects" should be tighter', s);
      ok(/viewport-fit=cover/.test(s.viewport), 'the page should cover the whole screen so safe areas can be respected', s);
    });
  } finally { await Promise.all([browser.close(), withScrollbars.close()]); }
  if (failures.length) throw new Error(failures.join('; '));
}
