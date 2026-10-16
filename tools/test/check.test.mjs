import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {cp, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const check = root => spawnSync(process.execPath, [path.join(repo, 'tools/check.mjs'), '--root', root], {encoding: 'utf8'});

test('passes on the live site and exits zero', () => {
  const r = check(repo);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a broken script makes it fail, naming the script and the check', async () => {
  const copy = await mkdtemp(path.join(tmpdir(), 'site-'));
  await cp(repo, copy, {recursive: true, filter: src => !/node_modules|[\/]\.git([\/]|$)/.test(src)});
  await writeFile(path.join(copy, 'liquid.mjs'), 'import {a} from "x"; import {a} from "y";');
  const r = check(copy);
  await rm(copy, {recursive: true, force: true});
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /FAIL\s+syntax.*liquid\.mjs/);
  assert.match(r.stdout, /FAIL\s+page/);   // the page check runs anyway and also sees the error
});
