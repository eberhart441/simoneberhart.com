// Shared by the publish tests: a throwaway clone with a local bare repo as origin, in the OS temp folder.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

export const sh = (cwd, ...a) => execFileSync('git', a, {cwd, encoding: 'utf8'}).trim();
export const GITIGNORE = '/*\n!/.gitignore\n!/index.html\n!/img/\n/img/*\n!/img/*.png\n';

export function fixture() {
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
export const done = f => rmSync(f.dir, {recursive: true, force: true});

