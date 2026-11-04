'use strict';

const crypto = require('node:crypto');
const { isPractice } = require('../production-data');

class ReportError extends Error {
  constructor(code, status, message, narrativeError = null) {
    super(message);
    this.name = 'ReportError';
    this.code = code;
    this.status = status;
    this.narrativeError = narrativeError;
  }
}

function canonical(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toJSON === 'function') return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => [key, canonical(value[key])]));
}

const canonicalJson = value => JSON.stringify(canonical(value));
const hashBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const hash = value => hashBytes(canonicalJson(value));

function validateSessionId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\x00-\x1f\x7f/\\]/.test(value) || value === '.' || value === '..') {
    throw new ReportError('INVALID_REQUEST', 400, 'sessionId must be a non-empty mission identifier without slashes or control characters (maximum 128 characters).');
  }
  // IDs are exact database keys. Do not trim or otherwise merge distinct missions.
  return value;
}

function recordId(record, kind, index) {
  return String(record._id ?? record[`${kind}_id`] ?? (kind === 'inference_run' ? record.run_id : undefined) ?? record.id ?? `${kind}:${index + 1}`);
}

function classification(row) {
  const explicit = String(row.classification || '').toLowerCase();
  if (['confirmed', 'unconfirmed_visual', 'unresolved_metal'].includes(explicit)) return explicit;
  const status = String(row.status || '').toUpperCase();
  if (status === 'CONFIRMED') return 'confirmed';
  if (status === 'UNCONFIRMED') {
    const device = String(row.device || '').trim().toLowerCase();
    const source = String(row.confirmation_source || '').trim().toLowerCase();
    return device === 'metal' || source === 'metal_sensor_only'
      ? 'unresolved_metal' : 'unconfirmed_visual';
  }
  if (status === 'UNRESOLVED_METAL') return 'unresolved_metal';
  return 'unknown';
}

function riskBand(row) {
  const value = String(row.risk_level ?? row.riskBand ?? '').toLowerCase();
  return ['high', 'medium', 'low'].includes(value) ? value : null;
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coordinates(row) {
  const latitude = numeric(row.latitude ?? row.lat ?? row.position?.lat);
  const longitude = numeric(row.longitude ?? row.lon ?? row.lng ?? row.position?.lon);
  return latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null;
}

function confidence(row) {
  const value = numeric(row.yolo_confidence ?? row.confidence ?? row.bestVisualConfidence);
  return value !== null && value >= 0 && value <= 1 ? value : null;
}

function isSynthetic(row) {
  return row.sample === true || row.synthetic === true || row.isSample === true || row.provenance?.synthetic === true;
}

async function loadSnapshot(db, sessionId) {
  const query = { mission_id: sessionId };
  const missions = await db.collection('missions').find(query).toArray();
  if (!missions.length) throw new ReportError('MISSION_NOT_FOUND', 404, 'Mission not found.');
  const collections = ['detections', 'observations', 'telemetry', 'inference_runs', 'firebase_events'];
  const groups = await Promise.all(collections.map(name => db.collection(name).find(query).toArray()));
  const firebaseIndex = collections.indexOf('firebase_events');
  groups[firebaseIndex] = groups[firebaseIndex].map(({ fingerprint, ...event }) => event);
  const entries = [['missions', missions], ...collections.map((name, index) => [name, groups[index]])];
  for (const [, rows] of entries) {
    if (!Array.isArray(rows) || rows.some(row => !row || row.mission_id !== sessionId || (row.sessionId !== undefined && row.sessionId !== sessionId))) {
      throw new ReportError('REPORT_SOURCE_MISMATCH', 409, 'A source record does not belong to the requested mission. No report was created.');
    }
  }
  if (entries.some(([, rows]) => rows.some(isPractice))) throw new ReportError('REPORT_PRACTICE_DATA', 409, 'This mission contains simulated records. Restart the updated app to remove practice data before generating a report.');
  return {
    schema: 'terravigil-report-source-v1',
    sessionId,
    ...Object.fromEntries(entries.map(([name, rows]) => [name,
      rows.map(row => JSON.parse(canonicalJson(row))).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))
    ]))
  };
}

function summarize(snapshot) {
  const evidence = [...snapshot.detections, ...snapshot.observations];
  const confirmed = evidence.filter(row => classification(row) === 'confirmed');
  const coverage = snapshot.missions[0]?.coverage || {};
  const area = value => { const parsed = numeric(value); return parsed !== null && parsed >= 0 ? parsed : null; };
  return {
    confirmedMinesCount: confirmed.length,
    highRiskCount: confirmed.filter(row => riskBand(row) === 'high').length,
    mediumRiskCount: confirmed.filter(row => riskBand(row) === 'medium').length,
    lowRiskCount: confirmed.filter(row => riskBand(row) === 'low').length,
    unconfirmedVisualCount: evidence.filter(row => classification(row) === 'unconfirmed_visual').length,
    unresolvedMetalCount: evidence.filter(row => classification(row) === 'unresolved_metal').length,
    visualSweptAreaM2: area(coverage.visualSweptAreaM2 ?? coverage.visual_swept_area_m2),
    dualSweptAreaM2: area(coverage.dualSweptAreaM2 ?? coverage.dual_swept_area_m2)
  };
}

function factualSources(snapshot) {
  return [['missions', 'mission'], ['detections', 'detection'], ['observations', 'observation'], ['telemetry', 'telemetry'], ['inference_runs', 'inference_run'], ['firebase_events', 'firebase_event']]
    .flatMap(([collection, kind]) => (snapshot[collection] || []).map((row, index) => ({
      sessionId: snapshot.sessionId,
      sourceType: kind,
      sourceId: (kind === 'inference_run' ? row.run_id : row[`${kind}_id`]) == null ? null : String(kind === 'inference_run' ? row.run_id : row[`${kind}_id`]),
      sourceRecordId: recordId(row, kind, index),
      document: `${kind} record`,
      section: 'Frozen source appendix',
      snippet: canonicalJson(row),
      sha256: hash(row)
    })));
}

function formulaVersion(snapshot) {
  const values = [...snapshot.missions, ...snapshot.detections, ...snapshot.observations]
    .map(row => row.formula_version ?? row.formulaVersion ?? row.risk_inputs?.formula_version ?? row.riskInputs?.formulaVersion)
    .filter(value => typeof value === 'string' && value.trim());
  const unique = [...new Set(values)].sort();
  return unique.length ? unique.join(', ') : 'not-recorded';
}

module.exports = { ReportError, canonicalJson, hash, hashBytes, validateSessionId, loadSnapshot, summarize,
  classification, riskBand, coordinates, confidence, isSynthetic, recordId, factualSources, formulaVersion };
