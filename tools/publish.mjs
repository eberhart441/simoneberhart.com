// Publishes changed files to the live site: copy, stage, show status, commit, push, wait for the build, compare live.
//   node tools/publish.mjs [--from <folder>] [--dry-run] [--no-push] -m "message" file...
// Source folder: --from, else $SITE_SOURCE, else the old working copy. --dry-run stops before the commit, --no-push after it.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertDeployClone} from './publish/guard.mjs';
import {copyFiles} from './publish/copy.mjs';
import {bumpTags} from './publish/cachebust.mjs';
import {assertWhitelisted, stage} from './publish/stage.mjs';
import {git} from './publish/git.mjs';
import {waitForBuild, compareLive} from './publish/deploy.mjs';

export const ATTRIBUTION = 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>';
const DEFAULT_SOURCE = 'C:\\Users\\simon\\Documents\\personal_website_redo\\physarum-redo\\portfolio';

// Every outside effect is a parameter, so tests can run the flow against a throwaway repo and fake the build and the live site.
export async function publish({root, source, files, message, dryRun = false, noPush = false, origin, log = console.log, build = {}, live = {}}) {
  if (!files.length) throw new Error('Name the files to publish.');
  if (!message) throw new Error('Give a commit message with -m.');
  await assertDeployClone({root, origin});
  await assertWhitelisted(root, files);
  await copyFiles({source, root, files});
  const bumped = await bumpTags({root, files});
  if (bumped.length) log(`New cache tags in index.html for: ${bumped.join(', ')}`);
  const status = await stage(root, files, {bumped: bumped.length > 0});
  log(status || '(no changes)');
  if (!status) throw new Error('Nothing changed: the listed files already match the repository.');
  if (dryRun) { log('Dry run: stopped before the commit.'); return null; }
  await git(root, 'commit', '-m', `${message}\n\n${ATTRIBUTION}`);
  const sha = await git(root, 'rev-parse', 'HEAD');
  if (noPush) { log(`Committed ${sha.slice(0, 7)}; not pushing.`); return sha; }
  await git(root, 'push', 'origin', 'HEAD');
  log(`Pushed ${sha.slice(0, 7)}; waiting for the Pages build...`);
  await waitForBuild({sha, ...build});
  await compareLive({files, local: f => readFile(path.join(root, f)), ...live});
  log('Live site matches.');
  return sha;
}

export function parseArgs(argv, env = process.env) {
  const o = {files: [], source: env.SITE_SOURCE || DEFAULT_SOURCE, message: '', dryRun: false, noPush: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') o.source = argv[++i];
    else if (a === '-m') o.message = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-push') o.noPush = true;
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
    else o.files.push(a);
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try { await publish({root, ...parseArgs(process.argv.slice(2))}); }
  catch (e) { console.error(`publish failed: ${e.message}`); process.exit(1); }
}
