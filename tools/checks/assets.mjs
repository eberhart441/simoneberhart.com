// The existing drawing-asset check (ported from studies/verify-assets.mjs): each video is 1280x1280 at 60 fps, as long as the manifest says,
// decodes, and has a transparent background with ink on it. Needs ffprobe/ffmpeg (on PATH, in FFMPEG_DIR, or the winget install) and sharp.
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';

const FPS = 60;
const SHARP = 'C:/Users/simon/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp';
const WINGET = 'C:/Users/simon/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin';

// FFMPEG_DIR, when set, is the only place looked in: an override that is silently ignored would hide a wrong path.
function findExecutable(name) {
  const candidates = process.env.FFMPEG_DIR ? [path.join(process.env.FFMPEG_DIR, name)] : [name, path.join(WINGET, name)];
  for (const c of candidates) if (spawnSync(c, ['-version']).status === 0) return c;
  throw new Error(`assets: the drawing-asset check needs ${name} but could not find it; put ffmpeg on PATH or set FFMPEG_DIR to its bin folder.`);
}

function loadSharp() {
  const where = process.env.SHARP_DIR || SHARP;
  try { return createRequire(import.meta.url)(where); }
  catch { throw new Error(`assets: the drawing-asset check needs sharp but could not load it from ${where}; set SHARP_DIR to the folder of the sharp package.`); }
}

export default async function ({root}) {
  const ffprobe = findExecutable('ffprobe'), ffmpeg = findExecutable('ffmpeg'), sharp = loadSharp();
  const manifest = JSON.parse(await readFile(path.join(root, 'studies/assets/manifest.json'), 'utf8'));
  for (const study of manifest) {
    for (const key of ['video', 'opening', 'poster']) await access(path.join(root, study[key])).catch(() => { throw new Error(`assets: ${study.id} is missing ${study[key]}`); });
    const file = path.join(root, study.video);
    const probe = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', file], {encoding: 'utf8'});
    assert.equal(probe.status, 0, `assets: ${study.id}: ${probe.stderr}`);
    const info = JSON.parse(probe.stdout), v = info.streams[0];
    assert.equal(v.width, 1280, `assets: ${study.id} width`);
    assert.equal(v.height, 1280, `assets: ${study.id} height`);
    assert.equal(v.r_frame_rate, `${FPS}/1`, `assets: ${study.id} frame rate`);
    assert(Math.abs(Number(info.format.duration) - study.duration) < .05, `assets: ${study.id} duration differs from the manifest`);
    const frame = spawnSync(ffmpeg, ['-v', 'error', '-c:v', 'libvpx-vp9', '-ss', String(study.duration / 2), '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], {maxBuffer: 20 * 1024 * 1024});
    assert.equal(frame.status, 0, `assets: ${study.id} does not decode: ${frame.stderr}`);
    const raw = await sharp(frame.stdout).ensureAlpha().raw().toBuffer();
    let clear = 0, drawn = 0;
    for (let i = 3; i < raw.length; i += 4) raw[i] ? drawn++ : clear++;
    assert(clear > raw.length / 8, `assets: ${study.id} has no transparent background`);
    assert(drawn > 100, `assets: ${study.id} middle frame is empty`);
  }
}
