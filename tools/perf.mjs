// Scroll benchmark: frame times while the page scrolls top to bottom and back.
//   node tools/perf.mjs [query]      (WAIT=ms to start before the drawing finishes; default 16000)
// Battery power and a 30 fps cap both throttle the browser, so it warns before printing numbers it can't vouch for.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {serve} from './lib/serve.mjs';
import {launch} from './lib/browser.mjs';

// BatteryStatus 1 = discharging, 4 = low, 5 = critical: all on battery. No battery or a failing command prints nothing useful: treat that as mains.
const readBatteryStatus = () => execFileSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery).BatteryStatus'], {encoding: 'utf8', timeout: 10000});

export function isOnBattery(read = readBatteryStatus) {
  try { return read().split(/\s+/).some(s => ['1', '4', '5'].includes(s)); } catch { return false; }
}

// Frame rate of an empty page: the ceiling the browser is allowed right now.
export async function blankPageFps(page, ms = 1000) {
  await page.goto('about:blank');
  return page.evaluate(ms => new Promise(res => {
    let n = 0, start = 0;
    const f = now => { if (!start) start = now; else n++; now - start < ms ? requestAnimationFrame(f) : res(n * 1000 / (now - start)); };
    requestAnimationFrame(f);
  }), ms);
}

export function trustWarnings({battery, fps}) {
  const w = [];
  if (battery) w.push('WARNING: running on battery power, so the browser is throttled. Plug in and rerun before trusting these numbers.');
  if (fps < 45) w.push(`WARNING: a blank page only reaches ${Math.round(fps)} fps (about 30 fps cap), so frame times are limited by the browser, not the site.`);
  return w;
}

async function main() {
  const [variant = ''] = process.argv.slice(2);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = await serve({root});
  const b = await launch();
  try {
    const warnings = trustWarnings({battery: isOnBattery(), fps: await blankPageFps(await b.newPage())});
    for (const w of warnings) console.log(w);
    const p = await b.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 2});
    await p.goto(server.url + variant); await p.waitForTimeout(+(process.env.WAIT || 16000));
    const r = await p.evaluate(() => new Promise(res => {
      const t = [], H = document.documentElement.scrollHeight - innerHeight; let last = 0, start = 0;
      function f(now) {
        if (!start) start = now; else t.push(now - last); last = now;
        const k = (now - start) / 3000; scrollTo(0, H * (k < .5 ? 2 * k : 2 - 2 * k));
        if (k < 1) requestAnimationFrame(f); else res(t);
      }
      requestAnimationFrame(f);
    }));
    r.sort((a, b) => a - b);
    const avg = r.reduce((a, b) => a + b, 0) / r.length;
    console.log(`${variant || 'current'}: ${r.length} frames, avg ${avg.toFixed(1)} ms, p95 ${r[Math.floor(r.length * .95)].toFixed(1)} ms, worst ${r[r.length - 1].toFixed(1)} ms`);
  } finally { await b.close(); await server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
