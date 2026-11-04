'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const fs = require('node:fs');
const express = require('express');
const { connectDB, closeDB, dataDirectory } = require('./database');
const { removePracticeData, PRACTICE_MISSIONS, DEPLOYMENT } = require('./production-data');
const { seedReferences } = require('./project-references');
const { createRagService } = require('./rag/service');
const { readRagConfig } = require('./rag/config');
const { getGenerationStatus } = require('./rag/generate');
const { getEmbeddingStatus } = require('./rag/embed');
const { createMissionApp } = require('./server');

function createIntegratedApp({ getDB = connectDB, dataDir = dataDirectory(), ragOptions = {} } = {}) {
  const app = express();
  const api = express.Router();
  const preparedDb = Promise.resolve().then(getDB).then(removePracticeData);
  // Startup errors are returned by requests or startServer, never unhandled.
  preparedDb.catch(() => {});
  const readyDB = () => preparedDb;
  const ragService = createRagService({ getDB: readyDB, autoPrepare: true, ...ragOptions });
  const bridgeService = require('./bridge/service').createBridgeService({ getDB: readyDB });
  const inferenceRouter = require('./inference/routes').createInferenceRouter({ getDB: readyDB, dataDir });
  const frontend = path.resolve(__dirname, '../frontend/dist');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Local app: reject browser writes from unrelated sites. No wildcard CORS.
    const origin = req.headers.origin;
    if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      try {
        const supplied = new URL(origin);
        const host = req.headers.host;
        if (supplied.host !== host && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(supplied.hostname) && supplied.port === '5173')) {
          return res.status(403).json({ code: 'ORIGIN_REJECTED', message: 'Use the TerraVigil application on this computer.' });
        }
      } catch { return res.status(403).json({ code: 'ORIGIN_REJECTED', message: 'Invalid request origin.' }); }
    }
    next();
  });
  app.use(express.json({ limit: '15mb' }));
  api.use(async (_req, res, next) => {
    try { await readyDB(); next(); }
    catch { res.status(503).json({ code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable. Check the backend terminal and storage configuration.' }); }
  });
  api.get('/health', (_req, res) => res.json({ status: 'ok', mode: 'integrated', database: process.env.TERRAVIGIL_DB || 'local', dataMode: 'live', hardware: DEPLOYMENT }));
  api.all('/sample-mission', (_req, res) => res.status(410).json({ code: 'PRACTICE_REMOVED', message: 'Practice missions have been removed. Use Firebase & telemetry for captured records.' }));
  api.use((req, res, next) => {
    const missionId = req.body?.mission_id ?? req.body?.sessionId ?? req.path.match(/^\/missions\/([^/]+)/)?.[1];
    if (PRACTICE_MISSIONS.includes(missionId)) return res.status(404).json({ code: 'MISSION_NOT_FOUND', message: 'Practice missions are unavailable in this app.' });
    next();
  });
  api.use('/missions/:missionId', async (req, _res, next) => {
    try {
      const db = await readyDB();
      if (await db.collection('missions').findOne({ mission_id: req.params.missionId })) await seedReferences(db, req.params.missionId);
      next();
    } catch (error) { next(error); }
  });
  api.get('/system/health', async (_req, res) => {
    const config = readRagConfig();
    const now = new Date().toISOString();
    const llm = getGenerationStatus(), embedding = getEmbeddingStatus();
    const bridge = await bridgeService.status();
    res.json([
      { id: 'database', name: 'Mission database', status: 'ok', details: `${process.env.TERRAVIGIL_DB || 'local'} persistent storage connected`, lastHeartbeat: now },
      { id: 'llm', name: 'Gemini assistant', status: config.geminiKey ? (llm.ready && llm.model === config.geminiModel ? 'ok' : 'warning') : 'offline', details: config.geminiKey ? (llm.ready ? `${config.geminiModel}: provider response verified.` : `${config.geminiModel} configured; a successful assistant request verifies provider access.${llm.errorCode ? ` Last error: ${llm.errorCode}.` : ''}`) : 'Set GEMINI_API_KEY in backend/.env, then restart. No canned answers are used.', lastHeartbeat: llm.checkedAt || now },
      { id: 'embeddings', name: 'Mission retrieval', status: embedding.ready ? 'ok' : 'warning', details: embedding.ready ? 'MiniLM embedding inference verified; indexes use stored mission sources.' : 'MiniLM semantic retrieval. Preparing a mission validates the model and creates its source index.', lastHeartbeat: embedding.checkedAt || now },
      { id: 'firebase', name: 'Firebase detection connection', status: bridge.state === 'connected' ? 'ok' : bridge.state === 'error' ? 'offline' : 'warning', details: bridge.message, lastHeartbeat: bridge.last_sync || now },
      { id: 'telemetry', name: 'Pixhawk telemetry CSV', status: bridge.telemetry?.state === 'ready' ? 'ok' : 'warning', details: bridge.telemetry?.valid_rows ? `${bridge.telemetry.valid_rows} valid positions. Last GPS sample: ${bridge.telemetry.last_timestamp}.` : 'Waiting for the telemetry CSV. Open Firebase & telemetry for setup.', lastHeartbeat: bridge.telemetry?.last_timestamp || now },
      { id: 'jetson', name: 'Jetson Nano 4GB', status: 'warning', details: 'Configured onboard camera / AI computer. Device health is not reported by the Firebase detection feed.', lastHeartbeat: null },
      { id: 'reports', name: 'PDF and CSV reports', status: 'ok', details: 'Factual reports available. Optional AI narrative requires Gemini.', lastHeartbeat: now }
    ]);
  });
  api.get('/system/events', (_req, res) => res.json([]));
  api.get('/classes', (_req, res) => res.json([{ id: '12', name: 'land_mines', description: 'Landmine class from the supplied checkpoint; visual inference alone remains unconfirmed.', category: 'ordnance_ap' }]));
  api.use(require('./reports/routes').createReportRouter({ getDB: readyDB, ragService, dataDir }));
  api.use(require('./bridge/routes').createBridgeRouter(bridgeService));
  api.use(inferenceRouter);
  api.use(createMissionApp({ getDB: readyDB, virtualSample: false, ragService }).app);
  api.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'API endpoint not found.' }));
  app.use('/api', api);
  // Keep legacy ingestion clients working while browser navigation uses the SPA.
  app.use((req, res, next) => {
    if (!req.headers.accept?.includes('text/html') && /^\/(health|missions|sample-mission|detections|observations|telemetry|fusion|inference|reports|system|classes)(\/|$)/.test(req.path)) return api(req, res, next);
    next();
  });
  app.use(express.static(frontend, { index: false }));
  app.get('/{*page}', (_req, res) => {
    const index = path.join(frontend, 'index.html');
    if (!fs.existsSync(index)) return res.status(503).send('Frontend build missing. Run npm run setup from the application folder.');
    res.sendFile(index);
  });
  app.use((error, _req, res, _next) => {
    const invalid = error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large';
    res.status(invalid ? (error.type === 'entity.too.large' ? 413 : 400) : 500).json({ code: invalid ? 'INVALID_REQUEST' : 'APPLICATION_ERROR', message: invalid ? 'Provide valid JSON within the upload limit.' : 'The request could not be completed. Check the backend terminal.' });
  });
  app.locals.ready = preparedDb;
  app.locals.ragService = ragService;
  app.locals.bridgeService = bridgeService;
  return app;
}

async function startServer() {
  const app = createIntegratedApp();
  await app.locals.ready;
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  await app.locals.bridgeService.start();
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`TerraVigil integrated application: http://localhost:${port}`);
    console.log('Firebase detections, automatic telemetry matching, maps, RAG, and PDF/CSV reports.');
    if (!readRagConfig().geminiKey) console.log('Assistant setup: add GEMINI_API_KEY to backend/.env and restart. Firebase matching, maps, and factual reports remain available.');
  });
  server.on('error', error => { void app.locals.bridgeService.stop(); console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other backend or set PORT.` : error.message); process.exitCode = 1; });
  const stop = async () => { await app.locals.bridgeService.stop(); server.close(async () => { await closeDB(); process.exit(0); }); };
  server.on('close', () => { void app.locals.bridgeService.stop(); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return server;
}
if (require.main === module) startServer().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createIntegratedApp, startServer };
