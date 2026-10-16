// npm run check: runs every tools/checks/*.mjs against the site and says what failed.
//   node tools/check.mjs [--root dir] [--url http://localhost:4340/]
// Without --url it serves the root itself and stops again afterwards.
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {serve} from './lib/serve.mjs';
import {launch} from './lib/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const root = path.resolve(option('root') || path.join(here, '..'));

const server = option('url') ? null : await serve({root});
const ctx = {root, baseUrl: option('url') || server.url, launch};
const failures = [];
try {
  for (const file of (await readdir(path.join(here, 'checks'))).filter(f => f.endsWith('.mjs')).sort()) {
    const name = file.replace(/\.mjs$/, '');
    try {
      await (await import(pathToFileURL(path.join(here, 'checks', file)).href)).default(ctx);
      console.log(`ok    ${name}`);
    } catch (e) {
      failures.push(name);
      console.log(`FAIL  ${name}: ${e.message}`);
    }
  }
} finally { await server?.close(); }

if (failures.length) { console.log(`\ncheck failed: ${failures.join(', ')}`); process.exit(1); }
console.log('\ncheck passed');
