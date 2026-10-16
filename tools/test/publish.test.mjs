// Publish tests run against a throwaway clone (local bare repo as origin) in the OS temp folder, never the real remote.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {publish, ATTRIBUTION} from '../publish.mjs';
import {waitForBuild, compareLive} from '../publish/deploy.mjs';

const sh = (cwd, ...a) => execFileSync('git', a, {cwd, encoding: 'utf8'}).trim();
const GITIGNORE = '/*\n!/.gitignore\n!/index.html\n!/img/\n/img/*\n!/img/*.png\n';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'publish-test-'));
  const bare = path.join(dir, 'origin.git'), root = path.join(dir, 'clone'), source = path.join(dir, 'old');
  mkdirSync(root); mkdirSync(source);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 't@example.com'); sh(root, 'config', 'user.name', 't');
  sh(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), GITIGNORE);
  writeFileSync(path.join(root, 'index.html'), 'old\n');
  sh(root, 'add', '-A'); sh(root, 'commit', '-qm', 'start');
  sh(root, 'remote', 'add', 'origin', bare);
  sh(root, 'push', '-q', 'origin', 'main');
  return {dir, bare, root, source, origin: new RegExp('origin\\.git$'), log: () => {}};
}
const done = f => rmSync(f.dir, {recursive: true, force: true});

test('refuses to run in a clone whose origin is not the site repository', async () => {
  const f = fixture();
  writeFileSync(path.join(f.source, 'index.html'), 'new\n');
  await assert.rejects(publish({...f, origin: undefined, files: ['index.html'], message: 'm'}), /wrong clone/);
  done(f);
});

test('refuses to run where the clone root is not the repository root', async () => {
  const f = fixture();
  const sub = path.join(f.root, 'sub'); mkdirSync(sub);
  await assert.rejects(publish({...f, root: sub, files: ['index.html'], message: 'm'}), /not the root of a git clone/);
  done(f);
});

test('strips carriage returns so the diff shows only real changes', async () => {
  const f = fixture();
  writeFileSync(path.join(f.source, 'index.html'), 'old\r\nadded\r\n');
  await publish({...f, files: ['index.html'], message: 'm', dryRun: true});
  assert.equal(readFileSync(path.join(f.root, 'index.html'), 'utf8'), 'old\nadded\n');
  assert.equal(sh(f.root, 'diff', '--cached', '--numstat'), '1\t0\tindex.html');
  done(f);
});

test('leaves binary files untouched', async () => {
  const f = fixture();
  mkdirSync(path.join(f.source, 'img'));
  const png = Buffer.from([0x89, 0x50, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(path.join(f.source, 'img', 'a.png'), png);
  await publish({...f, files: ['img/a.png'], message: 'm', dryRun: true});
  assert.deepEqual(readFileSync(path.join(f.root, 'img', 'a.png')), png);
  done(f);
});

test('a file the whitelist leaves out stops the run and is named', async () => {
  const f = fixture();
  mkdirSync(path.join(f.source, 'newfolder'));
  writeFileSync(path.join(f.source, 'newfolder', 'page.html'), 'x\n');
  await assert.rejects(publish({...f, files: ['newfolder/page.html'], message: 'm'}), /newfolder\/page\.html/);
  assert.equal(sh(f.root, 'status', '--short'), '');
  done(f);
});

test('shows the status before committing; the commit ends with the attribution and nothing is pushed', async () => {
  const f = fixture();
  writeFileSync(path.join(f.source, 'index.html'), 'new\r\n');
  const lines = [];
  const sha = await publish({...f, files: ['index.html'], message: 'Change the page', noPush: true, log: l => lines.push(l)});
  assert.match(lines[0], /M\s+index\.html/);
  assert.ok(sha);
  assert.equal(sh(f.root, 'log', '-1', '--format=%B').split('\n').filter(Boolean).pop(), ATTRIBUTION);
  assert.equal(sh(f.root, 'log', '-1', '--format=%s'), 'Change the page');
  assert.notEqual(sh(f.root, 'rev-parse', 'HEAD'), sh(f.bare, 'rev-parse', 'main'));
  done(f);
});

test('full flow pushes to the local origin, waits for the build of that commit and compares the live file', async () => {
  const f = fixture();
  writeFileSync(path.join(f.source, 'index.html'), 'new\r\n');
  let seen;
  const sha = await publish({...f, files: ['index.html'], message: 'm',
    build: {getBuild: async () => ({status: 'built', commit: sh(f.bare, 'rev-parse', 'main')}), wait: async () => {}},
    live: {fetchFile: async file => { seen = file; return Buffer.from('new\n'); }, wait: async () => {}}});
  assert.equal(sh(f.bare, 'rev-parse', 'main'), sha);
  assert.equal(seen, 'index.html');
  done(f);
});

test('a live file that differs fails the publish', async () => {
  const f = fixture();
  writeFileSync(path.join(f.source, 'index.html'), 'new\n');
  await assert.rejects(publish({...f, files: ['index.html'], message: 'm',
    build: {getBuild: async () => ({status: 'built', commit: sh(f.bare, 'rev-parse', 'main')}), wait: async () => {}},
    live: {fetchFile: async () => Buffer.from('stale\n'), wait: async () => {}}}), /index\.html/);
  done(f);
});

test('waitForBuild ignores builds of other commits and returns when this one is built', async () => {
  const seq = [{status: 'built', commit: 'old'}, {status: 'building', commit: 'abc1234'}, {status: 'built', commit: 'abc1234'}];
  const b = await waitForBuild({sha: 'abc1234', getBuild: async () => seq.shift(), wait: async () => {}});
  assert.equal(b.status, 'built');
  assert.equal(seq.length, 0);
});

test('a build error is reported as a failure', async () => {
  await assert.rejects(waitForBuild({sha: 'abc1234', getBuild: async () => ({status: 'errored', commit: 'abc1234', error: 'boom'}), wait: async () => {}}), /failed: boom/);
});

test('a build that never finishes times out', async () => {
  let t = 0;
  await assert.rejects(waitForBuild({sha: 'abc1234', timeoutMs: 100, getBuild: async () => ({status: 'building', commit: 'abc1234'}), wait: async () => { t += 60; }, now: () => t}), /did not finish/);
});

test('compareLive retries while the live file lags, then passes', async () => {
  const answers = [Buffer.from('old'), Buffer.from('new')];
  await compareLive({files: ['a.html'], local: async () => Buffer.from('new'), fetchFile: async () => answers.shift(), wait: async () => {}});
  assert.equal(answers.length, 0);
});

test('compareLive reports a missing live file', async () => {
  await assert.rejects(compareLive({files: ['a.html'], local: async () => Buffer.from('x'), fetchFile: async () => { throw new Error('HTTP 404'); }, wait: async () => {}, tries: 2}), /a\.html \(HTTP 404\)/);
});
