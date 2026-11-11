'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../local-db');
const { fuseMissionObservations, distanceMeters } = require('../fusion/fuse');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-fuse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return createLocalDb(path.join(dir, 'data.json'));
}

const cameraObs = (id, changes = {}) => ({
  _id: id, observation_id: id, mission_id: 'TV-LIVE-001', device: 'camera',
  latitude: 17.3975, longitude: 78.4893, timestamp: '2026-10-15T08:55:20.000000Z',
  yolo_confidence: 0.91, confidence_score: 0.91, confidence_percent: 91,
  metal_signal: null, status: 'UNCONFIRMED', layer: 'LAYER_2', risk_level: null, ...changes,
});
const metalObs = (id, changes = {}) => ({
  _id: id, observation_id: id, mission_id: 'TV-LIVE-001', device: 'metal',
  latitude: 17.3975, longitude: 78.4893, timestamp: '2026-10-15T08:55:22.000000Z',
  yolo_confidence: null, confidence_score: 0.8, confidence_percent: 80,
  metal_signal: 0.75, status: 'UNCONFIRMED', layer: 'LAYER_2', risk_level: null, ...changes,
});

test('distanceMeters returns ~0 for identical points and sane values nearby', () => {
  assert.equal(distanceMeters(17.3975, 78.4893, 17.3975, 78.4893), 0);
  const d = distanceMeters(17.3975, 78.4893, 17.3976, 78.4893);
  assert.ok(d > 10 && d < 12, `expected ~11 m, got ${d}`);
});

test('a camera detection near a metal hit is upgraded to CONFIRMED with a risk level', async (t) => {
  const db = setup(t);
  await db.collection('observations').insertMany([cameraObs('cam-1'), metalObs('met-1')]);
  const result = await fuseMissionObservations(db, 'TV-LIVE-001');
  assert.equal(result.pairs, 1);
  assert.equal(result.confirmed, 1);
  const cam = await db.collection('observations').findOne({ _id: 'cam-1' });
  assert.equal(cam.status, 'CONFIRMED');
  assert.equal(cam.layer, 'LAYER_1');
  assert.equal(cam.confirmation_source, 'camera_and_metal');
  assert.equal(cam.corroborating_observation_id, 'met-1');
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(cam.risk_level));
  const met = await db.collection('observations').findOne({ _id: 'met-1' });
  assert.equal(met.corroborates_observation_id, 'cam-1');
});

test('high YOLO + high metal yields HIGH risk; lower confidence yields a lower band', async (t) => {
  const db = setup(t);
  await db.collection('observations').insertMany([
    cameraObs('cam-high', { yolo_confidence: 0.95, confidence_score: 0.95 }),
    metalObs('met-high', { metal_signal: 0.8 }),
    cameraObs('cam-low', { _id: 'cam-low', yolo_confidence: 0.72, confidence_score: 0.72, latitude: 17.4, longitude: 78.49 }),
    metalObs('met-low', { _id: 'met-low', metal_signal: 0.1, latitude: 17.4, longitude: 78.49 }),
  ]);
  await fuseMissionObservations(db, 'TV-LIVE-001');
  assert.equal((await db.collection('observations').findOne({ _id: 'cam-high' })).risk_level, 'HIGH');
  assert.equal((await db.collection('observations').findOne({ _id: 'cam-low' })).risk_level, 'LOW');
});

test('a camera detection with no nearby metal stays UNCONFIRMED', async (t) => {
  const db = setup(t);
  // Metal observation is 60 seconds away — outside the time window.
  await db.collection('observations').insertMany([
    cameraObs('cam-solo'),
    metalObs('met-far', { timestamp: '2026-10-15T08:56:20.000000Z' }),
  ]);
  const result = await fuseMissionObservations(db, 'TV-LIVE-001');
  assert.equal(result.pairs, 0);
  assert.equal((await db.collection('observations').findOne({ _id: 'cam-solo' })).status, 'UNCONFIRMED');
});

test('a camera detection below the YOLO threshold is never confirmed', async (t) => {
  const db = setup(t);
  await db.collection('observations').insertMany([
    cameraObs('cam-weak', { yolo_confidence: 0.5, confidence_score: 0.5 }),
    metalObs('met-near'),
  ]);
  const result = await fuseMissionObservations(db, 'TV-LIVE-001');
  assert.equal(result.pairs, 0);
  assert.equal((await db.collection('observations').findOne({ _id: 'cam-weak' })).status, 'UNCONFIRMED');
});

test('one metal observation corroborates only one camera observation', async (t) => {
  const db = setup(t);
  await db.collection('observations').insertMany([
    cameraObs('cam-a'),
    cameraObs('cam-b', { latitude: 17.39751, longitude: 78.48931 }),
    metalObs('met-shared'),
  ]);
  const result = await fuseMissionObservations(db, 'TV-LIVE-001');
  assert.equal(result.pairs, 1);
  const confirmed = await db
    .collection('observations')
    .find({ status: 'CONFIRMED' })
    .toArray();
  assert.equal(confirmed.length, 1);
});
