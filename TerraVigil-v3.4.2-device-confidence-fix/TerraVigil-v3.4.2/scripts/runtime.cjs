'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function requireNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 22 && minor >= 12) || major === 24)) throw new Error('Install Node.js 22.12+ (22.x) or Node.js 24, then retry.');
}
function run(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, stdio: 'inherit', windowsHide: false, shell: false });
  if (result.error) throw new Error(`Could not run ${path.basename(executable)}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${path.basename(executable)} exited with code ${result.status}. Fix the error above and rerun setup; your existing data is preserved.`);
}
function npm(args, cwd = root) {
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  const cli = candidates.find(file => file && fs.existsSync(file));
  if (!cli) throw new Error('Run this command through npm so its CLI can be found.');
  run(process.execPath, [cli, ...args], cwd);
}
function pythonForSetup() {
  const candidates = process.env.INFERENCE_PYTHON ? [[process.env.INFERENCE_PYTHON, []]] :
    [...(process.platform === 'win32' ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.10']]] : []), ['python3.12', []], ['python3.11', []], ['python3', []], ['python', []]];
  for (const [executable, args] of candidates) {
    const result = spawnSync(executable, [...args, '-c', 'import sys; print(str(sys.version_info.major)+"."+str(sys.version_info.minor))'], { encoding: 'utf8', windowsHide: true, shell: false });
    if (result.status === 0 && /^3\.(10|11|12)\s*$/.test(result.stdout)) return { executable, args };
  }
  throw new Error('Python 3.10–3.12 was not found. Install Python 3.12 with Add Python to PATH enabled, reopen the terminal, and rerun npm run setup.');
}
module.exports = { root, run, npm, requireNode, pythonForSetup };
