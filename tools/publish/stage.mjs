// Stages everything and refuses (naming the files) when the whitelist .gitignore kept a requested file out.
import {git} from './git.mjs';

export async function ignoredFiles(root, files) {
  const out = [];
  for (const f of files) {
    // check-ignore exits 1 when the path is not ignored, which git() reports as a throw.
    const hit = await git(root, 'check-ignore', '-q', '--', f).then(() => true, () => false);
    if (hit) out.push(f);
  }
  return out;
}

export async function stage(root, files) {
  const left = await ignoredFiles(root, files);
  if (left.length) throw new Error(`Left out by the whitelist in .gitignore (add an entry for it, then run again): ${left.join(', ')}`);
  await git(root, 'add', '-A');
  return git(root, 'status', '--short');
}
