'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../local-db');

test('production app removes legacy practice records and uses captured mission data through RAG', async t => {
  const { createIntegratedApp } = require('../integrated-server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-app-'));
  const db = createLocalDb(path.join(dir, 'missions.json'));
  await require('../seed-sample').seedSample(db);
  await db.collection('missions').insertOne({ mission_id: 'TV-LIVE-001', location: 'Flight', status: 'ACTIVE' });
  await db.collection('observations').insertOne({ mission_id: 'TV-LIVE-001', observation_id: 'captured', status: 'UNCONFIRMED', latitude: 17.3975, longitude: 78.4893 });
  await db.collection('reports').insertOne({ id: 'old-sample-report', sessionId: 'SAMPLE-TV001', status: 'ready', synthetic: true });
  const app = createIntegratedApp({ getDB: async () => db, dataDir: dir, ragOptions: {
    embed: { tokenCount: async text => text.split(/\s+/).length, createEmbedding: async () => [1, ...Array(383).fill(0)] },
    generate: async (_question, sources) => `Records: ${sources.find(row => row.source_type === 'summary').facts.total_records}. [1]`
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function read(endpoint, body) {
    const response = await fetch(base + endpoint, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await read('/health')).body.mode, 'integrated');
  assert.equal((await read('/missions')).body.length, 1);
  const root = '/missions/TV-LIVE-001';
  assert.equal(await db.collection('missions').countDocuments({ mission_id: 'SAMPLE-TV001' }), 0);
  assert.equal(await db.collection('reports').countDocuments(), 0);
  assert.equal((await read('/sample-mission')).status, 410);
  const indexed = await read(root + '/create-embeddings', {});
  assert.equal(indexed.status, 200);
  assert.ok(indexed.body.indexed_chunks > 0);
  assert.equal((await read(root + '/rag-documents')).body.documents.length > 2, true);
  const answer = await read(root + '/ask?q=How%20many%20records');
  assert.equal(answer.status, 200);
  assert.equal(answer.body.answer, 'Records: 1. [1]');
  assert.ok(answer.body.sources.length > 0);
  assert.ok((await read(root + '/search?q=records')).body.sources.length > 0);
  assert.equal((await read('/reports')).status, 200);
  const created = await read('/missions', { mission_id: 'NEW-FIELD', location: 'New field', status: 'ACTIVE' });
  assert.equal(created.status, 201);
  assert.ok(await createLocalDb(path.join(dir, 'missions.json')).collection('missions').findOne({ mission_id: 'NEW-FIELD' }));
  const blocked = await fetch(base + '/missions/SAMPLE-TV001', { method: 'DELETE' });
  assert.equal(blocked.status, 404);
  assert.equal((await read('/missions/NEW-FIELD')).body.mission_id, 'NEW-FIELD');
  await db.collection('observations').insertOne({ mission_id: 'NEW-FIELD', observation_id: 'photo-only', latitude: 0, longitude: 0, target_location_known: false, status: 'UNCONFIRMED' });
  const photoRoute = await read('/missions/NEW-FIELD/route', { start: { lat: 0, lon: -0.001 }, end: { lat: 0, lon: 0.001 }, minStandoffM: 5 });
  assert.equal(photoRoute.status, 200);
  assert.equal(photoRoute.body.pathFound, false);
  assert.equal(photoRoute.body.failureCode, 'ROUTE_UNLOCALIZED_EVIDENCE');
});
