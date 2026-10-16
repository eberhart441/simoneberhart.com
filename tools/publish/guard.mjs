// Refuses to publish from anything but the deploy clone: pushing from the old working copy or a fork would go to the wrong place.
import path from 'node:path';
import {git} from './git.mjs';

// Git prints forward slashes and may spell the drive letter differently from the path we were given; Windows paths ignore case.
const same = (a, b) => {
  const norm = p => { const r = path.resolve(p).split(path.sep).join('/'); return process.platform === 'win32' ? r.toLowerCase() : r; };
  return norm(a) === norm(b);
};

export const DEPLOY_ORIGIN = /github\.com[:/]eberhart441\/simoneberhart\.com(\.git)?\/?$/;

export async function assertDeployClone({root, origin = DEPLOY_ORIGIN}) {
  const top = await git(root, 'rev-parse', '--show-toplevel').catch(() => null);
  if (!top || !same(top, root)) {
    throw new Error(`Refusing to publish: ${root} is not the root of a git clone. Run this from the deploy clone of eberhart441/simoneberhart.com.`);
  }
  const url = await git(root, 'remote', 'get-url', 'origin').catch(() => '');
  if (!origin.test(url)) {
    throw new Error(`Refusing to publish: origin is "${url || 'missing'}", not eberhart441/simoneberhart.com. This is the wrong clone; run the command from the deploy clone.`);
  }
  const branch = await git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') throw new Error(`Refusing to publish: the deploy clone is on "${branch}", but Pages serves main.`);
}
