'use strict';

const crypto = require('node:crypto');
const { RagError, isRagError } = require('./errors');

const SOURCE_ORDER = { mission: 0, summary: 1, detection: 2, observation: 3, telemetry: 4, reference: 5, inference_run: 6 };
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];
const STATUS_LEVELS = ['CONFIRMED', 'UNCONFIRMED'];

function canonical(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const next = canonical(value[key]);
    if (next !== undefined) result[key] = next;
  }
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function recordId(row, sourceType, index) {
  if (row && row._id !== undefined && row._id !== null) return String(row._id);
  const logical = row && (row.detection_id || row.observation_id || row.telemetry_id || row.id);
  if (logical !== undefined && logical !== null && String(logical).trim()) return String(logical);
  return `${sourceType}:${index + 1}`;
}

function logicalId(row, sourceType) {
  const field = sourceType === 'detection' ? 'detection_id' :
    sourceType === 'observation' ? 'observation_id' : 'telemetry_id';
  if (row && row[field] !== undefined && row[field] !== null && String(row[field]).trim()) {
    return String(row[field]);
  }
  return null;
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasValue(row, key) {
  return row && Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined;
}

function isoDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function category(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().toUpperCase();
}

function coordinate(row, names) {
  for (const name of names) if (hasValue(row, name)) return { name, value: row[name] };
  return null;
}

function projectEvidence(row, sourceType, index, missionId) {
  const issues = [];
  const id = recordId(row, sourceType, index);
  const source = {
    mission_id: missionId,
    source_type: sourceType,
    source_id: logicalId(row, sourceType),
    record_id: id,
    section: sourceType[0].toUpperCase() + sourceType.slice(1),
    document: `${sourceType} record`
  };
  const facts = {};

  if (hasValue(row, 'mission_id')) facts.mission_id = String(row.mission_id);
  const logical = logicalId(row, sourceType);
  if (logical !== null) facts.logical_id = logical;

  const lat = coordinate(row, ['latitude', 'lat']);
  const lon = coordinate(row, ['longitude', 'lon', 'lng']);
  if (lat) {
    const value = numeric(lat.value);
    if (value === null || value < -90 || value > 90) issues.push('invalid_latitude');
    else facts.latitude = value;
  }
  if (lon) {
    const value = numeric(lon.value);
    if (value === null || value < -180 || value > 180) issues.push('invalid_longitude');
    else facts.longitude = value;
  }

  for (const field of ['timestamp', 'created_at']) {
    if (hasValue(row, field)) {
      const value = isoDate(row[field]);
      if (value === null) issues.push(`invalid_${field}`);
      facts[field] = value;
    }
  }
  if (facts.timestamp || facts.created_at) {
    facts.event_time = facts.timestamp || facts.created_at;
  }

  const altitudeKey = ['altitude', 'height', 'altitude_m'].find(name => hasValue(row, name));
  if (altitudeKey) {
    const value = numeric(row[altitudeKey]);
    if (value === null) issues.push('invalid_altitude');
    else facts.altitude = value;
  }

  for (const [field, aliases] of [
    ['yolo_confidence', ['yolo_confidence', 'confidence']],
    ['metal_signal', ['metal_signal', 'metal_strength']]
  ]) {
    const key = aliases.find(name => hasValue(row, name));
    if (key) {
      const value = numeric(row[key]);
      if (value === null || value < 0 || value > 1) issues.push(`invalid_${field}`);
      else facts[field] = value;
    }
  }

  if (hasValue(row, 'metal_detected')) {
    if (typeof row.metal_detected === 'boolean') facts.metal_detected = row.metal_detected;
    else if (typeof row.metal_detected === 'string' && /^(true|false)$/i.test(row.metal_detected.trim())) {
      facts.metal_detected = row.metal_detected.trim().toLowerCase() === 'true';
    } else {
      issues.push('invalid_metal_detected');
    }
  }

  if (hasValue(row, 'status')) {
    facts.status = category(row.status);
    if (!facts.status) issues.push('invalid_status');
  }
  if (hasValue(row, 'risk_level')) {
    facts.risk_level = category(row.risk_level);
    if (!facts.risk_level) issues.push('invalid_risk_level');
  }
  for (const field of ['layer', 'height_profile_id', 'model_id', 'image_path', 'class_name', 'class_id', 'location_source', 'model_sha256', 'confirmation_source', 'inference_run_id']) {
    if (hasValue(row, field) && (typeof row[field] === 'string' || typeof row[field] === 'number')) {
      facts[field] = String(row[field]);
    }
  }
  if (typeof row.synthetic === 'boolean') facts.synthetic = row.synthetic;
  if (typeof row.target_location_known === 'boolean') facts.target_location_known = row.target_location_known;
  if (hasValue(row, 'normalized_center') && row.normalized_center && typeof row.normalized_center === 'object') {
    const x = numeric(row.normalized_center.x);
    const y = numeric(row.normalized_center.y);
    if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) issues.push('invalid_normalized_center');
    else facts.normalized_center = { x, y };
  }

  if (facts.status === 'CONFIRMED' && facts.metal_detected === false) issues.push('status_sensor_conflict');
  if (facts.status === 'UNCONFIRMED' && facts.metal_detected === true) issues.push('status_sensor_conflict');
  if (facts.status && !STATUS_LEVELS.includes(facts.status)) issues.push('unknown_status');
  if (facts.risk_level && !RISK_LEVELS.includes(facts.risk_level)) issues.push('unknown_risk_level');

  const cleanIssues = [...new Set(issues)].sort();
  source.facts = facts;
  source.validation_issues = cleanIssues;
  source.text = canonicalJson({ facts, validation_issues: cleanIssues });
  return source;
}

function projectMission(row, index, missionId, conflicts) {
  const issues = [];
  const facts = { mission_id: missionId };
  for (const field of ['location', 'status', 'date', 'created_at', 'started_at', 'completed_at']) {
    if (!hasValue(row, field)) continue;
    if (field === 'status') facts.status = category(row[field]);
    else if (['date', 'created_at', 'started_at', 'completed_at'].includes(field)) {
      const value = isoDate(row[field]);
      if (value === null) issues.push(`invalid_${field}`);
      facts[field] = value;
    } else if (typeof row[field] === 'string' || typeof row[field] === 'number') {
      facts[field] = String(row[field]);
    }
  }
  for (const field of conflicts) issues.push(`conflicting_mission_${field}`);
  const source = {
    mission_id: missionId,
    source_type: 'mission',
    source_id: missionId,
    record_id: recordId(row, 'mission', index),
    section: 'Mission',
    document: 'mission registry record',
    facts,
    validation_issues: [...new Set(issues)].sort()
  };
  if (typeof row.synthetic === 'boolean' || row.sample === true) facts.synthetic = row.synthetic === true || row.sample === true;
  source.text = canonicalJson({ facts, validation_issues: source.validation_issues });
  return source;
}

function makeSummary(missionId, evidence, telemetry, missionDocuments, conflicts) {
  const records = evidence;
  const statusCounts = {
    confirmed: records.filter(r => r.facts.status === 'CONFIRMED').length,
    unconfirmed: records.filter(r => r.facts.status === 'UNCONFIRMED').length,
    unknown: records.filter(r => !STATUS_LEVELS.includes(r.facts.status)).length
  };
  const riskCounts = {
    low: records.filter(r => r.facts.risk_level === 'LOW').length,
    medium: records.filter(r => r.facts.risk_level === 'MEDIUM').length,
    high: records.filter(r => r.facts.risk_level === 'HIGH').length,
    unknown: records.filter(r => !RISK_LEVELS.includes(r.facts.risk_level)).length
  };
  const validConfidence = records.map(r => r.facts.yolo_confidence).filter(Number.isFinite);
  const eventTimes = telemetry.map(r => r.facts.event_time).filter(Boolean).sort();
  const highestRisk = RISK_LEVELS.slice().reverse().find(level => riskCounts[level.toLowerCase()] > 0) || null;
  const facts = {
    mission_id: missionId,
    synthetic: [...missionDocuments, ...evidence, ...telemetry].some(source => source.facts.synthetic === true),
    total_records: records.length,
    confirmed: statusCounts.confirmed,
    unconfirmed: statusCounts.unconfirmed,
    risk: riskCounts,
    status_counts: statusCounts,
    risk_counts: riskCounts,
    unknown_status_count: statusCounts.unknown,
    unknown_risk_count: riskCounts.unknown,
    highest_risk: highestRisk,
    max_yolo_confidence: validConfidence.length ? Math.max(...validConfidence) : null,
    metal_detection_count: records.filter(r => r.facts.metal_detected === true).length,
    telemetry_points: telemetry.length,
    first_telemetry_timestamp: eventTimes[0] || null,
    last_telemetry_timestamp: eventTimes[eventTimes.length - 1] || null,
    mission_registry_records: missionDocuments.length,
    metadata_conflicts: conflicts
  };
  const source = {
    mission_id: missionId,
    source_type: 'summary',
    source_id: missionId,
    record_id: null,
    section: 'Summary',
    document: 'backend-computed mission summary',
    facts,
    validation_issues: conflicts.map(field => `conflicting_mission_${field}`)
  };
  source.text = canonicalJson({ facts, validation_issues: source.validation_issues });
  return source;
}

function createSnapshot(records, missionId) {
  if (!records || typeof records !== 'object') throw new RagError('INVALID_REQUEST', 400, 'Mission records are required.');
  if (typeof missionId !== 'string' || !missionId.trim()) {
    throw new RagError('INVALID_REQUEST', 400, 'mission_id must be a non-empty string.');
  }
  const missions = Array.isArray(records.missions) ? records.missions.filter(Boolean) : [];
  if (!missions.some(row => String(row.mission_id) === missionId)) {
    throw new RagError('MISSION_NOT_FOUND', 404, 'Mission not found.');
  }
  const byMission = name => (Array.isArray(records[name]) ? records[name] : [])
    .filter(row => row && String(row.mission_id) === missionId);
  const missionRows = missions.filter(row => String(row.mission_id) === missionId);
  const evidenceRows = [...byMission('detections'), ...byMission('observations')];
  const telemetryRows = byMission('telemetry');
  const metadataFields = ['location', 'status'];
  const conflicts = metadataFields.filter(field => {
    const values = missionRows.map(row => row[field]).filter(value => value !== undefined && value !== null)
      .map(value => String(value));
    return new Set(values).size > 1;
  });
  const missionDocuments = missionRows.map((row, index) => projectMission(row, index, missionId, conflicts));
  const detectionDocuments = byMission('detections').map((row, index) => projectEvidence(row, 'detection', index, missionId));
  const observationDocuments = byMission('observations').map((row, index) => projectEvidence(row, 'observation', index, missionId));
  const telemetryDocuments = telemetryRows.map((row, index) => projectEvidence(row, 'telemetry', index, missionId));
  const evidenceDocuments = [...detectionDocuments, ...observationDocuments];
  const summary = makeSummary(missionId, evidenceDocuments, telemetryDocuments, missionDocuments, conflicts);
  const referenceDocuments = byMission('mission_documents').map((row, index) => {
    const facts = { title: String(row.title || 'Project reference'), content: String(row.text || ''), provenance: String(row.provenance || 'User supplied project document') };
    return { mission_id: missionId, source_type: 'reference', source_id: String(row._id || `reference-${index}`),
      record_id: recordId(row, 'reference', index), document: facts.title, section: String(row.section || 'Project reference'),
      facts, validation_issues: [], text: canonicalJson(facts) };
  });
  const inferenceDocuments = byMission('inference_runs').map((row, index) => {
    const facts = { mission_id: missionId, filename: row.original_filename, model: row.model,
      predictions: Array.isArray(row.predictions) ? row.predictions : [], timestamp: row.timestamp,
      image_location: row.image_location ?? null, location_source: row.location_source ?? null,
      target_location_known: row.target_location_known === true, synthetic: row.synthetic === true,
      persisted_observation_ids: row.persisted_observation_ids || [],
      interpretation: 'Image model outputs only. Image location is not a measured target coordinate. No metal confirmation was performed.' };
    return { mission_id: missionId, source_type: 'inference_run', source_id: row.run_id || String(row._id),
      record_id: String(row._id || row.run_id || `inference-${index}`), document: `Image inference ${row.original_filename || row.run_id || index + 1}`,
      section: 'Trained model output', facts, validation_issues: [], text: canonicalJson(facts) };
  });
  if (inferenceDocuments.length) {
    summary.facts.synthetic = summary.facts.synthetic || inferenceDocuments.some(row => row.facts.synthetic === true);
    summary.facts.image_inference_runs = inferenceDocuments.length;
    summary.facts.image_predictions = inferenceDocuments.reduce((sum, row) => sum + row.facts.predictions.length, 0);
    summary.facts.unlocalized_image_predictions = inferenceDocuments.filter(row => !row.facts.target_location_known).reduce((sum, row) => sum + row.facts.predictions.length, 0);
    summary.text = canonicalJson({ facts: summary.facts, validation_issues: summary.validation_issues });
  }
  const documents = [...missionDocuments, summary, ...detectionDocuments, ...observationDocuments, ...telemetryDocuments, ...referenceDocuments, ...inferenceDocuments]
    .sort((a, b) => (SOURCE_ORDER[a.source_type] - SOURCE_ORDER[b.source_type]) ||
      String(a.record_id ?? '').localeCompare(String(b.record_id ?? '')) ||
      canonicalJson(a.facts).localeCompare(canonicalJson(b.facts)) ||
      canonicalJson(a.validation_issues).localeCompare(canonicalJson(b.validation_issues)));
  const sourceHash = hash({
    schema: 'terra-vigil-rag-v1',
    fact_model: 'deterministic-facts-v1',
    chunk_version: 'rag-chunk-v1',
    mission_id: missionId,
    documents: documents.map(({ text, ...document }) => document)
  });
  return { mission_id: missionId, source_hash: sourceHash, documents, summary };
}

async function loadMissionSnapshot(db, missionId) {
  try {
    const collection = name => db.collection(name);
    const missionRows = await collection('missions').find({ mission_id: missionId }).toArray();
    if (!missionRows.length) throw new RagError('MISSION_NOT_FOUND', 404, 'Mission not found.');
    const [detections, observations, telemetry, mission_documents, inference_runs] = await Promise.all([
      collection('detections').find({ mission_id: missionId }).toArray(),
      collection('observations').find({ mission_id: missionId }).toArray(),
      collection('telemetry').find({ mission_id: missionId }).toArray(),
      collection('mission_documents').find({ mission_id: missionId }).toArray(),
      collection('inference_runs').find({ mission_id: missionId }).toArray()
    ]);
    return createSnapshot({ missions: missionRows, detections, observations, telemetry, mission_documents, inference_runs }, missionId);
  } catch (error) {
    if (isRagError(error)) throw error;
    throw new RagError('DATABASE_UNAVAILABLE', 503, 'Mission data is temporarily unavailable.');
  }
}

module.exports = {
  canonical,
  canonicalJson,
  createSnapshot,
  loadMissionSnapshot,
  projectEvidence,
  makeSummary
};
