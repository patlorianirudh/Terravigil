'use strict';

// Zero-install sample launcher: only Node built-ins and the bundled route engine.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { dispatchSample } = require('./sample/service');
const frontend = path.resolve(__dirname, '../frontend/dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json' };

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function createSampleServer() {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    const parsed = new URL(req.url, 'http://localhost');
    // /api is used by the compiled UI; root paths also serve the Vite adapter.
    const apiRequest = parsed.pathname.startsWith('/api/') ||
      /^\/(health|missions|sample-mission|detections|observations|telemetry)(\/|$)/.test(parsed.pathname) && !req.headers.accept?.includes('text/html');
    if (apiRequest) {
      let body;
      try {
        let content = ''; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32768) { json(res, 413, { message: 'Request body is too large.' }); return; }
          content += chunk;
        }
        if (content) body = JSON.parse(content);
      } catch { return json(res, 400, { code: 'INVALID_REQUEST', message: 'Provide a valid JSON body.' }); }
      try {
        const url = req.url.startsWith('/api/') ? req.url.slice(4) : req.url;
        const result = dispatchSample(req.method, url, body, { exclusive: true });
        return json(res, result.status, result.body);
      } catch { return json(res, 500, { message: 'The simulated request could not be completed.' }); }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { message: 'Method not allowed.' });
    let pathname;
    try { pathname = decodeURIComponent(parsed.pathname); }
    catch { return json(res, 400, { message: 'Invalid URL.' }); }
    let file = path.resolve(frontend, '.' + pathname);
    if (file !== frontend && !file.startsWith(frontend + path.sep)) return json(res, 404, { message: 'Not found.' });
    if (!path.extname(file) || file === frontend) file = path.join(frontend, 'index.html');
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) return json(res, 404, { message: 'Build not found. Use frontend npm run build, or open TerraVigil-preview.html.' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createSampleServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Stop the other TerraVigil backend and try again.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`TerraVigil sample: http://localhost:${port}`);
    console.log('One simulated mission. MongoDB, seeding, API keys and hardware are not used.');
  });
}
module.exports = { createSampleServer };
