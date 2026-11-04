'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { root, requireNode } = require('./runtime.cjs');
try {
  requireNode();
  require(path.join(root, 'backend/node_modules/dotenv')).config({ path: path.join(root, 'backend/.env'), quiet: true });
  const { readBridgeConfig } = require('../backend/bridge/service');
  const config = readBridgeConfig();
  const python = spawnSync(config.python, ['-c', 'import firebase_admin, pymavlink, dotenv; print("ready")'], { encoding: 'utf8', shell: false });
  const results = [
    { component: 'Compiled frontend', ready: fs.existsSync(path.join(root, 'frontend/dist/index.html')) },
    { component: 'Firebase and telemetry Python packages', ready: python.status === 0 },
    { component: 'Firebase credential file', ready: fs.existsSync(config.credentials) },
    { component: 'Telemetry CSV', ready: fs.existsSync(config.csv), optionalBeforeFlight: true },
    { component: 'Gemini assistant key', ready: !!process.env.GEMINI_API_KEY, optional: true },
  ];
  console.log(JSON.stringify(results, null, 2));
  console.log('Use npm run check:firebase for an authenticated read; no cloud data will be written.');
  if (results.some(r => !r.ready && !r.optional && !r.optionalBeforeFlight)) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
