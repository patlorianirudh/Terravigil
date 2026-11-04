'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('local mission data and embeddings survive reopening and reads cannot mutate storage', async t => {
  const { createLocalDb } = require('../local-db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'data.json');
  const db = createLocalDb(file);
  await db.collection('missions').insertOne({ mission_id: 'FIRST', location: 'Field', nested: { value: 1 } });
  await db.collection('missions').insertOne({ mission_id: 'SECOND', location: 'Other field' });
  const row = await db.collection('missions').findOne({ mission_id: 'FIRST' });
  row.nested.value = 9;
  assert.equal((await db.collection('missions').findOne({ mission_id: 'FIRST' })).nested.value, 1);
  await db.collection('missions').updateOne({ mission_id: 'FIRST' }, { $set: { status: 'COMPLETED' } });
  await db.collection('rag_embeddings').insertMany([{ _id: 'index:FIRST', mission_id: 'FIRST', kind: 'index' }, { _id: 'chunk:FIRST', mission_id: 'FIRST', kind: 'chunk', embedding: [0.1, 0.2] }]);
  const reopened = createLocalDb(file);
  assert.equal((await reopened.collection('missions').findOne({ mission_id: 'FIRST' })).status, 'COMPLETED');
  assert.deepEqual((await reopened.collection('rag_embeddings').findOne({ _id: 'chunk:FIRST' })).embedding, [0.1, 0.2]);
  assert.equal((await reopened.collection('missions').find({ mission_id: { $ne: 'FIRST' } }).limit(1).toArray())[0].mission_id, 'SECOND');
  await reopened.collection('missions').deleteOne({ mission_id: 'FIRST' });
  assert.equal((await createLocalDb(file).collection('missions').find().toArray()).length, 1);
});

test('atomic local writes reject duplicate identities and corrupt databases without erasing data', async t => {
  const { createLocalDb } = require('../local-db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'data.json');
  const db = createLocalDb(file);
  await db.collection('reports').createIndex({ sessionId: 1, reportNumber: 1 }, { unique: true });
  await db.collection('reports').insertOne({ _id: 'a', sessionId: 'A', reportNumber: 1 });
  await assert.rejects(db.collection('reports').insertOne({ _id: 'b', sessionId: 'A', reportNumber: 1 }), { code: 11000 });
  await assert.rejects(db.collection('reports').insertMany([{ _id: 'b', sessionId: 'A', reportNumber: 2 }, { _id: 'a', sessionId: 'B', reportNumber: 1 }]), { code: 11000 });
  assert.equal((await db.collection('reports').find().toArray()).length, 1);
  const before = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => createLocalDb(file), /corrupt|invalid/i);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  fs.writeFileSync(file, before);
});

test('sample records are seeded once and the real RAG snapshot sees their evidence', async t => {
  const { createLocalDb } = require('../local-db');
  const { seedSample } = require('../seed-sample');
  const { loadMissionSnapshot } = require('../rag/documents');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createLocalDb(path.join(dir, 'data.json'));
  await seedSample(db); await seedSample(db);
  const snapshot = await loadMissionSnapshot(db, 'SAMPLE-TV001');
  assert.equal(snapshot.summary.facts.total_records, 8);
  assert.equal(snapshot.summary.facts.confirmed, 4);
  assert.equal(snapshot.summary.facts.telemetry_points, 20);
  assert.equal((await db.collection('missions').find().toArray()).length, 1);
});
