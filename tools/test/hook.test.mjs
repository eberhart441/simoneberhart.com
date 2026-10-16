import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {cp, mkdir, mkdtemp, rm, symlink, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A throwaway clone of the site with a local bare remote, so a real `git push` can run without touching the real remote.
async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), 'hook-'));
  const work = path.join(dir, 'work'), remote = path.join(dir, 'remote.git'), globalConfig = path.join(dir, 'global.gitconfig');
  await writeFile(globalConfig, '');
  const env = {...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1'};
  delete env.SKIP_CHECK;
  const run = (cmd, args, opts = {}) => spawnSync(cmd, args, {cwd: work, encoding: 'utf8', env: {...env, ...opts.env}});
  const git = (...args) => { const r = run('git', args); assert.equal(r.status, 0, `git ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r; };
  // Copy exactly what git would track here (tracked + untracked, not ignored), so uncommitted hook files come along.
  const files = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {cwd: repo, encoding: 'utf8'}).stdout.split('\0').filter(Boolean);
  for (const f of files) { await mkdir(path.dirname(path.join(work, f)), {recursive: true}); await cp(path.join(repo, f), path.join(work, f)); }
  await symlink(path.join(repo, 'node_modules'), path.join(work, 'node_modules'), 'junction');
  spawnSync('git', ['init', '--bare', '-b', 'main', remote], {env});
  git('init', '-b', 'main');
  git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-m', 'site');
  git('remote', 'add', 'origin', remote);
  return {dir, work, git, run, globalConfig, cleanup: () => rm(dir, {recursive: true, force: true})};
}
const install = (s, ...flags) => s.run(process.execPath, ['tools/install-hooks.mjs', ...flags]);
const hooksPath = s => s.run('git', ['config', '--local', '--get', 'core.hooksPath']).stdout.trim();

test('install sets this clone only, is idempotent, and uninstall removes it', async () => {
  const s = await sandbox();
  try {
    assert.equal(install(s).status, 0);
    assert.equal(install(s).status, 0);
    assert.equal(hooksPath(s), 'tools/hooks');
    assert.equal(await readFile(s.globalConfig, 'utf8'), '');   // never global
    assert.equal(install(s, '--uninstall').status, 0);
    assert.equal(install(s, '--uninstall').status, 0);
    assert.equal(hooksPath(s), '');
  } finally { await s.cleanup(); }
});

test('a push with a passing site goes through', async () => {
  const s = await sandbox();
  try {
    install(s);
    const r = s.run('git', ['push', 'origin', 'main']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /check passed/);
  } finally { await s.cleanup(); }
});

test('a push with a broken script is blocked and names the failing check and script', async () => {
  const s = await sandbox();
  try {
    install(s);
    await writeFile(path.join(s.work, 'liquid.mjs'), 'import {a} from "x"; import {a} from "y";');
    s.git('commit', '-am', 'break');
    const r = s.run('git', ['push', 'origin', 'main']);
    const out = r.stdout + r.stderr;
    assert.notEqual(r.status, 0);
    assert.match(out, /FAIL\s+syntax.*liquid\.mjs/);
    assert.match(out, /push blocked.*syntax/i);
    assert.notEqual(s.run('git', ['--git-dir', path.join(s.dir, 'remote.git'), 'rev-parse', '--verify', 'main']).status, 0);   // nothing arrived
  } finally { await s.cleanup(); }
});

test('SKIP_CHECK=1 lets a broken site through and says the check was skipped', async () => {
  const s = await sandbox();
  try {
    install(s);
    await writeFile(path.join(s.work, 'liquid.mjs'), 'import {a} from "x"; import {a} from "y";');
    s.git('commit', '-am', 'break');
    const r = s.run('git', ['push', 'origin', 'main'], {env: {SKIP_CHECK: '1'}});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /check SKIPPED/);
  } finally { await s.cleanup(); }
});

test('deleting a remote branch does not run the check', async () => {
  const s = await sandbox();
  try {
    install(s);
    s.git('branch', 'topic');
    assert.equal(s.run('git', ['push', 'origin', 'topic'], {env: {SKIP_CHECK: '1'}}).status, 0);
    await writeFile(path.join(s.work, 'liquid.mjs'), 'import {a} from "x"; import {a} from "y";');   // would fail if checked
    const r = s.run('git', ['push', 'origin', '--delete', 'topic']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /check|FAIL/i);
  } finally { await s.cleanup(); }
});
