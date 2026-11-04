'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function inferenceError(code, message) { return Object.assign(new Error(message), { code }); }
function timeout(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 50 && number <= 600000 ? number : fallback;
}
function pythonCandidates(explicit) {
  if (explicit) return [{ executable: explicit, args: [] }];
  const candidates = [
    path.join(ROOT, '.venv', 'Scripts', 'python.exe'), path.join(ROOT, '.venv', 'bin', 'python'),
    path.join(ROOT, 'inference', '.venv', 'Scripts', 'python.exe'), path.join(ROOT, 'inference', '.venv', 'bin', 'python'),
  ].filter(filename => fs.existsSync(filename)).map(executable => ({ executable, args: [] }));
  if (process.platform === 'win32') candidates.push({ executable: 'py', args: ['-3'] });
  candidates.push({ executable: 'python3', args: [] }, { executable: 'python', args: [] });
  return candidates;
}
function runProcess(candidate, args, request, milliseconds, env) {
  return new Promise((resolve, reject) => {
    let child; let settled = false; let stdout = ''; let stderr = ''; let size = 0; let timer;
    const finish = (error, payload) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(payload);
    };
    try {
      child = spawn(candidate.executable, [...candidate.args, ...args], {
        cwd: ROOT, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', YOLO_AUTOINSTALL: 'false', YOLO_OFFLINE: 'true' },
      });
    } catch (error) { finish(error); return; }
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(inferenceError('INFERENCE_TIMEOUT', `Model process exceeded ${Math.round(milliseconds / 1000)} seconds. Check the Python runtime or raise the inference timeout.`));
    }, milliseconds);
    child.once('error', error => finish(error));
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL'); finish(inferenceError('INFERENCE_INVALID_OUTPUT', 'Model output exceeded the permitted size.'));
      } else stdout += chunk;
    });
    child.stderr.on('data', chunk => { if (stderr.length < 64000) stderr += chunk.slice(0, 64000 - stderr.length); });
    // Early interpreter exits may close stdin before the JSON request is written.
    child.stdin.on('error', () => {});
    child.once('close', (code, signal) => {
      if (settled) return;
      let payload;
      try { payload = JSON.parse(stdout.trim()); } catch { /* validated below */ }
      if (payload?.ok === false && payload.error && /^INFERENCE_[A-Z_]+$/.test(payload.error.code)) return finish(inferenceError(payload.error.code, String(payload.error.message || 'Model execution failed.').slice(0, 1200)));
      if (code !== 0) {
        const detail = /No module named ['"]([^'"]+)['"]/.exec(stderr);
        return finish(inferenceError('INFERENCE_RUNTIME_UNAVAILABLE', detail
          ? `Python package ${detail[1]} is missing. Install inference/requirements.txt into the selected Python environment.`
          : `Python model process exited ${signal ? `with signal ${signal}` : `with code ${code}`}. Run inference/predict.py --check to diagnose the runtime.`));
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.ok !== true) return finish(inferenceError('INFERENCE_INVALID_OUTPUT', 'Python did not return a valid inference JSON response.'));
      finish(null, payload);
    });
    child.stdin.end(JSON.stringify(request));
  });
}
function createPythonRunner(options = {}) {
  const env = options.env || process.env;
  const candidates = pythonCandidates(options.python ?? env.INFERENCE_PYTHON);
  const scriptPath = options.scriptPath || path.join(ROOT, 'inference', 'predict.py');
  const device = options.device || env.INFERENCE_DEVICE || 'cpu';
  const predictionTimeout = timeout(options.timeoutMs ?? env.INFERENCE_TIMEOUT_MS, 120000);
  const statusTimeout = timeout(options.statusTimeoutMs ?? env.INFERENCE_STATUS_TIMEOUT_MS, 45000);
  let selected;
  async function invoke(request, check) {
    for (const candidate of selected ? [selected] : candidates) {
      try {
        const result = await runProcess(candidate, [scriptPath, ...(check ? ['--check'] : [])], { ...request, device }, check ? statusTimeout : predictionTimeout, env);
        selected = candidate; return result;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    throw inferenceError('INFERENCE_RUNTIME_UNAVAILABLE', 'Python runtime not found. Install Python 3.10–3.12 and inference/requirements.txt, or set INFERENCE_PYTHON to the Python executable.');
  }
  return { predict: request => invoke(request, false), status: () => invoke({}, true) };
}
module.exports = { createPythonRunner, inferenceError };
