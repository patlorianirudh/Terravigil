'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { root, requireNode } = require('./runtime.cjs');
try {
  requireNode();
  try { require.resolve('express', { paths: [path.join(root, 'backend')] }); }
  catch { throw new Error('Backend dependencies are missing. Run npm run setup once, then npm start.'); }
  if (!fs.existsSync(path.join(root, 'frontend/dist/index.html'))) throw new Error('The frontend build is missing. Run npm run setup:dev.');
  require('../backend/integrated-server').startServer().catch(error => { console.error(error.message); process.exitCode = 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
