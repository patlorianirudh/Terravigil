'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEPLOYMENT, isPractice } = require('../production-data');
const { createPdf } = require('./pdf');
const { createCsv } = require('./csv');
const { ReportError, canonicalJson, hash, hashBytes, validateSessionId, loadSnapshot, summarize,
  classification, riskBand, isSynthetic, recordId, factualSources, formulaVersion } = require('./snapshot');

const HASH_SEMANTICS = Object.freeze({
  sourceHash: 'SHA256 of UTF-8 canonical JSON for the complete frozen source snapshot: recursively sorted object keys, preserved array order, ISO dates, no whitespace.',
  contentHash: 'SHA256 of UTF-8 canonical JSON in snapshot.json: report identity, edition, source snapshot, summary, provenance, limitations and optional narrative. It excludes file bytes and the hash itself.',
  sourceRecordHash: 'Each source sha256 hashes that complete stored record as canonical JSON; no field is intentionally removed.',
  pdfHash: 'SHA256 of the exact downloadable PDF bytes.',
  csvHash: 'SHA256 of the exact downloadable UTF-8 CSV bytes, including BOM and CRLF row delimiters.'
});

const LIMITATIONS = [
  'This is a frozen record of mission data, not a clearance certificate, an authorization to enter, or proof that an area is safe.',
  'Confirmation and risk are preserved from stored classifications; report generation does not validate sensor authenticity, recompute risk, or create a confirmation. Contradictory or missing source fields remain visible in the appendix.',
  'High, medium and low summary counts include only stored confirmed records. Unconfirmed visual and unresolved metal observations are counted separately. Unknown classification and unknown confirmed risk are reported separately.',
  'Counts describe source records. Records sharing an object or location are not deduplicated into a number of physical mines. Missing measurements, coverage and risk formula versions remain unknown.',
  'Firebase entries include matched and unmatched inbox records. Only matched entries appear as mapped observations. These are aircraft GPS positions at image capture time, not surveyed target coordinates. Matching time gaps and clock corrections remain in the source records.',
  'Imagery entries are references only; linked files were not fetched or authenticated. Telemetry position alone does not establish target localization, detection coverage or clearance.',
  'Image inference runs retain actual model predictions. Image coordinates, when supplied, describe the image context and do not establish the ground position of each predicted object. Image-only predictions do not add confirmed or geolocated mine counts.'
];

function validateReportId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
    throw new ReportError('INVALID_REQUEST', 400, 'Invalid report identifier.');
  }
  return id;
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    // Windows does not expose directory fsync through the same API. File fsync
    // still runs for every artifact, and the metadata is inserted last.
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EISDIR', 'EACCES'].includes(error.code)) throw error;
  } finally { if (handle) await handle.close(); }
}

async function writeDurable(filename, bytes) {
  const handle = await fs.open(filename, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}

async function reserveEdition(base, db) {
  await fs.mkdir(base, { recursive: true });
  const [entries, priorReports] = await Promise.all([fs.readdir(base), db.collection('reports').find({}).toArray()]);
  let edition = Math.max(0, ...entries.filter(entry => /^[1-9]\d*$/.test(entry)).map(Number),
    ...priorReports.map(report => report.reportNumber).filter(Number.isSafeInteger)) + 1;
  for (;;) {
    if (!Number.isSafeInteger(edition)) throw new Error('Report edition range exhausted');
    const folder = path.join(base, String(edition));
    try {
      // mkdir is atomic across concurrent requests/processes. Reserved editions
      // survive failed generation and are never reused or overwritten.
      await fs.mkdir(folder);
      await syncDirectory(base);
      return { edition, folder };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      edition += 1;
    }
  }
}

function mapRagSource(source, snapshot) {
  const sessionId = source?.mission_id ?? source?.sessionId;
  if (sessionId !== snapshot.sessionId) throw new ReportError('REPORT_SOURCE_MISMATCH', 409, 'The AI narrative returned a source from outside this mission. No report was created.');
  const sourceType = source.source_type ?? source.sourceType ?? 'unknown';
  const sourceRecordId = source.record_id ?? source.sourceRecordId ?? null;
  const collection = { mission: 'missions', detection: 'detections', observation: 'observations', telemetry: 'telemetry', inference_run: 'inference_runs' }[sourceType];
  const record = collection ? snapshot[collection].find((row, index) => recordId(row, sourceType, index) === String(sourceRecordId)) : null;
  if (collection && !record) throw new ReportError('REPORT_SOURCE_MISMATCH', 409, 'An AI citation is absent from the frozen mission sources. No report was created.');
  return {
    sessionId,
    sourceId: source.source_id ?? source.sourceId ?? null,
    sourceType,
    sourceRecordId,
    document: typeof source.document === 'string' ? source.document : `${sourceType} record`,
    section: typeof source.section === 'string' ? source.section : 'RAG narrative citation',
    snippet: typeof source.text === 'string' ? source.text : typeof source.snippet === 'string' ? source.snippet : canonicalJson(source.facts || {}),
    similarity: Number.isFinite(source.score ?? source.similarity) ? (source.score ?? source.similarity) : null,
    ...(record ? { sha256: hash(record) } : {})
  };
}

function publicItem(document) {
  const { _id, ...item } = document;
  return item;
}

function createReportService({ getDB, ragService, dataDir } = {}) {
  if (typeof getDB !== 'function') throw new TypeError('getDB is required');
  if (typeof dataDir !== 'string' || !dataDir) throw new TypeError('dataDir is required');
  const editionsDir = path.resolve(dataDir, 'reports', 'editions');

  async function database() {
    try { return await getDB(); }
    catch { throw new ReportError('REPORT_STORAGE_UNAVAILABLE', 503, 'Report database is unavailable.'); }
  }

  async function create(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['sessionId', 'includeAi'].includes(key))) {
      throw new ReportError('INVALID_REQUEST', 400, 'Expected {sessionId, includeAi?: boolean}. Filenames and source records cannot be supplied.');
    }
    const sessionId = validateSessionId(body.sessionId);
    if (body.includeAi !== undefined && typeof body.includeAi !== 'boolean') throw new ReportError('INVALID_REQUEST', 400, 'includeAi must be a boolean.');
    const db = await database();
    const snapshot = await loadSnapshot(db, sessionId);
    const sourceHash = hash(snapshot);
    const summary = summarize(snapshot);
    let narrative = null;
    let narrativeSources = [];
    if (body.includeAi) {
      try {
        if (typeof ragService?.prepare !== 'function' || typeof ragService?.ask !== 'function') {
          throw new ReportError('REPORT_AI_UNAVAILABLE', 503, 'The AI narrative service is not configured.');
        }
        await ragService.prepare(sessionId);
        const question = 'Summarize this mission\'s stored evidence for an audit report. Distinguish CONFIRMED records, UNCONFIRMED visual observations, and unresolved metal. Describe recorded GPS, model confidence, risk and missing evidence with source IDs. Do not interpret a risk label as confirmation, infer mission totals from a retrieved subset, or claim clearance. State sample/synthetic provenance when present.';
        const result = await ragService.ask(question, sessionId);
        if (result?.mission_id !== sessionId || !Array.isArray(result.sources)) {
          throw new ReportError('REPORT_SOURCE_MISMATCH', 409, 'The AI narrative result does not identify this mission.');
        }
        if (typeof result.answer !== 'string' || !result.answer.trim() || !result.sources.length) {
          throw new ReportError('REPORT_AI_FAILED', 502, 'The AI service did not return a narrative with source citations.');
        }
        narrativeSources = result.sources.map((source, index) => ({
          ...mapRagSource(source, snapshot), citationNumber: index + 1
        }));
        // RAG performs its own generation checks; this extra full-record check
        // also catches source fields that RAG intentionally does not index.
        if (hash(await loadSnapshot(db, sessionId)) !== sourceHash) {
          throw new ReportError('REPORT_SNAPSHOT_CHANGED', 409, 'Mission records changed during AI generation. Please generate a new report.');
        }
        narrative = result.answer.trim();
      } catch (error) {
        const known = error instanceof ReportError || (typeof error?.code === 'string' && Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599);
        const message = known ? error.message : 'The AI narrative could not be generated. Check the configured RAG service and try again, or explicitly choose a factual report.';
        throw new ReportError(known ? error.code : 'REPORT_AI_FAILED', known ? error.status : 502, message, message);
      }
    }

    const { edition, folder } = await reserveEdition(editionsDir, db);
    const allRecords = [...snapshot.missions, ...snapshot.detections, ...snapshot.observations, ...snapshot.telemetry, ...snapshot.inference_runs];
    const evidence = [...snapshot.detections, ...snapshot.observations];
    const synthetic = allRecords.some(isSynthetic);
    const testMode = snapshot.missions.some(row => row.test_mode === true) || snapshot.firebase_events.some(row => row.test_record === true);
    const content = {
      schema: 'terravigil-report-v1',
      id: crypto.randomUUID(), reportNumber: edition, sessionId,
      siteName: String(snapshot.missions[0].location ?? snapshot.missions[0].siteName ?? snapshot.missions[0].site_name ?? sessionId),
      generatedAt: new Date().toISOString(), formulaVersion: formulaVersion(snapshot),
      generationMode: body.includeAi ? 'rag' : 'factual', narrative, narrativeError: null,
      synthetic, testMode, sourceHash, summary, snapshot, hardware: DEPLOYMENT,
      recordCounts: {
        unknownClassification: evidence.filter(row => classification(row) === 'unknown').length,
        confirmedRiskUnknown: evidence.filter(row => classification(row) === 'confirmed' && riskBand(row) === null).length,
        firebaseEvents: snapshot.firebase_events.length,
        firebaseMatched: snapshot.firebase_events.filter(row => row.status === 'matched').length,
        firebasePending: snapshot.firebase_events.filter(row => ['waiting_for_telemetry', 'outside_tolerance'].includes(row.status)).length,
        firebaseInvalid: snapshot.firebase_events.filter(row => String(row.status).startsWith('invalid')).length,
        firebaseRemoved: snapshot.firebase_events.filter(row => row.status === 'removed').length,
        firebaseUnmatched: snapshot.firebase_events.filter(row => !['matched', 'removed'].includes(row.status)).length,
        imageInferenceRuns: snapshot.inference_runs.length,
        imagePredictions: snapshot.inference_runs.reduce((sum, row) => sum + (Array.isArray(row.predictions) ? row.predictions.length : 0), 0),
        unlocalizedImagePredictions: snapshot.inference_runs.reduce((sum, row) => sum + (row.target_location_known !== true && Array.isArray(row.predictions) ? row.predictions.length : 0), 0)
      },
      limitations: [...LIMITATIONS, ...(testMode ? ['FIREBASE IMAGE TEST: image fixtures and detection labels are synthetic; timestamps come from a recorded CSV. This checks software transport and matching, not model accuracy or a new survey.'] : []), ...(synthetic ? ['This report includes explicitly synthetic practice records. Their positions, sensor readings or telemetry must not be used as evidence of a real survey.'] : [])],
      hashSemantics: HASH_SEMANTICS,
      narrativeSources,
      sources: factualSources(snapshot)
    };
    const contentJson = canonicalJson(content);
    const contentHash = hashBytes(contentJson);
    const [pdf, csv] = await Promise.all([createPdf(content, contentHash), Promise.resolve(createCsv(content, contentHash))]);
    const item = {
      id: content.id, reportNumber: edition, sessionId, siteName: content.siteName, generatedAt: content.generatedAt,
      status: 'ready', formulaVersion: content.formulaVersion, sourceHash, contentHash,
      pdfHash: hashBytes(pdf), csvHash: hashBytes(csv),
      downloadUrl: `/api/reports/${content.id}/download?format=pdf`,
      csvDownloadUrl: `/api/reports/${content.id}/download?format=csv`,
      summary, generationMode: content.generationMode, narrative, narrativeError: null,
      hardware: content.hardware, sources: content.sources, narrativeSources, synthetic, testMode, recordCounts: content.recordCounts, hashSemantics: HASH_SEMANTICS,
      limitations: content.limitations
    };
    await Promise.all([
      writeDurable(path.join(folder, 'snapshot.json'), contentJson),
      writeDurable(path.join(folder, 'report.pdf'), pdf),
      writeDurable(path.join(folder, 'report.csv'), csv)
    ]);
    await writeDurable(path.join(folder, 'manifest.json'), canonicalJson(item));
    await syncDirectory(folder);
    // The API cannot list or download the report until all artifacts above and
    // their manifest are flushed, and the persistent collection write succeeds.
    await db.collection('reports').insertOne({ _id: item.id, ...item });
    return item;
  }

  async function list(sessionId) {
    const query = sessionId === undefined ? {} : { sessionId: validateSessionId(sessionId) };
    const db = await database();
    const reports = await db.collection('reports').find(query).toArray();
    return reports.filter(report => report.status === 'ready' && !isPractice(report))
      .sort((a, b) => b.reportNumber - a.reportNumber).map(publicItem);
  }

  async function get(id) {
    validateReportId(id);
    const db = await database();
    const report = await db.collection('reports').findOne({ _id: id });
    if (!report || isPractice(report) || report.id !== id || report.status !== 'ready') throw new ReportError('REPORT_NOT_FOUND', 404, 'Report not found.');
    return publicItem(report);
  }

  async function download(id, format = 'pdf') {
    if (format !== 'pdf' && format !== 'csv') throw new ReportError('INVALID_REQUEST', 400, 'format must be pdf or csv.');
    const report = await get(id);
    if (!Number.isSafeInteger(report.reportNumber) || report.reportNumber < 1) throw new ReportError('REPORT_INTEGRITY_FAILED', 409, 'Report storage metadata is invalid.');
    // All path components and attachment names are server-owned. No stored or
    // client-supplied filename participates in filesystem lookup.
    const folder = path.join(editionsDir, String(report.reportNumber));
    let bytes;
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'));
      if (manifest.id !== id || manifest.sessionId !== report.sessionId || manifest.contentHash !== report.contentHash || manifest[`${format}Hash`] !== report[`${format}Hash`]) {
        throw new Error('Manifest mismatch');
      }
      bytes = await fs.readFile(path.join(folder, `report.${format}`));
      if (hashBytes(bytes) !== report[`${format}Hash`]) throw new Error('File hash mismatch');
    } catch {
      throw new ReportError('REPORT_INTEGRITY_FAILED', 409, 'The saved report is unavailable or failed its SHA256 integrity check. Create a new edition.');
    }
    return { bytes, filename: `TerraVigil-report-${String(report.reportNumber).padStart(6, '0')}.${format}`, hash: report[`${format}Hash`],
      contentType: format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8' };
  }

  return { create, list, get, download };
}

module.exports = { createReportService };
