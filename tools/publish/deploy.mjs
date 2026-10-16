// After the push: wait for the Pages build of that exact commit, then compare the live files with the local ones.
import {execFile} from 'node:child_process';

const REPO = 'eberhart441/simoneberhart.com';
export const LIVE = 'https://simoneberhart.com/';

// Real build lookup through gh. Returns {status, commit, error} for the latest build.
export function latestBuild() {
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', `repos/${REPO}/pages/builds/latest`], {shell: process.platform === 'win32'}, (err, out) => {
      if (err) return reject(new Error(`gh could not read the Pages build: ${err.message}`));
      const b = JSON.parse(out);
      resolve({status: b.status, commit: b.commit, error: b.error?.message || null});
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function waitForBuild({sha, getBuild = latestBuild, wait = sleep, timeoutMs = 10 * 60_000, intervalMs = 10_000, now = Date.now}) {
  const start = now();
  for (;;) {
    const b = await getBuild();
    if (b.commit === sha) {
      if (b.status === 'built') return b;
      if (b.status === 'errored') throw new Error(`The Pages build of ${sha.slice(0, 7)} failed: ${b.error || 'no message'}`);
    }
    if (now() - start >= timeoutMs) throw new Error(`The Pages build of ${sha.slice(0, 7)} did not finish within ${Math.round(timeoutMs / 1000)}s (latest: ${b.status} for ${String(b.commit).slice(0, 7)}).`);
    await wait(intervalMs);
  }
}

async function fetchLive(file) {
  const res = await fetch(`${LIVE}${file}?nocache=${Date.now()}`, {headers: {'cache-control': 'no-cache'}});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// local: async (file) => Buffer. The CDN can lag the build briefly, so a mismatch is retried before failing.
export async function compareLive({files, local, fetchFile = fetchLive, wait = sleep, tries = 6, intervalMs = 5_000}) {
  const bad = [];
  for (const f of files) {
    const want = await local(f);
    let ok = false, why = '';
    for (let i = 0; i < tries && !ok; i++) {
      if (i) await wait(intervalMs);
      try { ok = (await fetchFile(f)).equals(want); why = ok ? '' : 'differs from the local file'; } catch (e) { why = e.message; }
    }
    if (!ok) bad.push(`${f} (${why})`);
  }
  if (bad.length) throw new Error(`Live site does not match the local files: ${bad.join(', ')}`);
}
