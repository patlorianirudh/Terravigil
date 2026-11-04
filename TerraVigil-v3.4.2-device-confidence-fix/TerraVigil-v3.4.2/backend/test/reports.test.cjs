'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const express = require('express');
const { memoryDb } = require('./helpers/memory-db.cjs');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');

// Read the unencrypted page streams of our exported PDF, preserving the declared
// stream byte length. This checks output content, not a PDFKit callback or mock.
function pdfPageTexts(bytes) {
  const objects = new Map([...bytes.toString('latin1').matchAll(/(\d+) 0 obj\s*([\s\S]*?)\s*endobj/g)].map(match => [match[1], match[2]]));
  const readStream = id => {
    const object = objects.get(id);
    const length = Number(/\/Length (\d+)/.exec(object)[1]);
    const start = object.indexOf('stream\n') + 7;
    const raw = Buffer.from(object.slice(start, start + length), 'latin1');
    return (/\/FlateDecode/.test(object) ? zlib.inflateSync(raw) : raw).toString();
  };
  return [...objects.values()].filter(object => /\/Type \/Page\b/.test(object)).map(page => {
    const resources = objects.get(/\/Resources (\d+) 0 R/.exec(page)[1]);
    const fonts = {};
    for (const [, name, ref] of resources.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const unicodeRef = /\/ToUnicode (\d+) 0 R/.exec(objects.get(ref));
      if (!unicodeRef) continue;
      const mapping = fonts[name] = new Map();
      for (const [, first, , values] of readStream(unicodeRef[1]).matchAll(/<([a-f0-9]+)>\s*<([a-f0-9]+)>\s*\[([^\]]+)\]/ig)) {
        [...values.matchAll(/<([a-f0-9\s]*)>/ig)].forEach((match, offset) => mapping.set(parseInt(first, 16) + offset,
          (match[1].replace(/\s/g, '').match(/.{4}/g) || []).map(code => String.fromCharCode(parseInt(code, 16))).join('')));
      }
    }
    let currentFont;
    return [...readStream(/\/Contents (\d+) 0 R/.exec(page)[1]).matchAll(/\/(F\d+) [\d.]+ Tf|<([a-f0-9]+)>/ig)].map(match => {
      if (match[1]) { currentFont = fonts[match[1]]; return ''; }
      return currentFont ? (match[2].match(/.{4}/g) || []).map(code => currentFont.get(parseInt(code, 16)) ?? '').join('') : Buffer.from(match[2], 'hex').toString();
    }).join('');
  });
}
const seed = () => ({
  missions: [{ _id: 'm1', mission_id: 'M1', location: 'Test field', sample: false, notes: '=HYPERLINK("bad","label")', config: { visualConfidenceThreshold: 0.7 } }, { mission_id: 'OTHER', location: 'Other site' }],
  detections: [
    { _id: 'd1', detection_id: 'D1', mission_id: 'M1', status: 'CONFIRMED', metal_detected: true, risk_level: 'HIGH', latitude: 17.445, longitude: 78.348, yolo_confidence: 0.91, image_path: 'frames/a,"quoted".jpg', formula_version: 'risk-v1', timestamp: '2026-09-01T09:01:00.000Z' },
    { _id: 'd2', detection_id: 'D2', mission_id: 'M1', status: 'CONFIRMED', metal_detected: true, risk_level: 'LOW', latitude: 17.446, longitude: 78.349, yolo_confidence: 0.78 },
    { _id: 'foreign', mission_id: 'OTHER', status: 'CONFIRMED', risk_level: 'HIGH', notes: 'FOREIGN SECRET' }
  ],
  observations: [
    { _id: 'o1', observation_id: 'O1', mission_id: 'M1', status: 'UNCONFIRMED', metal_detected: false, risk_level: 'HIGH', yolo_confidence: 0.8, latitude: 17.447, longitude: 78.347, notes: '+SUM(1,2)\nSecond line' },
    { _id: 'o2', observation_id: 'O2', mission_id: 'M1', classification: 'unresolved_metal', metal_detected: true, metal_signal: 0.6, notes: '\t@danger' }
  ],
  telemetry: [{ _id: 't1', mission_id: 'M1', timestamp: '2026-09-01T09:01:00.000Z', latitude: 17.445, longitude: 78.348, battery: 86, satellites: 13, vendor_extra: { retained: 'all fields' } }]
});

async function withServer(options, run) {
  const routerPath = path.join(__dirname, '../reports/routes.js');
  await assert.doesNotReject(fs.access(routerPath), 'The report router has not been implemented');
  const { createReportRouter } = require(routerPath);
  const dataDir = options.dataDir || await fs.mkdtemp(path.join(os.tmpdir(), 'terravigil-reports-'));
  const db = options.db || memoryDb(options.seed || seed());
  const app = express();
  app.use(express.json());
  app.use('/api', createReportRouter({ getDB: async () => db, dataDir, ragService: options.ragService }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body = { sessionId: 'M1' }) => {
    const response = await fetch(base + '/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ base, db, dataDir, post }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    if (!options.dataDir) await fs.rm(dataDir, { recursive: true, force: true });
  }
}

test('factual reports freeze mission-only confirmed risk totals without requiring AI', async () => {
  await withServer({}, async ({ post, base, db }) => {
    const { status, body } = await post();
    assert.equal(status, 201);
    assert.equal(body.status, 'ready');
    assert.equal(body.sessionId, 'M1');
    assert.equal(body.siteName, 'Test field');
    assert.equal(body.synthetic, false);
    assert.equal(body.generationMode, 'factual');
    assert.equal(body.narrative, null);
    assert.equal(body.narrativeError, null);
    assert.deepEqual(body.narrativeSources, []);
    assert.deepEqual(body.summary, { confirmedMinesCount: 2, highRiskCount: 1, mediumRiskCount: 0, lowRiskCount: 1, unconfirmedVisualCount: 1, unresolvedMetalCount: 1, visualSweptAreaM2: null, dualSweptAreaM2: null });
    assert.equal(body.formulaVersion, 'risk-v1');
    for (const key of ['sourceHash', 'contentHash', 'pdfHash', 'csvHash']) assert.match(body[key], /^[a-f0-9]{64}$/);
    assert.equal(body.downloadUrl, `/api/reports/${body.id}/download?format=pdf`);
    assert.equal(body.csvDownloadUrl, `/api/reports/${body.id}/download?format=csv`);
    assert.ok(body.sources.every(source => source.sessionId === 'M1'));
    assert.equal(body.sources.length, 6);
    assert.deepEqual(await (await fetch(base + '/api/reports?sessionId=M1')).json(), [body]);
    assert.deepEqual(await (await fetch(base + '/api/reports?sessionId=OTHER')).json(), []);
    assert.deepEqual(await (await fetch(base + '/api/reports/' + body.id)).json(), body);
    assert.equal(db.rows('reports').length, 1);
  });
});

test('PDF and CSV downloads contain full frozen evidence, safe CSV cells, and verifiable byte hashes', async () => {
  await withServer({}, async ({ post, base, dataDir }) => {
    const { body } = await post();
    const pdfResponse = await fetch(base + body.downloadUrl);
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get('content-type'), /^application\/pdf/);
    assert.match(pdfResponse.headers.get('content-disposition'), /^attachment; filename="TerraVigil-report-000001\.pdf"$/);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.includes(Buffer.from('%%EOF')));
    assert.equal(digest(pdf), body.pdfHash);
    const csvResponse = await fetch(base + body.csvDownloadUrl);
    const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
    const csv = csvBytes.toString('utf8');
    assert.match(csvResponse.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.match(csv, /record_type,record_id,field,value/);
    assert.match(csv, /'\=HYPERLINK\(""bad"",""label""\)/);
    assert.match(csv, /'\+SUM\(1,2\)\nSecond line/);
    assert.match(csv, /'\t@danger/);
    assert.match(csv, /frames\/a,""quoted""\.jpg/);
    assert.match(csv, /vendor_extra/);
    assert.match(csv, /retained/);
    assert.doesNotMatch(csv, /FOREIGN SECRET/);
    assert.equal(digest(csvBytes), body.csvHash);
    const folder = path.join(dataDir, 'reports', 'editions', String(body.reportNumber));
    const content = JSON.parse(await fs.readFile(path.join(folder, 'snapshot.json'), 'utf8'));
    assert.equal(content.snapshot.telemetry[0].vendor_extra.retained, 'all fields');
    assert.equal(content.snapshot.detections.length, 2);
    const canonical = value => value && typeof value === 'object' ? (Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))) : value;
    assert.equal(digest(JSON.stringify(canonical(content))), body.contentHash);
    assert.equal(digest(JSON.stringify(canonical(content.snapshot))), body.sourceHash);
    assert.equal(JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8')).status, 'ready');
  });
});

test('missing missions, invalid bodies, filenames, formats, and report traversal are rejected', async () => {
  await withServer({}, async ({ post, base, db }) => {
    assert.equal((await post({ sessionId: 'ABSENT' })).status, 404);
    for (const body of [{}, { sessionId: [] }, { sessionId: '../M1' }, { sessionId: 'M1', includeAi: 'yes' }, { sessionId: 'M1', filename: '../stolen.pdf' }]) {
      assert.equal((await post(body)).status, 400);
    }
    assert.equal(db.rows('reports').length, 0);
    const { body } = await post();
    assert.equal((await fetch(base + body.downloadUrl.replace('format=pdf', 'format=../../snapshot.json'))).status, 400);
    assert.ok([400, 404].includes((await fetch(base + '/api/reports/%2e%2e%2fsecret/download')).status));
    assert.equal((await fetch(base + '/api/reports/00000000-0000-4000-8000-000000000000')).status, 404);
  });
});

test('PDF footers remain on their content pages with accurate page totals and no blank footer pages', async () => {
  await withServer({}, async ({ post, base }) => {
    const { body } = await post();
    const bytes = Buffer.from(await (await fetch(base + body.downloadUrl)).arrayBuffer());
    const pages = pdfPageTexts(bytes);
    assert.ok(pages.length > 1);
    pages.forEach((page, index) => {
      assert.match(page, /MISSION SNAPSHOT  \/  NOT A CLEARANCE CERTIFICATE/);
      assert.ok(page.includes(`${index + 1} / ${pages.length}`), `Page ${index + 1} has incorrect numbering or spilled its footer onto a blank page`);
    });
  });
});

test('PDF embeds every display font to prevent reader-dependent substitution and distorted spacing', async () => {
  await withServer({}, async ({ post, base }) => {
    const { body } = await post();
    const pdf = Buffer.from(await (await fetch(base + body.downloadUrl)).arrayBuffer()).toString('latin1');
    assert.ok([...pdf.matchAll(/\/FontFile2 \d+ 0 R/g)].length >= 3, 'Regular, bold, and appendix fonts must be embedded');
    assert.doesNotMatch(pdf, /\/Subtype \/Type1\b/);
  });
});

test('later editions never rewrite frozen summaries, source hashes, or downloaded bytes', async () => {
  await withServer({}, async ({ post, base, db }) => {
    const first = (await post()).body;
    const firstPdf = Buffer.from(await (await fetch(base + first.downloadUrl)).arrayBuffer());
    await db.collection('detections').updateOne({ _id: 'd1' }, { $set: { risk_level: 'MEDIUM' } });
    const second = (await post()).body;
    assert.ok(second.reportNumber > first.reportNumber);
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.sourceHash, first.sourceHash);
    assert.equal(second.summary.highRiskCount, 0);
    assert.equal(second.summary.mediumRiskCount, 1);
    assert.deepEqual(await (await fetch(base + '/api/reports/' + first.id)).json(), first);
    assert.deepEqual(Buffer.from(await (await fetch(base + first.downloadUrl)).arrayBuffer()), firstPdf);
  });
});

test('concurrent creation and a new router instance retain unique monotonic report editions', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terravigil-restart-'));
  const db = memoryDb(seed());
  try {
    await withServer({ dataDir, db }, async ({ post }) => {
      const responses = await Promise.all(Array.from({ length: 6 }, () => post()));
      assert.ok(responses.every(response => response.status === 201));
      assert.deepEqual(responses.map(response => response.body.reportNumber).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    });
    await withServer({ dataDir, db }, async ({ post, base }) => {
      const { body } = await post();
      assert.equal(body.reportNumber, 7);
      assert.equal((await (await fetch(base + '/api/reports')).json()).length, 7);
    });
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('explicit AI mode prepares real RAG before asking and preserves mission-scoped citations', async () => {
  let prepared = false;
  const ragService = {
    prepare: async missionId => { assert.equal(missionId, 'M1'); prepared = true; return { status: 'ready' }; },
    ask: async (question, missionId) => {
      assert.equal(prepared, true);
      assert.equal(missionId, 'M1');
      assert.match(question, /confirmed|unconfirmed/i);
      return { mission_id: 'M1', answer: 'Two records are stored as confirmed; this is not clearance evidence.', sources: [{ mission_id: 'M1', source_type: 'detection', source_id: 'D1', record_id: 'd1', document: 'detection record', section: 'Detection', text: 'risk_level = HIGH', score: 0.9 }] };
    }
  };
  await withServer({ ragService }, async ({ post }) => {
    const { status, body } = await post({ sessionId: 'M1', includeAi: true });
    assert.equal(status, 201);
    assert.equal(body.generationMode, 'rag');
    assert.match(body.narrative, /Two records/);
    assert.ok(body.narrativeSources.some(source => source.sourceRecordId === 'd1' && source.snippet === 'risk_level = HIGH'));
  });
});

test('narrative citation numbers identify the same source in API, PDF, and CSV without numbering the factual inventory as AI evidence', async () => {
  const ragService = { prepare: async () => ({}), ask: async () => ({
    mission_id: 'M1', answer: 'Observation O1 remains unconfirmed [1]. Detection D1 is stored confirmed [2].',
    sources: [
      { mission_id: 'M1', source_type: 'observation', source_id: 'O1', record_id: 'o1', document: 'O1 narrative source', section: 'Observation', text: 'status = UNCONFIRMED', score: 0.91 },
      { mission_id: 'M1', source_type: 'detection', source_id: 'D1', record_id: 'd1', document: 'D1 narrative source', section: 'Detection', text: 'status = CONFIRMED', score: 0.89 }
    ]
  }) };
  await withServer({ ragService }, async ({ post, base }) => {
    const { status, body } = await post({ sessionId: 'M1', includeAi: true });
    assert.equal(status, 201);
    assert.deepEqual(body.narrativeSources?.map(source => [source.citationNumber, source.sourceRecordId]), [[1, 'o1'], [2, 'd1']]);
    assert.equal(body.sources.length, 6, 'The factual inventory contains only frozen database source records');
    assert.ok(body.sources.every(source => source.citationNumber === undefined));
    assert.equal(body.sources[0].sourceRecordId, 'm1');
    const csv = await (await fetch(base + body.csvDownloadUrl)).text();
    assert.match(csv, /narrative_source,1,sourceRecordId,o1\r\n/);
    assert.match(csv, /narrative_source,1,citationNumber,1\r\n/);
    assert.match(csv, /narrative_source,2,sourceRecordId,d1\r\n/);
    assert.match(csv, /source,1,sourceRecordId,m1\r\n/);
    const pdf = pdfPageTexts(Buffer.from(await (await fetch(base + body.downloadUrl)).arrayBuffer())).join('\n');
    assert.match(pdf, /Observation O1 remains unconfirmed \[1\]/);
    assert.match(pdf, /\[1\] O1 narrative source \/ ObservationRecord: o1/);
    assert.match(pdf, /\[2\] D1 narrative source \/ DetectionRecord: d1/);
  });
});

test('requested AI failure is explicit and never produces a pretend AI or a silent factual report', async () => {
  const ragService = { prepare: async () => { const error = new Error('Gemini is not configured.'); error.code = 'GEMINI_NOT_CONFIGURED'; error.status = 503; throw error; }, ask: async () => { throw new Error('must not run'); } };
  await withServer({ ragService }, async ({ post, db }) => {
    const { status, body } = await post({ sessionId: 'M1', includeAi: true });
    assert.equal(status, 503);
    assert.equal(body.code, 'GEMINI_NOT_CONFIGURED');
    assert.match(body.narrativeError, /Gemini/);
    assert.equal(db.rows('reports').length, 0);
    assert.equal((await post()).status, 201);
  });
});

test('AI citations from another mission are refused rather than attached to a report', async () => {
  const ragService = { prepare: async () => ({}), ask: async () => ({ mission_id: 'M1', answer: 'Unrelated facts', sources: [{ mission_id: 'OTHER', source_type: 'detection', record_id: 'foreign', text: 'FOREIGN SECRET' }] }) };
  await withServer({ ragService }, async ({ post, db }) => {
    const { status, body } = await post({ sessionId: 'M1', includeAi: true });
    assert.equal(status, 409);
    assert.equal(body.code, 'REPORT_SOURCE_MISMATCH');
    assert.equal(db.rows('reports').length, 0);
  });
});

test('image-only inference reports retain real predictions and image references without fabricating mine counts or GPS', async () => {
  const inferenceSeed = {
    missions: [{ _id: 'image-mission', mission_id: 'IMAGE', location: 'Uploaded image analysis', synthetic: false }],
    inference_runs: [
      { _id: 'run-one', run_id: 'run-one', mission_id: 'IMAGE', timestamp: '2026-09-23T10:00:00.000Z',
        predictions: [{ classId: 12, className: 'land_mines', confidence: 0.87, bbox: [10, 20, 120, 130], normalizedCenter: { x: 0.325, y: 0.375 } }, { classId: 3, className: 'debris', confidence: 0.62, bbox: [50, 60, 70, 80], normalizedCenter: { x: 0.3, y: 0.35 } }],
        image_file: 'run-one-input.png', annotated_file: 'run-one-output.png', original_filename: 'test-scene.png',
        model: { sha256: 'a'.repeat(64), name: 'best.pt' }, image_location: null, location_source: 'not_provided', target_location_known: false },
      { _id: 'foreign-run', run_id: 'foreign-run', mission_id: 'OTHER', predictions: [], original_filename: 'OTHER SECRET IMAGE' }
    ]
  };
  await withServer({ seed: inferenceSeed }, async ({ post, base, dataDir }) => {
    const { status, body } = await post({ sessionId: 'IMAGE' });
    assert.equal(status, 201);
    assert.equal(body.synthetic, false);
    assert.deepEqual(body.summary, { confirmedMinesCount: 0, highRiskCount: 0, mediumRiskCount: 0, lowRiskCount: 0, unconfirmedVisualCount: 0, unresolvedMetalCount: 0, visualSweptAreaM2: null, dualSweptAreaM2: null });
    assert.equal(body.recordCounts.imageInferenceRuns, 1);
    assert.equal(body.recordCounts.imagePredictions, 2);
    assert.equal(body.recordCounts.unlocalizedImagePredictions, 2);
    assert.ok(body.sources.some(source => source.sourceType === 'inference_run' && source.sourceRecordId === 'run-one'));
    const csv = await (await fetch(base + body.csvDownloadUrl)).text();
    assert.match(csv, /land_mines/);
    assert.match(csv, /0\.87/);
    assert.match(csv, /run-one-output\.png/);
    assert.match(csv, /target_location_known,false/);
    assert.doesNotMatch(csv, /OTHER SECRET IMAGE/);
    const pages = pdfPageTexts(Buffer.from(await (await fetch(base + body.downloadUrl)).arrayBuffer())).join('\n');
    assert.match(pages, /Image inference results/);
    assert.match(pages, /land_mines/);
    assert.match(pages, /Target locations are unknown/);
    assert.match(pages, /\/api\/inference\/files\/run-one-output\.png/);
    const content = JSON.parse(await fs.readFile(path.join(dataDir, 'reports', 'editions', String(body.reportNumber), 'snapshot.json'), 'utf8'));
    assert.equal(content.snapshot.inference_runs.length, 1);
    assert.deepEqual(content.snapshot.inference_runs[0].predictions[0].bbox, [10, 20, 120, 130]);
  });
});

test('a source mutation during AI generation never attaches the narrative to a different snapshot', async () => {
  const db = memoryDb(seed());
  const ragService = { prepare: async () => ({}), ask: async () => {
    await db.collection('telemetry').updateOne({ _id: 't1' }, { $set: { battery: 20 } });
    return { mission_id: 'M1', answer: 'Summary based on earlier sources', sources: [{ mission_id: 'M1', source_type: 'summary', text: 'confirmed=2' }] };
  } };
  await withServer({ db, ragService }, async ({ post }) => {
    const { status, body } = await post({ sessionId: 'M1', includeAi: true });
    assert.equal(status, 409);
    assert.equal(body.code, 'REPORT_SNAPSHOT_CHANGED');
    assert.equal(db.rows('reports').length, 0);
  });
});

test('unwritable storage never publishes a ready report and modified downloads fail integrity checks', async () => {
  await withServer({}, async ({ post, base, dataDir, db }) => {
    await fs.writeFile(path.join(dataDir, 'reports'), 'blocks directory');
    const failed = await post();
    assert.equal(failed.status, 503);
    assert.equal(db.rows('reports').length, 0);
    await fs.unlink(path.join(dataDir, 'reports'));
    const { body } = await post();
    const folder = path.join(dataDir, 'reports', 'editions', String(body.reportNumber));
    await fs.writeFile(path.join(folder, 'report.pdf'), 'tampered');
    const response = await fetch(base + body.downloadUrl);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'REPORT_INTEGRITY_FAILED');
  });
});


test('production reports reject explicitly simulated sources and hide old sample editions', async () => {
  await withServer({}, async ({ post, base, db }) => {
    await db.collection('observations').insertOne({ _id: 'simulation', mission_id: 'M1', synthetic: true, status: 'UNCONFIRMED' });
    const response = await post();
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'REPORT_PRACTICE_DATA');
    assert.equal(db.rows('reports').length, 0);
    const id = '00000000-0000-4000-8000-000000000000';
    await db.collection('reports').insertOne({ _id: id, id, sessionId: 'SAMPLE-TV001', status: 'ready', synthetic: true });
    assert.deepEqual(await (await fetch(base + '/api/reports')).json(), []);
    assert.equal((await fetch(base + '/api/reports/' + id)).status, 404);
  });
});
