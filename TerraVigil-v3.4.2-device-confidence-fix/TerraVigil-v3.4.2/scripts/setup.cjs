'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { root, run, npm, requireNode, pythonForSetup } = require('./runtime.cjs');
try {
  requireNode();
  if (!process.argv.includes('--model-only')) {
    const environment = path.join(root, 'backend/.env');
    if (!fs.existsSync(environment)) fs.copyFileSync(path.join(root, 'backend/.env.example'), environment);
    console.log('Installing backend dependencies…');
    process.env.ONNXRUNTIME_NODE_INSTALL ||= 'skip'; // CPU ONNX is already bundled.
    npm(['ci', '--no-audit', '--no-fund'], path.join(root, 'backend'));
    if (process.argv.includes('--dev') || !fs.existsSync(path.join(root, 'frontend/dist/index.html'))) {
      console.log('Installing and building the frontend…');
      npm(['ci', '--no-audit', '--no-fund'], path.join(root, 'frontend'));
      npm(['run', 'build'], path.join(root, 'frontend'));
    }
  }
  const python = pythonForSetup();
  const venv = path.join(root, '.venv');
  const executable = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(executable)) run(python.executable, [...python.args, '-m', 'venv', venv]);
  run(executable, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  console.log('Installing Firebase and Pixhawk telemetry support…');
  run(executable, ['-m', 'pip', 'install', '-r', path.join(root, 'telemetry/requirements.txt')]);
  if (process.argv.includes('--model-only')) {
  console.log('Installing the optional CPU inference runtime…');
  run(executable, ['-m', 'pip', 'install', 'torch==2.8.0', 'torchvision==0.23.0', ...(process.platform === 'darwin' ? [] : ['--index-url', 'https://download.pytorch.org/whl/cpu'])]);
  run(executable, ['-m', 'pip', 'install', '-r', path.join(root, 'inference/requirements.txt')]);
  run(executable, [path.join(root, 'inference/predict.py'), '--check']);
  }
  console.log('\nSetup complete. Place serviceAccountKey.json in backend, then run npm start.');
  console.log('Open Firebase & telemetry to check the Firebase connection and GPS matching. Gemini is optional for assistant answers.');
} catch (error) { console.error(`\nSetup stopped: ${error.message}`); process.exitCode = 1; }
