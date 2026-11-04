'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { memoryDb } = require('./helpers/memory-db.cjs');

const IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAf8bRXQAAAAASUVORK5CYII=';
const HASH = '02d9b7eac5d7bbd33e0b8168ea892f24da6099b1fc02e9c87c688b928a464f93';
const PREDICTIONS = [
  { classId: 12, className: 'land_mines', confidence: 0.91, bbox: [0, 0, 2, 2], normalizedCenter: { x: 0.5, y: 0.5 } },
  { classId: 4, className: 'military_vehicle', confidence: 0.8, bbox: [0, 0, 1, 1], normalizedCenter: { x: 0.25, y: 0.25 } },
];
function runtime(overrides = {}) {
  return {
    async status() { return { ready: true, model: { name: 'best.pt', sha256: HASH, task: 'detect', device: 'cpu' }, runtime: { python: '3.12', ultralytics: '8.4.157', torch: '2.8.0' } }; },
    async predict(request) {
      assert.equal((await fs.readFile(request.inputPath)).toString('base64'), IMAGE);
      await fs.writeFile(request.annotatedPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return { ok: true, model: { name: 'best.pt', sha256: HASH, task: 'detect', device: 'cpu' }, image: { width: 2, height: 2 }, predictions: structuredClone(PREDICTIONS) };
    },
    ...overrides,
  };
}
async function serve(t, { runner = runtime(), seed = {} } = {}) {
  const { createInferenceRouter } = require('../inference/routes');
  const db = memoryDb(seed);
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terra inference '));
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use('/api', createInferenceRouter({ getDB: async () => db, dataDir, runner }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(base + '/api/inference/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { db, dataDir, base, post };
}
const upload = extras => ({ imageBase64: IMAGE, filename: 'image.png', ...extras });

test('inference API makes real results visible without inventing geolocated evidence', async t => {
  const { db, base, post } = await serve(t);
  const response = await post(upload());
  assert.equal(response.status, 201);
  const run = await response.json();
  assert.equal(run.model.sha256, HASH);
  assert.deepEqual(run.predictions, PREDICTIONS);
  assert.equal(run.persistedObservations, 0);
  assert.equal(db.rows('observations').length, 0);
  assert.equal(db.rows('detections').length, 0);
  assert.equal(db.rows('missions')[0].mission_id, run.missionId);
  assert.equal(db.rows('missions')[0].sample, false);
  assert.equal(db.rows('inference_runs')[0].run_id, run.runId);
  assert.equal((await fetch(base + run.imageUrl)).status, 200);
  const annotation = await fetch(base + run.annotatedImageUrl);
  assert.equal(annotation.status, 200);
  assert.equal(annotation.headers.get('content-type'), 'image/jpeg');
});

test('image GPS persists only unconfirmed mine observations with model provenance and unknown metal readings', async t => {
  const { db, post } = await serve(t, { seed: { missions: [{ mission_id: 'LIVE-1', status: 'COMPLETED' }] } });
  const response = await post(upload({ missionId: 'LIVE-1', latitude: 17.5, longitude: 78.4 }));
  assert.equal(response.status, 201);
  const run = await response.json();
  assert.equal(run.missionId, 'LIVE-1');
  assert.equal(run.persistedObservations, 1);
  const [observation] = db.rows('observations');
  assert.equal(observation.status, 'UNCONFIRMED');
  assert.equal(observation.class_name, 'land_mines');
  assert.equal(observation.yolo_confidence, 0.91);
  assert.equal(observation.metal_detected, null);
  assert.equal(observation.metal_signal, null);
  assert.equal(observation.location_source, 'user_supplied_image_location');
  assert.equal(observation.target_location_known, false);
  assert.equal(observation.model_sha256, HASH);
  assert.deepEqual(observation.bounding_box, [0, 0, 2, 2]);
  assert.equal(db.rows('detections').length, 0);
});

test('selected synthetic mission stays immutable and inference creates a real mission', async t => {
  const original = { mission_id: 'SAMPLE-TV001', sample: true, synthetic: true, status: 'COMPLETED' };
  const { db, post } = await serve(t, { seed: { missions: [original] } });
  const response = await post(upload({ missionId: original.mission_id, latitude: 0, longitude: 0 }));
  assert.equal(response.status, 201);
  const run = await response.json();
  assert.notEqual(run.missionId, original.mission_id);
  assert.deepEqual(db.rows('missions')[0], original);
  assert.equal(db.rows('observations')[0].mission_id, run.missionId);
});

test('missing selected mission is rejected before creating files or evidence', async t => {
  const { db, post, dataDir } = await serve(t);
  const response = await post(upload({ missionId: 'MISSING' }));
  assert.equal(response.status, 404);
  assert.equal(db.rows('missions').length, 0);
  assert.equal(db.rows('inference_runs').length, 0);
  assert.equal((await fs.readdir(path.join(dataDir, 'inference')).catch(() => [])).length, 0);
});

test('invalid image, threshold, GPS pairs, filenames, and mission IDs never reach runtime', async t => {
  const { db, post } = await serve(t, { runner: runtime({ predict() { assert.fail('invalid input must not start Python'); } }) });
  const invalid = [
    {}, upload({ imageBase64: 'not-base64!' }), upload({ imageBase64: Buffer.from('not an image').toString('base64') }),
    upload({ imageBase64: 'data:image/jpeg;base64,' + IMAGE }), upload({ confidence: 0 }), upload({ confidence: 1.01 }),
    upload({ confidence: '0.25' }), upload({ latitude: 3 }), upload({ longitude: 0 }), upload({ latitude: null, longitude: 0 }),
    upload({ latitude: 91, longitude: 0 }), upload({ latitude: 0, longitude: 181 }), upload({ latitude: '0', longitude: 0 }),
    upload({ filename: '../escape.png' }), upload({ filename: '..\\escape.png' }), upload({ missionId: { '$ne': '' } }),
  ];
  for (const body of invalid) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).code, 'INFERENCE_INVALID_REQUEST');
  }
  assert.equal(db.rows('missions').length, 0);
});

test('oversized images are rejected before starting Python', async t => {
  const { post } = await serve(t);
  const image = Buffer.alloc(10 * 1024 * 1024 + 1); image.write('\x89PNG\r\n\x1a\n', 0, 'binary');
  const response = await post(upload({ imageBase64: image.toString('base64') }));
  assert.equal(response.status, 413);
});

test('failed prediction reports runtime error without partial mission, run, observations, or files', async t => {
  const { db, post, dataDir } = await serve(t, { runner: runtime({ async predict() { const error = new Error('Install the Python inference dependencies.'); error.code = 'INFERENCE_RUNTIME_UNAVAILABLE'; throw error; } }) });
  const response = await post(upload());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'INFERENCE_RUNTIME_UNAVAILABLE');
  assert.equal(db.rows('missions').length, 0);
  assert.equal(db.rows('inference_runs').length, 0);
  assert.equal(db.rows('observations').length, 0);
  assert.equal((await fs.readdir(path.join(dataDir, 'inference')).catch(() => [])).length, 0);
});

test('malformed model output is rejected before any evidence is stored', async t => {
  const { db, post } = await serve(t, { runner: runtime({ async predict() { return { predictions: [{ classId: 12, className: 'land_mines', confidence: 1.2 }], image: { width: 2, height: 2 } }; } }) });
  assert.equal((await post(upload({ latitude: 0, longitude: 0 }))).status, 502);
  assert.equal(db.rows('missions').length, 0);
  assert.equal(db.rows('observations').length, 0);
});

test('file endpoint rejects traversal and does not serve unregistered generated names', async t => {
  const { base, dataDir } = await serve(t);
  await fs.mkdir(path.join(dataDir, 'inference'), { recursive: true });
  const secret = 'a'.repeat(32) + '-original.png';
  await fs.writeFile(path.join(dataDir, 'inference', secret), 'not a registered artifact');
  for (const name of ['..%2Fsecret', '..%5Csecret', 'requirements.txt', secret]) assert.equal((await fetch(base + '/api/inference/files/' + name)).status, 404);
});

test('status distinguishes a validated model from missing Python dependencies', async t => {
  const { base } = await serve(t, { runner: runtime({ async status() { const error = new Error('Python runtime not found. Set INFERENCE_PYTHON.'); error.code = 'INFERENCE_RUNTIME_UNAVAILABLE'; throw error; } }) });
  const response = await fetch(base + '/api/inference/status');
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.ready, false);
  assert.equal(status.model.sha256, HASH);
  assert.equal(status.error.code, 'INFERENCE_RUNTIME_UNAVAILABLE');
  assert.equal(status.limits.maxImageBytes, 10485760);
});

test('Python adapter handles paths with spaces, structured JSON, and process failures', async t => {
  const { createPythonRunner } = require('../inference/runner');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terra python test '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, 'adapter fixture.cjs');
  await fs.writeFile(scriptPath, `let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const data=JSON.parse(input);if(data.inputPath==='fail'){process.stdout.write(JSON.stringify({ok:false,error:{code:'INFERENCE_INVALID_IMAGE',message:'Invalid image bytes.'}}));process.exitCode=2;}else process.stdout.write(JSON.stringify({ok:true,received:data}));});`);
  const runner = createPythonRunner({ python: process.execPath, scriptPath });
  const result = await runner.predict({ inputPath: 'image path ; no shell $(command)', confidence: 0.7 });
  assert.equal(result.received.inputPath, 'image path ; no shell $(command)');
  assert.equal(result.received.confidence, 0.7);
  await assert.rejects(runner.predict({ inputPath: 'fail' }), error => error.code === 'INFERENCE_INVALID_IMAGE');
});

test('Python adapter times out stuck status checks', async t => {
  const { createPythonRunner } = require('../inference/runner');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terra timeout '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, 'stuck.cjs');
  await fs.writeFile(scriptPath, 'setInterval(()=>{},1000);');
  const runner = createPythonRunner({ python: process.execPath, scriptPath, statusTimeoutMs: 100 });
  await assert.rejects(runner.status(), error => error.code === 'INFERENCE_TIMEOUT');
});

test('unknown class IDs cannot pass output validation through omitted class names', async t => {
  const invalidRunner = runtime({ async predict(request) {
    await fs.writeFile(request.annotatedPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return { ok: true, model: { sha256: HASH, task: 'detect' }, image: { width: 2, height: 2 },
      predictions: [{ classId: 99, confidence: 0.9, bbox: [0, 0, 2, 2], normalizedCenter: { x: 0.5, y: 0.5 } }] };
  } });
  const { post, db } = await serve(t, { runner: invalidRunner });
  assert.equal((await post(upload())).status, 502);
  assert.equal(db.rows('inference_runs').length, 0);
});

test('a runtime failure invalidates earlier ready status instead of displaying stale readiness', async t => {
  const { post, base } = await serve(t, { runner: runtime({ async predict() { throw Object.assign(new Error('The model runtime is no longer available.'), { code: 'INFERENCE_MODEL_INVALID' }); } }) });
  assert.equal((await (await fetch(base + '/api/inference/status')).json()).ready, true);
  assert.equal((await post(upload())).status, 503);
  const status = await (await fetch(base + '/api/inference/status')).json();
  assert.equal(status.ready, false);
  assert.equal(status.error.code, 'INFERENCE_MODEL_INVALID');
});

test('saved run exposes image URLs so reports can retain image-only inference references', async t => {
  const { post, db } = await serve(t);
  const response = await post(upload());
  const run = await response.json();
  const [saved] = db.rows('inference_runs');
  assert.equal(saved.image_url, run.imageUrl);
  assert.equal(saved.annotated_image_url, run.annotatedImageUrl);
});

test('metadata write failure rolls back newly created mission, observations and generated images', async t => {
  const { post, db, dataDir } = await serve(t);
  const collection = db.collection;
  db.collection = name => name === 'inference_runs'
    ? { ...collection(name), insertOne: async () => { throw new Error('Simulated disk persistence failure'); } }
    : collection(name);
  const response = await post(upload({ latitude: 0, longitude: 0 }));
  assert.equal(response.status, 500);
  assert.equal(db.rows('observations').length, 0);
  assert.equal(db.rows('missions').length, 0);
  assert.equal(db.rows('inference_runs').length, 0);
  assert.equal((await fs.readdir(path.join(dataDir, 'inference'))).length, 0);
});

test('real checkpoint runs through HTTP and returns registered annotated output (opt-in)', { skip: process.env.INFERENCE_REAL_TEST !== '1' }, async t => {
  const { createPythonRunner } = require('../inference/runner');
  const imageBase64 = process.env.INFERENCE_TEST_IMAGE
    ? (await fs.readFile(process.env.INFERENCE_TEST_IMAGE)).toString('base64')
    : 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKUlEQVR4nO3NMQEAAAjDMMD07GMCvlRA00nqs3m9AwAAAAAAAAAAgMMWdwQBpeOLzGIAAAAASUVORK5CYII=';
  const { post, base, db } = await serve(t, { runner: createPythonRunner() });
  const status = await (await fetch(base + '/api/inference/status')).json();
  assert.equal(status.ready, true, JSON.stringify(status.error));
  const response = await post({ imageBase64, filename: 'runtime-smoke.png', missionId: 'SAMPLE-TV001', confidence: 0.25 });
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  assert.equal(result.model.sha256, HASH);
  assert.notEqual(result.missionId, 'SAMPLE-TV001');
  assert.ok(Array.isArray(result.predictions));
  assert.ok(result.image.width > 0);
  assert.ok(result.image.height > 0);
  assert.equal(result.persistedObservations, 0);
  assert.equal(db.rows('observations').length, 0);
  const original = await fetch(base + result.imageUrl);
  assert.equal(Buffer.from(await original.arrayBuffer()).toString('base64'), imageBase64);
  const annotation = await fetch(base + result.annotatedImageUrl);
  assert.equal(annotation.status, 200);
  const bytes = Buffer.from(await annotation.arrayBuffer());
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  assert.ok(bytes.length > 100);
});
