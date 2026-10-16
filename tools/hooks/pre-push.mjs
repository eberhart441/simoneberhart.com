// Git pre-push hook: runs the site check and blocks the push when it fails.
// Bypass on purpose with SKIP_CHECK=1 (or git's own --no-verify); the bypass is always announced.
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const say = text => process.stderr.write(text + '\n');

// Git feeds one line per ref: "<local ref> <local sha> <remote ref> <remote sha>". A deleted branch has an all-zero local sha.
let refs = '';
for await (const chunk of process.stdin) refs += chunk;
const pushes = refs.split('\n').filter(Boolean).filter(line => !/^0+$/.test(line.split(' ')[1]));
if (!pushes.length) process.exit(0);   // only deletions: nothing to check

if (process.env.SKIP_CHECK === '1') {
  say('!!! pre-push: check SKIPPED (SKIP_CHECK=1). Nothing verified this push. !!!');
  process.exit(0);
}

say('pre-push: running the check (SKIP_CHECK=1 to bypass)...');
let output = '';
const child = spawn(process.execPath, ['tools/check.mjs'], {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
for (const stream of [child.stdout, child.stderr]) stream.on('data', d => { output += d; process.stderr.write(d); });
const code = await new Promise(resolve => child.on('close', resolve).on('error', () => resolve(1)));

if (code === 0) process.exit(0);
const failed = output.match(/^check failed: (.*)$/m)?.[1] || 'the check did not run to the end (see output above)';
say(`\npre-push: push blocked, failed: ${failed}`);
say('Fix it, or bypass on purpose with SKIP_CHECK=1 git push (or git push --no-verify).');
process.exit(1);
