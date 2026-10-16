import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import player from '../checks/player.mjs';
import {fixture} from './helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('passes on the live site', async () => { await player({root: repo}); });

test('fails when the player stops following the scroll', async () => {
  const live = await readFile(path.join(repo, 'study-player.mjs'), 'utf8');
  const manifest = await readFile(path.join(repo, 'studies/assets/manifest.json'), 'utf8');
  const f = await fixture({'study-player.mjs': live.replace(/addEventListener\('scroll'/g, "addEventListener('scrollx'"), 'studies/assets/manifest.json': manifest});
  await assert.rejects(player({root: f.root}));
  await f.cleanup();
});
