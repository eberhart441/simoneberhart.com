import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Makes a throwaway site from {relative path: contents}; returns its root and a cleanup.
export async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'check-'));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), {recursive: true});
    await writeFile(path.join(root, name), text);
  }
  return {root, cleanup: () => rm(root, {recursive: true, force: true})};
}
