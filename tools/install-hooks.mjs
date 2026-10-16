// npm run hooks: points this clone at tools/hooks so the pre-push check runs. `--uninstall` undoes it.
// Local config only; the global git config is never touched. Safe to run repeatedly.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => spawnSync('git', args, {cwd: root, encoding: 'utf8'});
const hooks = 'tools/hooks';

if (git('rev-parse', '--git-dir').status !== 0) { console.error('Not a git clone; nothing to install into.'); process.exit(1); }

if (process.argv.includes('--uninstall')) {
  const current = git('config', '--local', '--get', 'core.hooksPath').stdout.trim();
  if (current === hooks) git('config', '--local', '--unset', 'core.hooksPath');
  console.log('pre-push hook not installed in this clone.');
} else {
  const r = git('config', '--local', 'core.hooksPath', hooks);
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  console.log(`pre-push hook installed in this clone (core.hooksPath = ${hooks}). Bypass with SKIP_CHECK=1 git push.`);
}
