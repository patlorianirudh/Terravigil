'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fixture = require('../sample/fixture.json');

test('sample server operates with MongoDB and ML imports forbidden, without writes', async () => {
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    assert.ok(!/mongodb|transformers|generative-ai|database/.test(name), `Unexpected external dependency: ${name}`);
    return originalLoad.call(this, name, ...args);
  };
  let server;
  try {
    const { createSampleServer } = require('../sample-server');
    server = createSampleServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const get = async endpoint => { const r = await fetch(base + endpoint); assert.equal(r.status, 200, endpoint); return r.json(); };
    const post = (endpoint, body) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.deepEqual((await get('/missions')).map(row => row.mission_id), ['SAMPLE-TV001']);
    assert.equal((await get('/health')).database, 'not used');
    assert.equal((await get('/sample-mission')).created, false);
    const prefix = '/missions/SAMPLE-TV001';
    const confirmed = await get(prefix + '/detections');
    const unconfirmed = await get(prefix + '/observations');
    assert.equal(confirmed.length, 4);
    assert.ok(confirmed.every(row => row.metal_detected && row.yolo_confidence >= 0.7 && row.class_name === 'land_mines'));
    assert.equal(unconfirmed.length, 4);
    assert.ok(unconfirmed.every(row => row.risk_level === null && row.status === 'UNCONFIRMED'));
    assert.equal((await get(prefix + '/telemetry')).length, 20);
    assert.deepEqual((await get(prefix + '/statistics')).risk, { high: 2, medium: 1, low: 1 });
    assert.match((await get(prefix + '/ask?q=risk')).answer, /no AI model/);
    const prepared = await post(prefix + '/create-embeddings', {});
    assert.equal((await prepared.json()).indexed_chunks, 0);
    const response = await post(prefix + '/route', { ...fixture.mission.sample_route, minStandoffM: 5, cautionWeight: 0.6 });
    assert.equal(response.status, 200);
    const route = await response.json();
    assert.equal(route.pathFound, true, route.failureReason);
    assert.ok(route.waypoints.length > 2);
    assert.ok(route.minStandoffAchievedM >= 5);
    assert.equal((await post(prefix + '/route', { ...fixture.mission.sample_route, sessionId: 'OTHER' })).status, 400);
    assert.equal((await post('/missions', { mission_id: 'NEW' })).status, 405);
    assert.equal((await fetch(base + prefix, { method: 'DELETE' })).status, 405);
    assert.equal((await fetch(base + '/missions/OTHER')).status, 404);
    assert.equal((await get('/missions')).length, 1);
    assert.deepEqual(await get(prefix + '/detections'), confirmed);
    const malformed = await fetch(base + prefix + '/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(malformed.status, 400);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    Module._load = originalLoad;
  }
});

test('sample results are isolated and unknown live missions pass through', () => {
  const { dispatchSample } = require('../sample/service');
  const sample = dispatchSample('GET', '/missions/SAMPLE-TV001');
  sample.body.location = 'changed';
  assert.equal(dispatchSample('GET', '/missions/SAMPLE-TV001').body.location, fixture.mission.location);
  assert.equal(dispatchSample('GET', '/missions/REAL'), null);
  assert.equal(dispatchSample('POST', '/detections', { mission_id: 'SAMPLE-TV001' }).status, 405);
  assert.equal(dispatchSample('POST', '/detections', { mission_id: 'REAL' }), null);
  assert.equal(dispatchSample('GET', '/missions/SAMPLE-TV001/ask?q=a&q=b').status, 400);
});
