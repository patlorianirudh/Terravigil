'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/memory-db.cjs');

test('the isolated test adapter exposes its fixture and computes its route', async () => {
  const db = memoryDb({ missions: [{ _id: 'original', mission_id: 'ORIGINAL', location: 'Original mission', status: 'COMPLETED' }] });
  const databasePath = require.resolve('../database');
  require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { connectDB: async () => db } };
  const { createMissionApp } = require('../server');
  const { app } = createMissionApp({ getDB: async () => db, virtualSample: true });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = async path => { const response = await fetch(base + path); assert.equal(response.status, 200, path); return response.json(); };
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  try {
    const created = await fetch(base + '/sample-mission');
    assert.ok([200, 201].includes(created.status), `sample route status ${created.status}`);
    const sample = await created.json();
    assert.equal(sample.mission_id, 'SAMPLE-TV001');
    assert.deepEqual(sample.counts, { detections: 4, observations: 4, telemetry: 20 });
    assert.equal((await read('/missions')).length, 2);
    const root = '/missions/SAMPLE-TV001';
    assert.equal((await read(root)).sample, true);
    assert.equal((await read(root + '/detections')).length, 4);
    assert.equal((await read(root + '/observations')).length, 4);
    const track = await read(root + '/telemetry');
    assert.equal(track.length, 20);
    assert.ok(track.every(row => Number.isFinite(Date.parse(row.timestamp))));
    assert.equal((await read(root + '/risk')).length, 4);
    assert.equal((await read(root + '/history')).length, 28);
    assert.equal((await read(root + '/statistics')).total_records, 8);
    assert.equal((await read(root + '/summary')).mission.mission_id, sample.mission_id);
    assert.deepEqual(db.rows('missions').map(row => row.mission_id), ['ORIGINAL']);
    assert.equal(db.rows('detections').length, 0);
    const response = await post(root + '/route', { ...sample.suggestedRoute, minStandoffM: 5, cautionWeight: 0.6 });
    assert.equal(response.status, 200);
    const route = await response.json();
    assert.equal(route.sessionId, sample.mission_id);
    assert.equal(route.pathFound, true, route.failureReason);
    assert.ok(route.waypoints.length > 2, 'sample should demonstrate a detour around recorded evidence');
    assert.ok(route.minStandoffAchievedM >= 5);
    const repeated = await post('/sample-mission');
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).created, false);
    assert.equal((await read('/missions/ORIGINAL')).location, 'Original mission');
    assert.equal((await read('/missions/ORIGINAL/detections')).length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
