import test from 'node:test';
import assert from 'node:assert/strict';
import syntax from '../checks/syntax.mjs';
import {fixture} from './helpers.mjs';

test('passes when every script parses', async () => {
  const f = await fixture({'a.mjs': 'export const a = 1;', 'b.js': 'var b = 1;', 'sub/c.mjs': 'import {a} from "../a.mjs"; a;'});
  await syntax({root: f.root});
  await f.cleanup();
});

test('a duplicate import fails and names the script', async () => {
  const f = await fixture({'ok.mjs': 'export {}', 'sub/bad.mjs': 'import {a} from "x"; import {a} from "y";'});
  await assert.rejects(syntax({root: f.root}), /sub\/bad\.mjs/);
  await f.cleanup();
});

test('a broken classic script fails and names the script', async () => {
  const f = await fixture({'old.js': 'function ('});
  await assert.rejects(syntax({root: f.root}), /old\.js/);
  await f.cleanup();
});

test('ignores node_modules and tools', async () => {
  const f = await fixture({'node_modules/x/i.js': 'function (', 'tools/t.mjs': 'function ('});
  await syntax({root: f.root});
  await f.cleanup();
});
