// Copies the listed files from the source folder into the repo. Text files lose their carriage returns
// (the repo is LF; the old working copy is CRLF), so diffs show only real changes.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const TEXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.md', '.txt']);

export async function copyFiles({source, root, files}) {
  if (path.resolve(source) === path.resolve(root)) throw new Error('The source folder is the deploy clone itself; point --from at the working copy.');
  for (const f of files) {
    if (path.isAbsolute(f) || f.split(/[\\/]/).includes('..')) throw new Error(`File must be a relative path inside the site: ${f}`);
    const data = await readFile(path.join(source, f)).catch(() => { throw new Error(`Cannot read ${f} in ${source}`); });
    const out = TEXT.has(path.extname(f).toLowerCase()) ? Buffer.from(data.toString('utf8').replace(/\r\n?/g, '\n')) : data;
    const to = path.join(root, f);
    await mkdir(path.dirname(to), {recursive: true});
    await writeFile(to, out);
  }
}
