#!/usr/bin/env node
/**
 * Minimal static file server for local development (no dependencies).
 *
 * Why: ES modules and fetch() do not work from file:// URLs, so the site
 * must be served over HTTP even locally. GitHub Pages does this in production.
 *
 *   node tools/dev-server.mjs            # http://127.0.0.1:5173
 *   PORT=8080 node tools/dev-server.mjs
 *
 * Binds to 127.0.0.1 only, so it is not reachable from other machines.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Never serve these, even locally.
const BLOCKED = [/(^|[\\/])\./, /[\\/]node_modules[\\/]/, /[\\/]supabase[\\/]\.temp/];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = normalize(join(ROOT, pathname));
    // Path traversal guard: the resolved path must stay inside ROOT.
    if (!filePath.startsWith(ROOT + sep) || BLOCKED.some((re) => re.test(filePath.slice(ROOT.length)))) {
      return send(res, 403, 'Forbidden');
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) return send(res, 404, `Not found: ${pathname}`);

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
    log(200, pathname);
  } catch (err) {
    console.error(err);
    send(res, 500, 'Server error');
  }
});

function send(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
  log(status, message);
}

function log(status, what) {
  console.log(`${new Date().toISOString().slice(11, 19)}  ${status}  ${what}`);
}

server.listen(PORT, HOST, () => {
  console.log(`School Resource Hub dev server: http://${HOST}:${PORT}/`);
});
