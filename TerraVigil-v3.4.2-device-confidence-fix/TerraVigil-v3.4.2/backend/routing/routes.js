'use strict';

const express = require('express');
const { calculateRoute, noPath, LIMITS } = require('./engine');
const { validCoordinate, distanceM } = require('./geometry');

const PUBLIC_ERRORS = Object.freeze({
  ROUTE_INVALID_REQUEST: { status: 400, message: 'Provide a valid JSON body with distinct start/end coordinates, a standoff from 3.5 to 20 metres, and a caution weight from 0 to 1. The optional sessionId must exactly match the mission.' },
  ROUTE_MISSION_NOT_FOUND: { status: 404, message: 'The requested mission was not found.' },
  ROUTE_UNAVAILABLE: { status: 503, message: 'Route computation is temporarily unavailable. Try again later.' },
});

function sendError(res, code) {
  const error = PUBLIC_ERRORS[code];
  res.status(error.status).json({ code, message: error.message });
}

// Register this after the app's JSON parser to sanitize parser failures before
// dispatch; it also handles malformed percent escapes inside this router.
function routeJsonErrorHandler(error, req, res, next) {
  const routeRequest = req.method === 'POST' && /^\/missions\/[^/]+\/route\/?$/.test(req.path);
  const invalidInput = error instanceof URIError || (error && [
    'entity.parse.failed', 'entity.too.large', 'encoding.unsupported',
    'charset.unsupported', 'request.aborted', 'request.size.invalid',
  ].includes(error.type));
  if (routeRequest && invalidInput && !res.headersSent) return sendError(res, 'ROUTE_INVALID_REQUEST');
  return next(error);
}

function validateRequest(missionId, body) {
  if (typeof missionId !== 'string' || missionId.length === 0 || missionId.length > 200 || /[\u0000-\u001f\u007f]/.test(missionId) ||
      !body || typeof body !== 'object' || Array.isArray(body) || !validCoordinate(body.start) || !validCoordinate(body.end)) return null;
  if (Object.hasOwn(body, 'sessionId') && (typeof body.sessionId !== 'string' || body.sessionId !== missionId)) return null;
  const minStandoffM = body.minStandoffM === undefined ? 5 : body.minStandoffM;
  const cautionWeight = body.cautionWeight === undefined ? 0.6 : body.cautionWeight;
  if (typeof minStandoffM !== 'number' || !Number.isFinite(minStandoffM) || minStandoffM < 3.5 || minStandoffM > 20 ||
      typeof cautionWeight !== 'number' || !Number.isFinite(cautionWeight) || cautionWeight < 0 || cautionWeight > 1 ||
      distanceM(body.start, body.end) < 0.01) return null;
  return { sessionId: missionId, start: { lat: body.start.lat, lon: body.start.lon }, end: { lat: body.end.lat, lon: body.end.lon }, minStandoffM, cautionWeight };
}

async function loadEvidence(db, collection, missionId) {
  let cursor = db.collection(collection).find({ mission_id: missionId }, {
    projection: { mission_id: 1, latitude: 1, longitude: 1, target_location_known: 1 },
    maxTimeMS: LIMITS.databaseTimeoutMs,
  });
  // MongoDB bounds the transfer before toArray; the fallback supports simple
  // collection adapters, whose results are still rejected if over the cap.
  if (typeof cursor.limit === 'function') cursor = cursor.limit(LIMITS.maxEvidence + 1);
  const rows = await cursor.toArray();
  if (!Array.isArray(rows)) throw new Error('Invalid evidence result');
  if (rows.some(row => !row || row.mission_id !== missionId)) throw new Error('Unexpected evidence mission');
  return rows.map(row => ({ lat: row.latitude, lon: row.longitude, confirmed: collection === 'detections', targetLocationKnown: row.target_location_known }));
}

async function loadMission(connectDB, missionId) {
  const db = await connectDB();
  const mission = await db.collection('missions').findOne({ mission_id: missionId }, {
    projection: { mission_id: 1 }, maxTimeMS: LIMITS.databaseTimeoutMs,
  });
  if (!mission) return null;
  if (mission.mission_id !== missionId) throw new Error('Unexpected mission');
  const [detections, observations] = await Promise.all([
    loadEvidence(db, 'detections', missionId), loadEvidence(db, 'observations', missionId),
  ]);
  return [...detections, ...observations];
}

async function withDeadline(operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Route data timeout')), LIMITS.databaseTimeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

function createRoutingRouter({ connectDB } = {}) {
  if (typeof connectDB !== 'function') throw new TypeError('A database connector is required');
  const router = express.Router();
  router.post('/missions/:mission_id/route', async (req, res) => {
    const request = validateRequest(req.params.mission_id, req.body);
    if (!request) return sendError(res, 'ROUTE_INVALID_REQUEST');
    try {
      const evidence = await withDeadline(loadMission(connectDB, request.sessionId));
      if (evidence === null) return sendError(res, 'ROUTE_MISSION_NOT_FOUND');
      if (evidence.length > LIMITS.maxEvidence) {
        return res.json(noPath(request.sessionId, 'The mission evidence exceeds the 1,000 record limit. No evidence has been omitted to produce a route.', 'ROUTE_EVIDENCE_LIMIT'));
      }
      if (evidence.some(row => row.targetLocationKnown === false)) {
        return res.json(noPath(request.sessionId, 'This mission includes image observations without measured target locations. Image coordinates cannot be used to calculate hazard standoff.', 'ROUTE_UNLOCALIZED_EVIDENCE'));
      }
      return res.json(calculateRoute({ ...request, evidence }));
    } catch (_error) {
      // Deliberately do not publish DB URLs, credentials, stack traces, arbitrary
      // error messages, or status codes supplied by underlying dependencies.
      return sendError(res, 'ROUTE_UNAVAILABLE');
    }
  });
  router.use(routeJsonErrorHandler);
  return router;
}

module.exports = { createRoutingRouter, routeJsonErrorHandler };
