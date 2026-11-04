'use strict';

// Bundled, read-only simulation. Never imports MongoDB, model runtimes or keys.
const fixture = require('./fixture.json');
const { calculateRoute } = require('../routing/engine');
const { validCoordinate, distanceM } = require('../routing/geometry');
const MISSION_ID = fixture.mission.mission_id;
const clone = value => structuredClone(value);

function metadata() {
  return {
    mission_id: MISSION_ID, synthetic: true, created: false, persistence: 'bundled-read-only',
    counts: { detections: fixture.detections.length, observations: fixture.observations.length, telemetry: fixture.telemetry.length },
    suggestedRoute: clone(fixture.mission.sample_route),
  };
}

function statistics() {
  const risk = {};
  for (const band of ['low', 'medium', 'high']) {
    risk[band] = fixture.detections.filter(row => row.risk_level === band.toUpperCase()).length;
  }
  return {
    mission_id: MISSION_ID, synthetic: true,
    total_records: fixture.detections.length + fixture.observations.length,
    layer_1: { confirmed: fixture.detections.length }, layer_2: { unconfirmed: fixture.observations.length },
    risk, risk_scope: 'confirmed detections only',
  };
}

function answer(question) {
  const stats = statistics();
  const prefix = 'Simulation response — computed from the bundled sample; no AI model or live sensors were used. ';
  let content = `${MISSION_ID} contains ${stats.total_records} synthetic records: ${stats.layer_1.confirmed} dual-sensor confirmed examples and ${stats.layer_2.unconfirmed} visual-only diagnostic observations. The recorded survey has ${fixture.telemetry.length} telemetry points. Unconfirmed observations are not mine records.`;
  if (/train|model|accuracy|precision|recall|map50|epoch/i.test(question)) {
    content = 'The supplied train-2 run logs 100 epochs at 640 px. Final aggregate precision is 0.83852, recall 0.61580 and mAP@0.5 0.67145. The land_mines PR-curve AP@0.5 is 0.956; this is not overall accuracy. The SRS specifies 416 px edge inference. No TensorRT/ONNX artifact or edge performance validation is supplied. These training measurements do not validate the synthetic mission.';
  } else if (/risk|high|medium|low/i.test(question)) {
    content = `The four simulated confirmed detections have ${stats.risk.high} high, ${stats.risk.medium} medium and ${stats.risk.low} low stored risk labels. The four unconfirmed visual observations have no mine risk label and are excluded from confirmed risk totals.`;
  } else if (/metal|confirm|sensor/i.test(question)) {
    content = 'Four examples contain both a visual land_mines detection above 0.70 confidence and a simulated metal signal. Four visual-only observations remain unconfirmed diagnostics. The SRS specifies a 1 cm metal-detector range; this fixture represents a separate close-range confirmation step, not metal detection from the 12 m aerial track.';
  } else if (/telemetry|track|battery|altitude|flight/i.test(question)) {
    content = 'The simulated flight has 20 recorded points from 09:00:00 to 09:09:30 UTC on 1 September 2026, a 12 m AGL survey altitude and a synthetic battery change from 98% to 79%. This is a completed recording, not a live aircraft feed.';
  } else if (/safe|clear|enter|cross|route/i.test(question)) {
    content = 'The route planner can compute an advisory route around this sample’s recorded points. It does not assess real terrain or unknown hazards and cannot certify a cleared route. The sample locations are fictional.';
  } else if (/coverage|swept|area/i.test(question)) {
    content = 'The sample provides a georeferenced flight track. Calibrated camera and metal swath measurements are absent, so surveyed area and ground clearance are not asserted.';
  }
  return { mission_id: MISSION_ID, synthetic: true, answer: prefix + content };
}

function validateRoute(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !validCoordinate(body.start) || !validCoordinate(body.end) ||
      (body.sessionId !== undefined && body.sessionId !== MISSION_ID)) return null;
  const minStandoffM = body.minStandoffM === undefined ? 5 : body.minStandoffM;
  const cautionWeight = body.cautionWeight === undefined ? 0.6 : body.cautionWeight;
  if (typeof minStandoffM !== 'number' || !Number.isFinite(minStandoffM) || minStandoffM < 3.5 || minStandoffM > 20 ||
      typeof cautionWeight !== 'number' || !Number.isFinite(cautionWeight) || cautionWeight < 0 || cautionWeight > 1 || distanceM(body.start, body.end) < 0.01) return null;
  return { sessionId: MISSION_ID, start: body.start, end: body.end, minStandoffM, cautionWeight };
}

/** Returns null for requests outside this virtual mission in live mode. */
function dispatchSample(method, rawUrl, body, { exclusive = false } = {}) {
  const url = new URL(rawUrl, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/'; }
  catch { return { status: 400, body: { code: 'INVALID_REQUEST', message: 'Invalid URL.' } }; }
  const ok = value => ({ status: 200, body: clone(value) });
  const failure = (status, code, message) => ({ status, body: { code, message } });
  const readOnly = () => failure(405, 'SAMPLE_READ_ONLY', 'The built-in sample is read-only. Use the live backend for real mission data.');
  if (method !== 'GET' && body?.mission_id === MISSION_ID && ['/missions', '/detections', '/observations', '/telemetry', '/fusion/test'].includes(pathname)) return readOnly();
  if (pathname === '/sample-mission') {
    // POST is a read-only compatibility alias for older clients.
    return ['GET', 'POST'].includes(method) ? ok(metadata()) : readOnly();
  }
  if (exclusive && method === 'GET' && pathname === '/health') return ok({ status: 'ok', mode: 'simulation', database: 'not used', mission_id: MISSION_ID });
  if (exclusive && pathname === '/missions') return method === 'GET' ? ok([fixture.mission]) : readOnly();
  for (const collection of ['detections', 'observations', 'telemetry']) {
    if (exclusive && pathname === `/${collection}`) return method === 'GET' ? ok(fixture[collection]) : readOnly();
    const found = fixture[collection].find(row => pathname === `/${collection}/${row.detection_id ?? row.observation_id ?? row._id}`);
    if (found) return method === 'GET' ? ok(found) : readOnly();
  }
  const prefix = `/missions/${MISSION_ID}`;
  if (pathname === prefix || pathname.startsWith(prefix + '/')) {
    const suffix = pathname.slice(prefix.length);
    if (method === 'GET') {
      if (suffix === '') return ok(fixture.mission);
      if (suffix === '/statistics') return ok(statistics());
      if (suffix === '/training-context') return ok(fixture.training_context);
      if (suffix === '/summary') return ok({ mission: fixture.mission, statistics: statistics(), training_context: fixture.training_context });
      if (suffix === '/history') return ok([...fixture.detections, ...fixture.observations, ...fixture.telemetry].sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
      if (suffix === '/risk') return ok(fixture.detections);
      for (const collection of ['detections', 'observations', 'telemetry']) {
        if (suffix === `/${collection}`) return ok(fixture[collection]);
      }
      if (suffix === '/ask') {
        const questions = url.searchParams.getAll('q');
        if (questions.length !== 1 || !questions[0].trim() || questions[0].length > 1000) return failure(400, 'INVALID_REQUEST', 'Enter one question between 1 and 1,000 characters.');
        return ok(answer(questions[0].trim()));
      }
    }
    if (method === 'POST' && suffix === '/create-embeddings') return ok({
      mission_id: MISSION_ID, synthetic: true, status: 'ready', indexed_chunks: 0,
      source_hash: 'bundled-sample-v2', generation: 'simulation-v2', model: 'simulation-summary-no-embeddings', reused: true,
    });
    if (method === 'POST' && suffix === '/route') {
      const request = validateRoute(body);
      if (!request) return failure(400, 'ROUTE_INVALID_REQUEST', 'Choose distinct valid endpoints, a standoff from 3.5 to 20 m and a caution weight from 0 to 1.');
      const evidence = ['detections', 'observations'].flatMap(collection => fixture[collection].map(row => ({
        lat: row.latitude, lon: row.longitude, confirmed: collection === 'detections',
      })));
      return ok(calculateRoute({ ...request, evidence }));
    }
    if (method !== 'GET') return readOnly();
    return failure(404, 'SAMPLE_ENDPOINT_NOT_FOUND', 'This sample endpoint is not available.');
  }
  if (!exclusive) return null;
  if (method !== 'GET') return readOnly();
  return failure(404, 'NOT_FOUND', 'Only the bundled SAMPLE-TV001 mission is available in simulation mode.');
}

module.exports = { MISSION_ID, metadata, statistics, answer, validateRoute, dispatchSample };
