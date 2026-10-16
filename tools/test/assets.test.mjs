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
