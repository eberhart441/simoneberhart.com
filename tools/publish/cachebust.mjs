// Gives every changed, cached file a fresh ?v= tag in index.html so visitors don't get a stale copy from their browser cache.
// The tag is a short hash of the file's content: new for new content, the same for unchanged content.
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {git} from './git.mjs';

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Run after the files are copied and before staging, so the new tags land in the same commit.
export async function bumpTags({root, files}) {
  const page = path.join(root, 'index.html');
  let html = await readFile(page, 'utf8').catch(() => null);
  if (html === null) return [];
  const bumped = [];
  for (const f of files) {
    if (f === 'index.html') continue;
    const pattern = `(["'/]${escapeRegExp(f)}\\?v=)[^"'&\\s]*`;
    if (!new RegExp(pattern).test(html) || !await git(root, 'status', '--porcelain', '--', f)) continue;
    const tag = createHash('sha1').update(await readFile(path.join(root, f))).digest('hex').slice(0, 8);
    html = html.replace(new RegExp(pattern, 'g'), `$1${tag}`);
    bumped.push(f);
  }
  if (bumped.length) await writeFile(page, html);
  return bumped;
}
