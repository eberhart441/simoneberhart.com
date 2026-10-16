import test from 'node:test';
import assert from 'node:assert/strict';
import page from '../checks/page.mjs';
import {serve} from '../lib/serve.mjs';
import {launch} from '../lib/browser.mjs';
import {fixture} from './helpers.mjs';

// Runs the page check against a tiny site made from `files`.
async function run(files) {
  const f = await fixture({'index.html': '<!doctype html><title>t</title><p>hi</p>', ...files});
  const s = await serve({root: f.root});
  try { await page({root: f.root, baseUrl: s.url, launch}); }
  finally { await s.close(); await f.cleanup(); }
}

test('a clean page passes', async () => { await run({}); });

test('an uncaught error on load fails and says what it was', async () => {
  await assert.rejects(run({'index.html': '<script>throw new Error("boom on load")</script>'}), /boom on load/);
});

test('a missing file fails and names it', async () => {
  await assert.rejects(run({'index.html': '<link rel="stylesheet" href="gone.css">'}), /gone\.css/);
});

test('a cancelled video request is not a failure', async () => {
  await run({'index.html': '<script>const c = new AbortController(); fetch("clip.webm", {signal: c.signal}).catch(() => {}); c.abort();</script>', 'clip.webm': 'x'.repeat(10)});
});
