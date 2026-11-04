'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSampleRouter } = require('../sample/routes');
const { metadata } = require('../sample/service');

test('sample router reads the fixture without ever connecting to the database', async () => {
  let connected = false;
  const app = express(); app.use(express.json());
  app.use(createSampleRouter({ connectDB() { connected = true; throw new Error('Database must not be used'); } }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const method of ['GET', 'GET', 'POST']) {
      const r = await fetch(base + '/sample-mission', { method });
      assert.equal(r.status, 200); assert.deepEqual(await r.json(), metadata());
    }
    assert.equal(connected, false);
    const sample = await fetch(base + '/missions/SAMPLE-TV001');
    assert.equal((await sample.json()).sample, true);
    assert.equal(connected, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
