// Refuses to publish from anything but the deploy clone: pushing from the old working copy or a fork would go to the wrong place.
import path from 'node:path';
import {git} from './git.mjs';

export const DEPLOY_ORIGIN = /github\.com[:/]eberhart441\/simoneberhart\.com(\.git)?\/?$/;

export async function assertDeployClone({root, origin = DEPLOY_ORIGIN}) {
  const top = await git(root, 'rev-parse', '--show-toplevel').catch(() => null);
  if (!top || path.resolve(top) !== path.resolve(root)) {
    throw new Error(`Refusing to publish: ${root} is not the root of a git clone. Run this from the deploy clone of eberhart441/simoneberhart.com.`);
  }
  const url = await git(root, 'remote', 'get-url', 'origin').catch(() => '');
  if (!origin.test(url)) {
    throw new Error(`Refusing to publish: origin is "${url || 'missing'}", not eberhart441/simoneberhart.com. This is the wrong clone; run the command from the deploy clone.`);
  }
  const branch = await git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') throw new Error(`Refusing to publish: the deploy clone is on "${branch}", but Pages serves main.`);
}
