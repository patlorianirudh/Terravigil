'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { root, run } = require('./runtime.cjs');
try {
  require(path.join(root, 'backend/node_modules/dotenv')).config({ path: path.join(root, 'backend/.env'), quiet: true });
  const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = process.env.TELEMETRY_PYTHON || (fs.existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3');
  const check = process.argv.includes('--check');
  run(python, ['-u', path.join(root, check ? 'telemetry/firebase_test.py' : 'telemetry/drone_metrics_forwarded.py')]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
