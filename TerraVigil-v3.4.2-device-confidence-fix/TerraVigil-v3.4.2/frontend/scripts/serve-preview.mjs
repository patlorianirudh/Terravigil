#!/usr/bin/env node
/** Serve a prebuilt TerraVigil SPA with deep-link fallback. No npm packages needed. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = process.argv[2] ?? 'dist';
const root = path.resolve(projectRoot, directory);
const port = Number(process.argv[3] ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Supply a valid port from 1 to 65535.');
}
try {
  await fs.access(path.join(root, 'index.html'));
} catch {
  throw new Error(
    `No build found in ${directory}. Run npm ci, then npm run build:demo (or npm run build for live mode).`,
  );
}
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    let target = path.resolve(root, `.${pathname}`);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    try {
      const info = await fs.stat(target);
      if (info.isDirectory()) target = path.join(target, 'index.html');
    } catch {
      // Routes have no file extension. Missing assets remain a real 404.
      if (!path.extname(pathname)) target = path.join(root, 'index.html');
    }
    const body = await fs.readFile(target);
    response.writeHead(200, {
      'Content-Type': types[path.extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 404);
    response.end(error instanceof URIError ? 'Bad request' : 'Not found');
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(
    `TerraVigil preview: http://127.0.0.1:${port}\nServing ${directory}. Press Ctrl+C to stop.`,
  );
});
