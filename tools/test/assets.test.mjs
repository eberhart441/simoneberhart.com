import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assets from '../checks/assets.mjs';
import {fixture} from './helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('passes on the live site', async () => { await assets({root: repo}); });

test('a manifest entry whose video is missing fails and names it', async () => {
  const manifest = [{id: 'ghost', duration: 1, video: 'studies/assets/ghost.webm', opening: 'o.webp', poster: 'p.webp'}];
  const f = await fixture({'studies/assets/manifest.json': JSON.stringify(manifest)});
  await assert.rejects(assets({root: f.root}), /ghost/);
  await f.cleanup();
});

// An override that points at nothing must fail with one sentence naming what is missing and how to point at it.
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v; }
}

test('without ffmpeg/ffprobe it says what is missing and how to point at it', async () => {
  const empty = await fixture({});
  await withEnv({FFMPEG_DIR: empty.root}, () => assert.rejects(assets({root: repo}), /ffprobe.*FFMPEG_DIR/));
  await empty.cleanup();
});

test('without sharp it says what is missing and how to point at it', async () => {
  const empty = await fixture({});
  await withEnv({SHARP_DIR: empty.root}, () => assert.rejects(assets({root: repo}), /sharp.*SHARP_DIR/));
  await empty.cleanup();
});
