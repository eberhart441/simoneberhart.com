// A tiny static server for the repository root, for checks and benchmarks.
//   const s = await serve({root, port});   // port 0 = any free port
//   s.url        'http://127.0.0.1:<port>/'
//   await s.close()
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.pdf': 'application/pdf'};

export function serve({root, port = 0} = {}) {
  root = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
      if ((await stat(p).catch(() => null))?.isDirectory()) p = path.join(p, 'index.html');
      const data = await readFile(p);
      res.writeHead(200, {'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store'}).end(data);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(r))}));
  });
}
