// Thin git wrapper. Every call runs in the given repo and throws with git's own message on failure.
import {execFile} from 'node:child_process';

export function git(root, ...args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', root, ...args], {maxBuffer: 64 * 1024 * 1024}, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')} failed: ${(stderr || err.message).trim()}`));
      else resolve(stdout.trim());
    });
  });
}
