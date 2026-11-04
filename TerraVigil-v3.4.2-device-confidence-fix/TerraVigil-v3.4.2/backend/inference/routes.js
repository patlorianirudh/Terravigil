'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createPythonRunner, inferenceError } = require('./runner');
const manifest = require('../../inference/model.json');

const LIMITS = Object.freeze({ maxImageBytes: 10 * 1024 * 1024, maxImagePixels: 20000000, minConfidence: 0.01, maxConfidence: 1 });
const FILE_PATTERN = /^[a-f0-9]{32}-(?:original\.(?:png|jpg|webp)|annotated\.jpg)$/;
const ERROR_STATUS = {
  INFERENCE_INVALID_REQUEST: 400, INFERENCE_INVALID_IMAGE: 400, INFERENCE_IMAGE_TOO_LARGE: 413,
  INFERENCE_MISSION_NOT_FOUND: 404, INFERENCE_INVALID_OUTPUT: 502, INFERENCE_BUSY: 429,
  INFERENCE_RUNTIME_UNAVAILABLE: 503, INFERENCE_MODEL_MISSING: 503, INFERENCE_MODEL_INTEGRITY: 503,
  INFERENCE_MODEL_INVALID: 503, INFERENCE_TIMEOUT: 504,
};
function failure(res, error) {
  const known = ERROR_STATUS[error?.code];
  res.status(known || 500).json({ code: known ? error.code : 'INFERENCE_STORAGE_ERROR',
    message: known ? error.message : 'The inference result could not be saved. Check that the application data folder and database are writable.' });
}
function signature(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', mime: 'image/png' };
  if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { extension: 'jpg', mime: 'image/jpeg' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { extension: 'webp', mime: 'image/webp' };
  return null;
}
function validateUpload(body) {
  const invalid = message => { throw inferenceError('INFERENCE_INVALID_REQUEST', message); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Provide a JSON image upload.');
  if (typeof body.filename !== 'string' || !body.filename.trim() || body.filename.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(body.filename)) invalid('filename must be a printable image basename of at most 200 characters.');
  if (body.missionId !== undefined && (typeof body.missionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(body.missionId))) invalid('missionId must be a valid mission identifier.');
  const confidence = body.confidence === undefined ? 0.25 : body.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < LIMITS.minConfidence || confidence > 1) invalid('Confidence must be a number from 0.01 to 1.');
  const hasLatitude = Object.hasOwn(body, 'latitude');
  const hasLongitude = Object.hasOwn(body, 'longitude');
  if (hasLatitude !== hasLongitude || (hasLatitude && (
    typeof body.latitude !== 'number' || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90 ||
    typeof body.longitude !== 'number' || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180
  ))) invalid('Supply both latitude (-90 to 90) and longitude (-180 to 180) as numbers, or omit both.');
  if (typeof body.imageBase64 !== 'string' || !body.imageBase64) invalid('imageBase64 is required.');
  let encoded = body.imageBase64; let mime;
  if (encoded.startsWith('data:')) {
    const dataUrl = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(encoded);
    if (!dataUrl) invalid('Only JPEG, PNG and WebP data URLs are accepted.');
    mime = dataUrl[1]; encoded = encoded.slice(dataUrl[0].length);
  }
  if (encoded.length > Math.ceil(LIMITS.maxImageBytes / 3) * 4) throw inferenceError('INFERENCE_IMAGE_TOO_LARGE', 'Images must be at most 10 MiB.');
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) invalid('imageBase64 must contain canonical base64 image data.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) invalid('imageBase64 must contain canonical base64 image data.');
  if (bytes.length > LIMITS.maxImageBytes) throw inferenceError('INFERENCE_IMAGE_TOO_LARGE', 'Images must be at most 10 MiB.');
  const format = signature(bytes);
  if (!format || (mime && mime !== format.mime)) invalid('The image must contain JPEG, PNG or WebP bytes matching its data URL.');
  return { bytes, format, confidence, filename: body.filename, missionId: body.missionId, gps: hasLatitude ? { latitude: body.latitude, longitude: body.longitude } : null };
}
function validateOutput(result, threshold) {
  const invalid = () => { throw inferenceError('INFERENCE_INVALID_OUTPUT', 'The model returned malformed predictions or unexpected model metadata.'); };
  if (!result || result.model?.sha256 !== manifest.sha256 || result.model?.task !== 'detect' || !Array.isArray(result.predictions) || result.predictions.length > 300) invalid();
  const { width, height } = result.image || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > LIMITS.maxImagePixels) invalid();
  for (const prediction of result.predictions) {
    if (!prediction || !Number.isInteger(prediction.classId) || typeof prediction.className !== 'string' || manifest.classes[prediction.classId]?.name !== prediction.className ||
      typeof prediction.confidence !== 'number' || !Number.isFinite(prediction.confidence) || prediction.confidence < threshold - 1e-6 || prediction.confidence > 1 ||
      !Array.isArray(prediction.bbox) || prediction.bbox.length !== 4 || !prediction.bbox.every(value => typeof value === 'number' && Number.isFinite(value))) invalid();
    const [x1, y1, x2, y2] = prediction.bbox;
    if (x1 < 0 || y1 < 0 || x2 > width || y2 > height || x2 <= x1 || y2 <= y1 ||
      !Number.isFinite(prediction.normalizedCenter?.x) || !Number.isFinite(prediction.normalizedCenter?.y) ||
      Math.abs(prediction.normalizedCenter.x - (x1 + x2) / (2 * width)) > 1e-5 || Math.abs(prediction.normalizedCenter.y - (y1 + y2) / (2 * height)) > 1e-5) invalid();
  }
  return result;
}
function createInferenceRouter({ getDB, dataDir, runner = createPythonRunner() }) {
  if (typeof getDB !== 'function' || !dataDir) throw new TypeError('getDB and dataDir are required for model inference.');
  const router = express.Router();
  const filesDir = path.resolve(dataDir, 'inference');
  let busy = false; let cachedStatus; let checkedAt = 0; let checking;
  const modelInfo = () => ({ name: manifest.name, sha256: manifest.sha256, task: manifest.task, classes: manifest.classes, device: process.env.INFERENCE_DEVICE || 'cpu', trainingUltralytics: manifest.trainingUltralytics });
  router.getCachedStatus = () => ({ ...(cachedStatus || { ready: false, status: 'unchecked', model: modelInfo(), runtime: {} }), ...(busy ? { status: 'busy' } : {}), checkedAt: checkedAt ? new Date(checkedAt).toISOString() : null, limits: LIMITS });
  router.get('/inference/status', async (req, res) => {
    if (!cachedStatus || Date.now() - checkedAt > 60000) {
      if (!checking) checking = Promise.resolve().then(() => runner.status()).then(value => {
        if (value.ready !== true || value.model?.sha256 !== manifest.sha256) throw inferenceError('INFERENCE_MODEL_INVALID', 'The selected Python runtime did not validate the bundled model.');
        cachedStatus = { ready: true, status: 'ready', model: { ...modelInfo(), ...value.model }, runtime: value.runtime || {} };
      }).catch(error => {
        cachedStatus = { ready: false, status: 'unavailable', model: modelInfo(), runtime: {}, error: { code: error.code || 'INFERENCE_RUNTIME_UNAVAILABLE', message: error.message || 'The Python model runtime is unavailable.' } };
      }).finally(() => { checkedAt = Date.now(); checking = null; });
      await checking;
    }
    res.json({ ...router.getCachedStatus(), setup: { requirements: 'inference/requirements.txt', check: 'python inference/predict.py --check', pythonEnvironment: 'INFERENCE_PYTHON', deviceEnvironment: 'INFERENCE_DEVICE' } });
  });
  router.post('/inference/predict', async (req, res) => {
    let upload;
    try { upload = validateUpload(req.body); } catch (error) { return failure(res, error); }
    if (busy) return failure(res, inferenceError('INFERENCE_BUSY', 'Another image is being processed. Try again when it finishes.'));
    busy = true;
    const runId = randomUUID().replace(/-/g, '');
    const imageName = `${runId}-original.${upload.format.extension}`;
    const annotatedName = `${runId}-annotated.jpg`;
    const inputPath = path.join(filesDir, imageName);
    const annotatedPath = path.join(filesDir, annotatedName);
    let db; let createdMissionId; let missionId; let committed = false;
    try {
      db = await getDB();
      let mission;
      if (upload.missionId) {
        mission = await db.collection('missions').findOne({ mission_id: upload.missionId });
        if (!mission && upload.missionId !== 'SAMPLE-TV001') throw inferenceError('INFERENCE_MISSION_NOT_FOUND', 'The selected mission was not found.');
      }
      if (mission && !mission.sample && !mission.synthetic && mission.mission_id !== 'SAMPLE-TV001') missionId = mission.mission_id;
      else missionId = `INFERENCE-${runId.slice(0, 16).toUpperCase()}`;
      await fs.mkdir(filesDir, { recursive: true });
      await fs.writeFile(inputPath, upload.bytes, { flag: 'wx', mode: 0o600, flush: true });
      const result = validateOutput(await runner.predict({ inputPath, annotatedPath, confidence: upload.confidence }), upload.confidence);
      const annotatedFile = await fs.lstat(annotatedPath).catch(() => null);
      if (!annotatedFile?.isFile() || annotatedFile.isSymbolicLink() || annotatedFile.size < 4 || annotatedFile.size > 25 * 1024 * 1024) throw inferenceError('INFERENCE_INVALID_OUTPUT', 'The model did not produce a valid annotated image.');
      const handle = await fs.open(annotatedPath, 'r');
      try {
        const bytes = Buffer.alloc(4); await handle.read(bytes, 0, 4, 0);
        if (signature(bytes)?.extension !== 'jpg') throw inferenceError('INFERENCE_INVALID_OUTPUT', 'The annotated output is not a JPEG image.');
      } finally { await handle.close(); }
      const timestamp = new Date().toISOString();
      const imageUrl = `/api/inference/files/${imageName}`;
      const annotatedImageUrl = `/api/inference/files/${annotatedName}`;
      const model = { ...modelInfo(), ...result.model };
      const observations = upload.gps ? result.predictions.filter(item => item.className === 'land_mines').map((item, index) => ({
        _id: `${runId}-O${index + 1}`, observation_id: `${runId}-O${index + 1}`, mission_id: missionId, timestamp,
        ...upload.gps, class_id: item.classId, class_name: item.className, yolo_confidence: item.confidence,
        normalized_center: item.normalizedCenter, bounding_box: item.bbox, status: 'UNCONFIRMED', layer: 'LAYER_2',
        metal_detected: null, metal_signal: null, risk_level: null, model_id: model.name, model_sha256: model.sha256,
        inference_run_id: runId, image_path: imageUrl, annotated_image_path: annotatedImageUrl, sample: false, synthetic: false,
        location_source: 'user_supplied_image_location', target_location_known: false,
        confirmation_source: 'Visual model prediction only; GPS is the supplied image location, not a measured target location. No metal sensor was used.',
      })) : [];
      if (missionId !== mission?.mission_id) {
        createdMissionId = missionId;
        await db.collection('missions').insertOne({ _id: missionId, mission_id: missionId, date: timestamp, created_at: timestamp,
          location: `Image inference: ${upload.filename}`, status: 'COMPLETED', sample: false, synthetic: false, source: 'model_inference',
          notes: 'Image inference session. Visual predictions are unconfirmed; no flight, surveyed coverage or clearance is asserted.' });
      }
      if (observations.length) await db.collection('observations').insertMany(observations);
      const observationIds = observations.map(row => row.observation_id);
      await db.collection('inference_runs').insertOne({ _id: runId, run_id: runId, mission_id: missionId, timestamp, status: 'completed',
        model, predictions: result.predictions, image: result.image, image_file: imageName, annotated_file: annotatedName,
        image_url: imageUrl, annotated_image_url: annotatedImageUrl,
        original_filename: upload.filename, confidence_threshold: upload.confidence, image_location: upload.gps,
        location_source: upload.gps ? 'user_supplied_image_location' : null, target_location_known: false,
        persisted_observation_ids: observationIds, synthetic: false });
      committed = true;
      // A successful prediction itself validates the runtime; avoid another cold load.
      cachedStatus = { ready: true, status: 'ready', model, runtime: result.runtime || {} }; checkedAt = Date.now();
      res.status(201).json({ runId, missionId, model, predictions: result.predictions, image: result.image,
        imageUrl, annotatedImageUrl, persistedObservations: observations.length, observationIds,
        locationSource: upload.gps ? 'user_supplied_image_location' : null, targetLocationKnown: false });
    } catch (error) {
      if (ERROR_STATUS[error?.code] >= 502) {
        cachedStatus = { ready: false, status: 'unavailable', model: modelInfo(), runtime: {}, error: { code: error.code, message: error.message } };
        checkedAt = Date.now();
      }
      if (!committed) {
        if (db) {
          await db.collection('inference_runs').deleteOne({ run_id: runId }).catch(() => {});
          await db.collection('observations').deleteMany({ inference_run_id: runId }).catch(() => {});
          if (createdMissionId) await db.collection('missions').deleteOne({ mission_id: createdMissionId }).catch(() => {});
        }
        await Promise.all([inputPath, annotatedPath].map(filename => fs.rm(filename, { force: true }).catch(() => {})));
      }
      failure(res, error);
    } finally { busy = false; }
  });
  router.get('/inference/files/:filename', async (req, res) => {
    const filename = req.params.filename;
    if (!FILE_PATTERN.test(filename)) return res.status(404).json({ code: 'NOT_FOUND', message: 'Image not found.' });
    try {
      const db = await getDB();
      const run = await db.collection('inference_runs').findOne({ run_id: filename.slice(0, 32), status: 'completed' });
      if (!run || ![run.image_file, run.annotated_file].includes(filename)) return res.status(404).json({ code: 'NOT_FOUND', message: 'Image not found.' });
      const filenamePath = path.join(filesDir, filename);
      const info = await fs.lstat(filenamePath);
      if (!info.isFile() || info.isSymbolicLink()) return res.status(404).json({ code: 'NOT_FOUND', message: 'Image not found.' });
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
      return res.sendFile(filenamePath, error => { if (error && !res.headersSent) res.status(404).json({ code: 'NOT_FOUND', message: 'Image not found.' }); });
    } catch { return res.status(404).json({ code: 'NOT_FOUND', message: 'Image not found.' }); }
  });
  router.use((error, req, res, next) => {
    if (req.path.startsWith('/inference/') && !res.headersSent && (error instanceof URIError || ['entity.parse.failed', 'entity.too.large'].includes(error.type))) return failure(res, inferenceError(error.type === 'entity.too.large' ? 'INFERENCE_IMAGE_TOO_LARGE' : 'INFERENCE_INVALID_REQUEST', 'Provide a valid JPEG, PNG or WebP upload of at most 10 MiB.'));
    return next(error);
  });
  return router;
}
module.exports = { createInferenceRouter, LIMITS };
