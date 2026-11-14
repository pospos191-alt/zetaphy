// Serves dist/ on 127.0.0.1 (static files only) for the browser test; { headers } adds response headers (e.g. the site's CSP);
// { files } answers some paths with given bodies instead of the files ({ '/hub-config.json': '{…}' }); { pathHeaders } replaces
// the headers for some paths ({ '/zkid-worker.js': { … } }, as vercel.json does).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
export function serve(dir, { headers = {}, files = {}, pathHeaders = {} } = {}) {
  const srv = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const own = files[new URL(req.url, 'http://x').pathname];
    if (own != null) { res.writeHead(200, { 'content-type': TYPES[extname(req.url.split('?')[0])] ?? 'application/octet-stream', ...headers }); res.end(own); return; }
    let f = join(dir, p);
    const hd = pathHeaders[new URL(req.url, 'http://x').pathname] ?? headers;
    let body;
    // read first, then write the headers: a missing file (or a directory with no index.html) is a clean 404
    try { if ((await stat(f)).isDirectory()) f = join(f, 'index.html'); body = await readFile(f); }
    catch { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream', ...hd }); res.end(body);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() })));
}
