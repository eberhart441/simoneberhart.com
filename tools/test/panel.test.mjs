import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, rm, writeFile, readFile} from 'node:fs/promises';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import panel from '../checks/panel.mjs';
import {serve} from '../lib/serve.mjs';
import {launch} from '../lib/browser.mjs';

const repo = path.resolve(import.meta.dirname, '../..');
const SITE = ['index.html', 'style.css', 'frame.js', 'study-player.mjs', 'liquid.mjs', 'bubble.mjs'];

// Runs the panel check against a copy of the site, with `edit(file, text)` free to break a file first.
async function run(edit) {
  const root = await mkdtemp(path.join(tmpdir(), 'panel-'));
  await cp(repo, root, {recursive: true, filter: p => !/[\\/](\.git|node_modules)([\\/]|$)/.test(p)});
  if (edit) for (const f of SITE) { const t = await readFile(path.join(root, f), 'utf8'); await writeFile(path.join(root, f), edit(f, t)); }
  const s = await serve({root});
  try { await panel({root, baseUrl: s.url, launch}); }
  finally { await s.close(); await rm(root, {recursive: true, force: true}); }
}

test('the real site passes', {timeout: 240000}, async () => { await run(); });

test('a page error while a panel is used fails the run', {timeout: 240000}, async () => {
  await assert.rejects(run((f, t) => f === 'bubble.mjs' ? t + '\naddEventListener("keydown", e => { if (e.key === "Escape") throw new Error("boom on escape"); });\n' : t), /boom on escape/);
});


// The check must bite: undo one of the sweep's fixes in a copy of the site and it has to go red, naming the scenario.
const lf = t => t.replace(/\r\n/g, '\n');   // the working copy may have CRLF
const without = (file, from, to, scenario) => test(`undoing a fix makes "${scenario}" fail`, {timeout: 240000}, async () => {
  await assert.rejects(run((f, t) => {
    if (f !== file) return t;
    assert.ok(lf(t).includes(from), `fixture drifted: ${from}`);
    return lf(t).split(from).join(to);                        // every copy: a guard may be checked more than once
  }), new RegExp(`panel check "${scenario}"`));
});

without('bubble.mjs', ' || (closing && !fromHistory)', '', 'Escape twice');
without('bubble.mjs', 'while (busy) await busy.catch(() => {});\n  busy = run();', 'busy = run();', 'rapid row clicks|widening while open');   // without the lock either scenario can fail first
without('bubble.mjs', 'if (wideQuery.matches && liquid()) {', 'if (wideQuery.matches && liquid() && !reduceQuery.matches) {', 'reduced motion');
