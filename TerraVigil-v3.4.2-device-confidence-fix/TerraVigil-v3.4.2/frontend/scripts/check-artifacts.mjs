#!/usr/bin/env node
/** Verify launch packaging and HTTP behavior. This does not claim visual browser testing. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const launcher = source.match(
  /<!-- source-file-launch:start -->\s*<script>([\s\S]*?)<\/script>/,
)?.[1];
assert.ok(launcher, 'Source index must provide a file launcher');
let redirect = null;
vm.runInNewContext(launcher, {
  URL,
  window: {
    location: {
      protocol: 'file:',
      href: 'file:///a%20folder/frontend/index.html',
      hash: '#/detections',
      replace(value) {
        redirect = value;
      },
    },
  },
});
assert.equal(redirect, 'file:///a%20folder/frontend/TerraVigil-preview.html#/detections');
redirect = null;
vm.runInNewContext(launcher, {
  URL,
  window: {
    location: {
      protocol: 'http:',
      href: 'http://localhost:5173/',
      hash: '',
      replace(value) {
        redirect = value;
      },
    },
  },
});
assert.equal(redirect, null, 'Development HTTP entry must remain the application');

const standalone = await fs.readFile(path.join(root, 'TerraVigil-preview.html'), 'utf8');
assert.ok(!/<script[^>]+src=/i.test(standalone), 'Standalone scripts must be embedded');
assert.ok(!/<link[^>]+rel=["']stylesheet/i.test(standalone), 'Standalone styles must be embedded');
const scripts = [...standalone.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length >= 2, 'Expected a hash initializer and application bundle');
for (const [, script] of scripts) new vm.Script(script);
const css = standalone.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
assert.ok(css.length > 1000);
assert.ok(!/@tailwind\s/.test(css), 'Tailwind must be compiled');
for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
  assert.ok(/^["']?(data:|#)/.test(match[1]), `Non-embedded CSS asset: ${match[1].slice(0, 80)}`);
}
assert.ok(standalone.includes('+ "#/"'), 'Standalone must open Operations');

for (const directory of ['dist', 'dist-demo']) {
  const html = await fs.readFile(path.join(root, directory, 'index.html'), 'utf8');
  assert.ok(
    !html.includes('source-file-launch:start'),
    'A served build must not silently select demo mode',
  );
  assert.ok(!html.includes('/src/main.tsx'), 'A served build must contain compiled JavaScript');
  for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) {
    await fs.access(path.join(root, directory, asset));
  }
}

const child = spawn(
  process.execPath,
  [path.join(root, 'scripts/serve-preview.mjs'), 'dist-demo', '4179'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);
const close = once(child, 'exit');
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});
try {
  await Promise.race([
    once(child.stdout, 'data'),
    close.then(() => {
      throw new Error(`Preview server exited: ${stderr}`);
    }),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview server startup timed out')), 8000);
      timer.unref();
    }),
  ]);
  for (const route of [
    '/',
    '/briefing',
    '/live',
    '/sessions/example',
    '/detections/example',
    '/risk-map',
    '/route',
    '/reports',
    '/settings',
  ]) {
    const response = await fetch(`http://127.0.0.1:4179${route}`);
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).includes('id="root"'), route);
  }
  assert.equal((await fetch('http://127.0.0.1:4179/missing.js')).status, 404);
  assert.equal((await fetch('http://127.0.0.1:4179/', { method: 'POST' })).status, 405);
  assert.equal((await fetch('http://127.0.0.1:4179/', { method: 'HEAD' })).status, 200);
} finally {
  child.kill();
  await close;
}
console.log(
  'PASS: source file launcher, embedded standalone, served asset references, nine deep links, 404, 405, HEAD.',
);
