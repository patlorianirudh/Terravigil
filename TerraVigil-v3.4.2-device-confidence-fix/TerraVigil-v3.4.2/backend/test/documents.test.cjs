'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshot, loadMissionSnapshot } = require('../rag/documents');
const { RagError } = require('../rag/errors');
const { memoryDb } = require('./helpers/memory-db.cjs');

function seed() {
  return {
    missions: [{ _id: 'm1', mission_id: 'M1', location: 'Test site', status: 'COMPLETED' }],
    detections: [{ _id: 'd2', mission_id: 'M2', status: 'CONFIRMED', risk_level: 'HIGH' }],
    observations: [{
      _id: 'o1', mission_id: 'M1', observation_id: 'O001', yolo_confidence: 0.92,
      metal_detected: false, metal_signal: 0.12, status: 'UNCONFIRMED', risk_level: 'HIGH',
      created_at: new Date('2026-09-01T10:00:00Z')
    }],
    telemetry: []
  };
}

test('preserves high risk independently of confirmation and other missions', () => {
  const snapshot = createSnapshot(seed(), 'M1');
  const source = snapshot.documents.find(document => document.source_type === 'observation');
  assert.equal(source.record_id, 'o1');
  assert.equal(source.facts.status, 'UNCONFIRMED');
  assert.equal(source.facts.risk_level, 'HIGH');
  assert.equal(snapshot.summary.facts.total_records, 1);
  assert.ok(snapshot.documents.every(document => document.mission_id === 'M1'));
});

test('keeps duplicate logical IDs distinct and hashes are order independent', () => {
  const records = seed();
  records.observations.push({ _id: 'o2', mission_id: 'M1', observation_id: 'O001', status: 'CONFIRMED', risk_level: 'LOW' });
  const a = createSnapshot(records, 'M1');
  const b = createSnapshot({ ...records, observations: records.observations.slice().reverse() }, 'M1');
  assert.equal(a.source_hash, b.source_hash);
  assert.equal(a.documents.filter(document => document.source_type === 'observation').length, 2);
  assert.notEqual(...a.documents.filter(document => document.source_type === 'observation').map(document => document.record_id));
});

test('retains valid timestamp and created_at separately and reports invalid sensors', () => {
  const records = seed();
  records.observations[0].timestamp = new Date('2026-09-02T10:00:00Z');
  records.observations[0].latitude = '95';
  records.observations[0].metal_signal = 'not-a-number';
  const source = createSnapshot(records, 'M1').documents.find(document => document.source_type === 'observation');
  assert.equal(source.facts.timestamp, '2026-09-02T10:00:00.000Z');
  assert.equal(source.facts.created_at, '2026-09-01T10:00:00.000Z');
  assert.ok(source.validation_issues.includes('invalid_latitude'));
  assert.ok(source.validation_issues.includes('invalid_metal_signal'));
});

test('loadMissionSnapshot filters every collection by mission and performs no writes', async () => {
  const db = memoryDb(seed());
  const snapshot = await loadMissionSnapshot(db, 'M1');
  assert.equal(snapshot.summary.facts.total_records, 1);
  const reads = db.calls.filter(call => call.operation === 'find');
  assert.ok(reads.length >= 4);
  assert.ok(reads.every(call => call.query.mission_id === 'M1'));
  assert.equal(db.calls.some(call => ['insertOne', 'insertMany', 'updateOne', 'deleteMany'].includes(call.operation)), false);
});

test('missing mission is typed', async () => {
  await assert.rejects(() => loadMissionSnapshot(memoryDb(seed()), 'MISSING'), error => {
    assert.ok(error instanceof RagError);
    assert.equal(error.code, 'MISSION_NOT_FOUND');
    return true;
  });
});
