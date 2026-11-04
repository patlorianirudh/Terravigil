'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('existing route signatures remain and each additive RAG route is registered once', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const existing = [
    'GET /missions', 'POST /missions', 'GET /missions/:mission_id', 'PUT /missions/:mission_id', 'DELETE /missions/:mission_id',
    'POST /detections', 'GET /detections', 'GET /detections/:detection_id', 'PUT /detections/:detection_id',
    'POST /observations', 'GET /observations/:observation_id', 'GET /missions/:mission_id/observations',
    'PUT /observations/:observation_id', 'GET /missions/:mission_id/detections', 'POST /telemetry',
    'GET /telemetry', 'GET /missions/:mission_id/telemetry', 'POST /fusion/test', 'GET /missions/:mission_id/risk',
    'GET /missions/:mission_id/history', 'GET /missions/:mission_id/statistics', 'GET /missions/:mission_id/summary'
  ];
  for (const signature of existing) {
    const [method, route] = signature.split(' ');
    assert.equal((server.match(new RegExp(`app\\.${method.toLowerCase()}\\(\\"${route.replaceAll('/', '\\/')}\\"`)) || []).length, 1, signature);
  }
  const ragRoutes = [
    'get(\'/missions/:mission_id/rag-documents\'',
    'post(\'/missions/:mission_id/create-embeddings\'',
    'get(\'/missions/:mission_id/search\'',
    'get(\'/missions/:mission_id/ask\''
  ];
  const router = fs.readFileSync(path.join(__dirname, '..', 'rag', 'routes.js'), 'utf8');
  for (const route of ragRoutes) assert.equal(router.split(`router.${route}`).length - 1, 1, route);
});
