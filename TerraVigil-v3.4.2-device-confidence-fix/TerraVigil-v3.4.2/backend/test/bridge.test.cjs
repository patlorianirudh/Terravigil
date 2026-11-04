'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../local-db');
const { createBridgeService, readBridgeConfig } = require('../bridge/service');
const { createIntegratedApp } = require('../integrated-server');
const makeEvent = (changes = {}) => ({
  event_id: 'FB-012345678901234567890123', firebase_id: '-firebase-key', mission_id: 'TV-LIVE-001',
  synthetic: false, class_name: 'test_candidate', confidence: 0.91, image_path: 'camera/image.jpg',
  timestamp_original: '2026-10-15T14:25:20+05:30',
  match: { matched: true, status: 'matched', method: 'exact', latitude: 17.3975, longitude: 78.4893,
    capture_timestamp: '2026-10-15T08:55:20.000000Z', lookup_timestamp: '2026-10-15T08:55:20.000000Z',
    telemetry_timestamp: '2026-10-15T08:55:20.000000Z', gap_seconds: 0, clock_offset_seconds: 0,
    max_gap_seconds: 2, csv_line: 10 }, ...changes,
});
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-bridge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createLocalDb(path.join(dir, 'data.json'));
  const config = { ...readBridgeConfig({ FIREBASE_ENABLED: 'false' }), imageDir: path.join(dir, 'images') };
  const service = createBridgeService({ getDB: async () => db, config });
  t.after(() => service.stop());
  return { db, service, config, dir };
}
test('matched events persist once across replay/restart and retain GPS provenance', async t => {
  const { db, service, config } = setup(t);
  const event = makeEvent();
  await service.ingest({ type: 'detection', event });
  await service.ingest({ type: 'detection', event });
  const restarted = createBridgeService({ getDB: async () => db, config });
  await restarted.ingest({ type: 'detection', event });
  assert.equal(await db.collection('observations').countDocuments(), 1);
  assert.equal(await db.collection('firebase_events').countDocuments(), 1);
  const row = await db.collection('observations').findOne({ _id: event.event_id });
  assert.equal(row.timestamp, '2026-10-15T08:55:20.000000Z');
  assert.equal(row.status, 'UNCONFIRMED');
  assert.equal(row.target_location_known, false);
  assert.equal(row.location_source, 'aircraft_gps_at_capture');
  assert.equal(row.telemetry_match_gap_seconds, 0);
});
test('Python-normalized Firebase classes repair existing labels without duplicating or confirming observations', async t => {
  const { db, service, config, dir } = setup(t);
  const csv = path.join(dir, 'telemetry.csv');
  fs.writeFileSync(csv, 'timestamp,latitude,longitude,gps_fix_type\n2026-10-15T08:55:20Z,17.3975,78.4893,3\n');
  const { spawnSync } = require('node:child_process');
  const python = process.env.TELEMETRY_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const script = [
    'import json, sys',
    'from firebase_bridge import process_detection',
    'from lookup_telemetry import TelemetryIndex',
    'payload = json.load(sys.stdin)',
    'index = TelemetryIndex(payload["csv"]); index.reload()',
    'print(json.dumps(process_detection("class-replay", payload["record"], index, "TV-LIVE-001", 2, "UTC", 0)))',
  ].join('\n');
  const result = spawnSync(python, ['-c', script], {
    cwd: path.resolve(__dirname, '../../telemetry'), encoding: 'utf8',
    input: JSON.stringify({ csv, record: {
      timestamp: '2026-10-15T08:55:20Z', class_name: 'unknown', classId: '12', confidence: 0.91,
      image_path: 'camera/renamed.jpg',
    } }),
  });
  assert.equal(result.status, 0, result.stderr);
  const event = JSON.parse(result.stdout);
  assert.equal(event.class_name, 'land_mines');
  await service.ingest({ type: 'detection', event: { ...event, class_name: 'Unknown class', class_id: null } });
  const restarted = createBridgeService({ getDB: async () => db, config });
  t.after(() => restarted.stop());
  await restarted.ingest({ type: 'detection', event });
  await restarted.ingest({ type: 'detection', event });
  assert.equal(await db.collection('observations').countDocuments(), 1);
  assert.equal(await db.collection('firebase_events').countDocuments(), 1);
  const row = await db.collection('observations').findOne({ _id: event.event_id });
  assert.equal(row.class_name, 'land_mines');
  assert.equal(row.class_id, 12);
  assert.equal(row.latitude, 17.3975);
  assert.equal(row.longitude, 78.4893);
  assert.equal(row.image_original_path, 'camera/renamed.jpg');
  assert.equal(row.status, 'UNCONFIRMED');
  assert.equal(row.layer, 'LAYER_2');
  assert.equal(row.metal_detected, null);
  assert.equal(row.confirmation_source, 'visual_only');
});
test('camera and metal Firebase records persist as landmine candidates with sensor-specific confidence', async t => {
  const { db, service } = setup(t);
  const cameraEvent = makeEvent({
    event_id: 'FB-111111111111111111111111', firebase_id: 'camera-key',
    device: 'camera', class_name: 'unknown_object', confidence: 0.5968,
    confidence_score: 0.5968, confidence_percent: 59.68,
  });
  const metalEvent = makeEvent({
    event_id: 'FB-222222222222222222222222', firebase_id: 'metal-key',
    device: 'metal', class_name: 'unknown_object', confidence: 0.5968,
    confidence_score: 0.5968, confidence_percent: 59.68,
  });
  await service.ingest({ type: 'detection', event: cameraEvent });
  await service.ingest({ type: 'detection', event: metalEvent });
  const camera = await db.collection('observations').findOne({ _id: cameraEvent.event_id });
  const metal = await db.collection('observations').findOne({ _id: metalEvent.event_id });
  assert.equal(camera.class_name, 'land_mines');
  assert.equal(camera.device, 'camera');
  assert.equal(camera.yolo_confidence, 0.5968);
  assert.equal(camera.confidence_score, 0.5968);
  assert.equal(camera.confidence_percent, 59.68);
  assert.equal(camera.confirmation_source, 'camera_detector_only');
  assert.equal(metal.class_name, 'land_mines');
  assert.equal(metal.device, 'metal');
  assert.equal(metal.yolo_confidence, null);
  assert.equal(metal.confidence_score, 0.5968);
  assert.equal(metal.confidence_percent, 59.68);
  assert.equal(metal.confirmation_source, 'metal_sensor_only');
});

test('metal_detector Firebase records are normalized as metal observations', async t => {
  const { db, service } = setup(t);
  const event = makeEvent({
    event_id: 'FB-333333333333333333333333', firebase_id: 'metal-detector-key',
    device: 'metal_detector', confidence_score: 0.0387, confidence_percent: 3.87,
  });
  await service.ingest({ type: 'detection', event });
  const metal = await db.collection('observations').findOne({ _id: event.event_id });
  assert.equal(metal.device, 'metal');
  assert.equal(metal.class_name, 'land_mines');
  assert.equal(metal.yolo_confidence, null);
  assert.equal(metal.confirmation_source, 'metal_sensor_only');
});

test('pending records stay in the inbox; append/retry maps them and corrected bad timestamps retract them', async t => {
  const { db, service } = setup(t);
  const pending = makeEvent({ match: { matched: false, status: 'outside_tolerance', gap_seconds: 100 } });
  await service.ingest({ type: 'detection', event: pending });
  assert.equal(await db.collection('observations').countDocuments(), 0);
  assert.equal((await service.status()).counts.pending, 1);
  await service.ingest({ type: 'detection', event: makeEvent() });
  assert.equal(await db.collection('observations').countDocuments(), 1);
  await service.ingest({ type: 'detection', event: pending });
  assert.equal(await db.collection('observations').countDocuments(), 0);
});
test('Firebase deletions retract map markers and retain an audit record', async t => {
  const { db, service } = setup(t);
  const event = makeEvent();
  await service.ingest({ type: 'detection', event });
  await service.ingest({ type: 'removed', event_id: event.event_id });
  assert.equal(await db.collection('observations').countDocuments(), 0);
  assert.equal((await service.events())[0].status, 'removed');
  await service.ingest({ type: 'detection', event });
  assert.equal(await db.collection('observations').countDocuments(), 1);
});
test('images are limited to the configured folder and raster image files', async t => {
  const { service, config, dir } = setup(t);
  fs.mkdirSync(config.imageDir);
  fs.writeFileSync(path.join(config.imageDir, 'image.jpg'), 'test raster bytes');
  await service.ingest({ type: 'detection', event: makeEvent() });
  assert.equal(await service.imageFile(makeEvent().event_id), path.join(config.imageDir, 'image.jpg'));
  await service.ingest({ type: 'detection', event: makeEvent({ image_path: '../serviceAccountKey.json' }) });
  assert.equal(await service.imageFile(makeEvent().event_id), null);
  fs.writeFileSync(path.join(dir, 'outside.jpg'), 'outside');
  fs.symlinkSync(path.join(dir, 'outside.jpg'), path.join(config.imageDir, 'symlink.jpg'));
  await service.ingest({ type: 'detection', event: makeEvent({ image_path: 'symlink.jpg' }) });
  assert.equal(await service.imageFile(makeEvent().event_id), null);
});
test('production bridge rejects simulated events and reserved practice missions', async t => {
  const { db, service } = setup(t);
  await assert.rejects(service.ingest({ type: 'detection', event: makeEvent({ synthetic: true }) }), /Practice/);
  await assert.rejects(service.ingest({ type: 'detection', event: makeEvent({ mission_id: 'TV-TELEMETRY-DEMO' }) }), /Practice/);
  assert.equal(await db.collection('observations').countDocuments(), 0);
});
test('API returns imported observations, unmatched inbox, and SPA routes independently', async t => {
  const { db, dir } = setup(t);
  const app = createIntegratedApp({ getDB: async () => db, dataDir: dir });
  await app.locals.ready;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/bridge/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 410);
  await app.locals.bridgeService.ingest({ type: 'detection', event: makeEvent() });
  await app.locals.bridgeService.ingest({ type: 'detection', event: makeEvent({ event_id: 'FB-111111111111111111111111', firebase_id: 'pending-key', match: { matched: false, status: 'outside_tolerance', gap_seconds: 100 } }) });
  const observations = await (await fetch(`${base}/api/missions/TV-LIVE-001/observations`)).json();
  assert.equal(observations.length, 1);
  const inbox = await (await fetch(`${base}/api/bridge/events?mission_id=TV-LIVE-001`)).json();
  assert.equal(inbox.filter(row => row.status === 'outside_tolerance').length, 1);
  const reportResponse = await fetch(base + '/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'TV-LIVE-001' }) });
  assert.equal(reportResponse.status, 201);
  const report = await reportResponse.json();
  assert.equal(report.recordCounts.firebaseEvents, 2);
  assert.equal(report.recordCounts.firebaseUnmatched, 1);
  assert.equal(report.summary.unconfirmedVisualCount, 1);
  assert.equal(report.recordCounts.firebaseMatched, 1);
  assert.equal(report.recordCounts.firebasePending, 1);
  assert.equal(report.hardware.edgeComputer, 'NVIDIA Jetson Nano 4GB');
  const csv = await (await fetch(base + report.csvDownloadUrl)).text();
  assert.match(csv, /outside_tolerance/);
  assert.match(csv, /NVIDIA Jetson Nano 4GB/);
  assert.doesNotMatch(csv, /SAMPLE-TV001|TV-TELEMETRY-DEMO/);
  assert.match(csv, /aircraft_gps_at_capture/);
  assert.match(csv, /telemetry_match_gap_seconds/);
  for (const route of ['/connections', '/risk-map?mission=TV-LIVE-001', '/model']) {
    const page = await fetch(base + route, { headers: { accept: 'text/html' } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root">/);
  }
  assert.equal((await fetch(base + '/api/does-not-exist')).status, 404);
});

test('snapshot after a restart retracts previously deleted Firebase records', async t => {
  const { db, service, config } = setup(t);
  await service.ingest({ type: 'detection', event: makeEvent() });
  const restarted = createBridgeService({ getDB: async () => db, config });
  await restarted.ingest({ type: 'snapshot', mission_id: config.missionId, event_ids: [] });
  assert.equal(await db.collection('observations').countDocuments(), 0);
  assert.equal((await restarted.events())[0].status, 'removed');
});

test('downloaded renamed images are served from the evidence subdirectory', async t => {
  const { db, service, config } = setup(t);
  fs.mkdirSync(path.join(config.imageDir, 'received'), { recursive: true });
  const local = path.join(config.imageDir, 'received', '20261015_FB-image.png');
  fs.writeFileSync(local, 'test image');
  await service.ingest({ type: 'detection', event: makeEvent({ image_path: '', image_url: 'https://storage.googleapis.com/bucket/picture.png', image: { state: 'ready', local_path: 'received/20261015_FB-image.png', filename: '20261015_FB-image.png' }, test_record: true }) });
  assert.equal(await service.imageFile(makeEvent().event_id), local);
  const observation = await db.collection('observations').findOne({ _id: makeEvent().event_id });
  assert.equal(observation.image_url, `/api/bridge/images/${makeEvent().event_id}`);
  assert.equal(observation.test_record, true);
});

test('image HTTP endpoint supports validated files inside the hidden test session folder', async t => {
  const { service, config, dir } = setup(t);
  const express = require('express');
  config.imageDir = path.join(dir, '.runtime', 'images');
  fs.mkdirSync(path.join(config.imageDir, 'received'), { recursive: true });
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLz8AAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(config.imageDir, 'received', 'capture.png'), bytes);
  await service.ingest({ type: 'detection', event: makeEvent({ image: { state: 'ready', local_path: 'received/capture.png', filename: 'capture.png' } }) });
  const app = express();
  app.use('/api', require('../bridge/routes').createBridgeRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bridge/images/${makeEvent().event_id}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('defaults point at the live screenshot branch and uploaded telemetry file', () => {
  const config = readBridgeConfig({});
  assert.equal(config.databasePath, 'detections');
  assert.equal(path.basename(config.csv), 'telemetry.csv');
});

test('newest capture stays first when an older pending detection retries', async t => {
  const { service } = setup(t);
  const latest = makeEvent({ event_id: 'FB-222222222222222222222222', firebase_id: 'latest',
    match: { ...makeEvent().match, capture_timestamp: '2026-10-16T09:06:19.651367Z' } });
  await service.ingest({ type: 'detection', event: latest });
  await service.ingest({ type: 'detection', event: makeEvent() });
  const events = await service.events();
  assert.equal(events[0].firebase_id, 'latest');
});
