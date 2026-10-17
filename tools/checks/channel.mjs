import {watchPage} from '../lib/failures.mjs';

// The beads that float between the text card and an open panel (the channel), and how far glass merges (Liquid.reach(), a
// read-only accessor). Wide layout, desktop browser. Every scenario asserts what is visible: where the beads are, how many,
// and that they leave when the panel closes.
const WAIT = 25000;                                                    // beads are born slowly (one every few seconds)
const BASE_REACH = 40;                                                 // the ordinary merge reach is ~34; the long one is 72

export default async function ({baseUrl, launch}) {
  const browser = await launch();
  const origin = new URL(baseUrl).origin;
  const until = (page, fn, arg, timeout = WAIT) => page.waitForFunction(fn, arg, {timeout});
  // the channel's beads once they have drifted into place, with the card's and the panel's edges for reference
  const channel = page => page.evaluate(() => {
    const gap = new Set(Liquid.drops().filter(d => d.gap && d.born && !d.home).map(d => d.id));
    const c = document.querySelector('main').getBoundingClientRect(), p = document.querySelector('#bubble').getBoundingClientRect();
    return {cardRight: Math.round(c.right), panelLeft: Math.round(p.left), top: Math.round(c.top), bottom: Math.round(c.bottom), reach: Math.round(Liquid.reach()),
      beads: Liquid.debug().filter(d => gap.has(d.id)).map(d => ({x: Math.round(d.x), y: Math.round(d.y), r: Math.round(d.w)})),
      all: Liquid.drops().filter(d => d.gap).length};
  });
  const open = async (page, row = 'arm') => {
    await page.click(`[data-item=${row}] .open`);
    await until(page, () => document.activeElement?.id === 'bubble-title');
  };

  const failures = [];
  async function scenario(name, run, viewport = {width: 1440, height: 900}) {
    const context = await browser.newContext({viewport}), page = await context.newPage();
    const problems = watchPage(page, origin);
    const ok = (cond, what, detail) => { if (!cond) throw new Error(`channel check "${name}": ${what}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };
    try {
      await page.goto(baseUrl, {waitUntil: 'load'});
      await until(page, () => window.Liquid?.active);
      await run(page, ok);
      ok(!problems.length, 'page errors', problems);
    } catch (e) {
      failures.push(e.message.startsWith('channel check') ? e.message : `channel check "${name}": ${e.message.split('\n')[0]}`);
    } finally { await Promise.race([context.close(), new Promise(r => setTimeout(r, 5000))]); }
  }

  try {
    await scenario('beads float in the channel while a panel is open', async (page, ok) => {
      await open(page);
      await until(page, () => Liquid.drops().filter(d => d.gap && d.born && !d.home).length >= 2);
      for (let i = 0; i < 6; i++) {                                    // sampled over a few seconds: they stay between the two
        const s = await channel(page);
        ok(s.beads.length >= 2 && s.beads.length <= 3, 'two or three beads should float in the channel', s);
        for (const b of s.beads) {
          ok(b.x > s.cardRight - 20 && b.x < s.panelLeft + 20, 'a bead should stay between the card and the panel', {b, s});
          ok(b.y > s.top && b.y < s.bottom, 'a bead should stay within the height of the card', {b, s});
        }
        ok(s.reach > 60, 'beads should merge with the panel as far out as with the card', s);
        await page.waitForTimeout(700);
      }
    });

    await scenario('they go home when the panel closes', async (page, ok) => {
      await open(page);
      await until(page, () => Liquid.drops().filter(d => d.gap && d.born && !d.home).length >= 1);
      await page.keyboard.press('Escape');
      await until(page, () => document.querySelector('#bubble').hidden);
      await until(page, () => Liquid.drops().filter(d => d.gap).length === 0 && Liquid.reach() < 40);
      const s = await channel(page);
      ok(s.all === 0 && s.reach <= BASE_REACH, 'the beads should be gone and the merge reach back to normal', s);
    });

    await scenario('narrowing the window while a panel opens leaves the merge reach normal', async (page, ok) => {
      await page.click('[data-item=arm] .open'); await page.waitForTimeout(250);   // mid-opening
      await page.setViewportSize({width: 900, height: 900}); await page.waitForTimeout(1500);
      await page.setViewportSize({width: 1440, height: 900});
      await until(page, () => window.Liquid?.active);
      await page.waitForTimeout(2500);                                 // long enough for any wrongly raised reach to ease up
      const s = await channel(page);
      ok(s.reach <= BASE_REACH, 'with no panel open, glass should merge at the ordinary reach', s);
    });
  } finally { await browser.close(); }
  if (failures.length) throw new Error(failures.join('; '));
}
