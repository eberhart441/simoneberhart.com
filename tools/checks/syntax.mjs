// Every script the site serves must parse. A syntax error (or a duplicated import) otherwise kills the whole page silently.
import {readdir, readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';

const SKIP = new Set(['node_modules', 'tools', '.git']);

async function* scripts(dir) {
  for (const e of await readdir(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* scripts(p); }
    else if (/\.m?js$/.test(e.name)) yield p;
  }
}

// Returns an error message, or null when the source parses.
function syntaxError(file, source) {
  if (file.endsWith('.js')) {   // a classic <script>; only fall back to module syntax if it is not one
    try { new vm.Script(source, {filename: file}); return null; } catch { /* maybe a module */ }
  }
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], {input: source, encoding: 'utf8'});
  return r.status === 0 ? null : r.stderr.split('\n').find(l => /Error/.test(l))?.trim() || r.stderr.trim();
}

export default async function ({root}) {
  const bad = [];
  for await (const file of scripts(root)) {
    const msg = syntaxError(file, await readFile(file, 'utf8'));
    if (msg) bad.push(`${path.relative(root, file).split(path.sep).join('/')}: ${msg}`);
  }
  if (bad.length) throw new Error(`syntax error in ${bad.join('; ')}`);
}
