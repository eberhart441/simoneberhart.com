// The whitelist check (before anything is copied) and staging (after), so the owner sees exactly what gets committed.
import {git} from './git.mjs';

// Refuses, naming the files, when the whitelist .gitignore would keep a requested file out.
// check-ignore works on paths that do not exist yet, so this can run before the copy and a refusal changes nothing.
export async function assertWhitelisted(root, files) {
  const out = [];
  for (const f of files) {
    // check-ignore exits 1 when the path is not ignored, which git() reports as a throw.
    const hit = await git(root, 'check-ignore', '-q', '--', f).then(() => true, () => false);
    if (hit) out.push(f);
  }
  if (out.length) throw new Error(`Left out by the whitelist in .gitignore (add an entry for it, then run again): ${out.join(', ')}`);
}

// Stages everything, then refuses (staging nothing back out) if that picked up anything beyond the requested files
// (and index.html when cache tags were bumped): unrelated edits must not ride along unseen.
export async function stage(root, files, {bumped = false} = {}) {
  await git(root, 'add', '-A');
  const expected = new Set([...files, ...(bumped ? ['index.html'] : [])]);
  const extra = (await git(root, 'diff', '--cached', '--name-only')).split('\n').filter(Boolean).filter(f => !expected.has(f));
  if (extra.length) throw new Error(`Staged files you did not ask to publish: ${extra.join(', ')}. Nothing was committed; commit or discard them (they are staged now), then run again.`);
  return git(root, 'status', '--short');
}
