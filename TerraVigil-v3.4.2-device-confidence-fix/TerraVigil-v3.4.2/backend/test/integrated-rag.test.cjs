'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/memory-db.cjs');
const { seedSample } = require('../seed-sample');
const { createRagService } = require('../rag/service');
const { readRagConfig } = require('../rag/config');
const { loadMissionSnapshot } = require('../rag/documents');

// Explicitly injected vectors and provider exercise orchestration without
// claiming to verify external embeddings or Gemini. Those have separate checks.
const embed = { tokenCount: async text => text.split(/\s+/).length, createEmbedding: async () => [1, ...Array(383).fill(0)] };

test('integrated RAG indexes the actual sample and returns cited evidence to the provider', async () => {
  const db = memoryDb(); await seedSample(db);
  const service = createRagService({ getDB: async () => db, autoPrepare: true, embed,
    config: { ...readRagConfig({}), minScore: 0 },
    generate: async (question, sources) => {
      assert.equal(question, 'How many observations?');
      assert.ok(sources.length > 0);
      assert.ok(sources.every(source => source.mission_id === 'SAMPLE-TV001'));
      const summary = sources.find(source => source.source_type === 'summary');
      assert.equal(summary.facts.total_records, 8);
      assert.equal(summary.facts.synthetic, true);
      return 'Eight records, based on retrieved evidence.';
    }
  });
  const response = await service.ask('How many observations?', 'SAMPLE-TV001');
  assert.match(response.answer, /Eight records/);
  assert.ok(response.sources.length > 0);
  const index = db.rows('rag_embeddings').find(row => row.kind === 'index');
  assert.ok(index.chunk_count > 0);
  assert.notEqual(index.model, 'simulation-summary-no-embeddings');
  await db.collection('observations').insertOne({ mission_id: 'SAMPLE-TV001', observation_id: 'additional', status: 'UNCONFIRMED' });
  const refreshed = await service.prepare('SAMPLE-TV001');
  assert.notEqual(refreshed.generation, index.generation);
});

test('project reference documents are indexed with provenance and confined to their mission', async () => {
  const db = memoryDb({ missions: [{ mission_id: 'A' }, { mission_id: 'B' }], mission_documents: [
    { _id: 'reference', mission_id: 'A', title: 'TerraVigil SRS', section: '4.3', text: 'Visual predictions require metal confirmation.' },
    { _id: 'private', mission_id: 'B', title: 'Other mission', text: 'Unrelated secret.' }
  ] });
  const snapshot = await loadMissionSnapshot(db, 'A');
  const reference = snapshot.documents.find(row => row.source_type === 'reference');
  assert.ok(reference);
  assert.equal(reference.document, 'TerraVigil SRS');
  assert.match(reference.text, /metal confirmation/);
  assert.ok(!JSON.stringify(snapshot).includes('Unrelated secret'));
});

test('missing Gemini configuration fails explicitly instead of returning a canned sample answer', async () => {
  const db = memoryDb(); await seedSample(db);
  const service = createRagService({ getDB: async () => db, autoPrepare: true, embed,
    config: { ...readRagConfig({}), minScore: 0 } });
  await assert.rejects(service.ask('hi', 'SAMPLE-TV001'), { code: 'GEMINI_NOT_CONFIGURED' });
});

test('retrieval honors an explicit record ID and does not fill top-k with repeated chunks', async () => {
  const db = memoryDb(); await seedSample(db);
  const service = createRagService({ getDB: async () => db, autoPrepare: true, embed,
    config: { ...readRagConfig({}), minScore: 0 } });
  const response = await service.search('What is the confidence of SAMPLE-TV001-D004?', 'SAMPLE-TV001');
  assert.equal(response.sources[0].source_id, 'SAMPLE-TV001-D004');
  const ids = response.sources.map(row => `${row.source_type}:${row.record_id}`);
  assert.equal(new Set(ids).size, ids.length);
});

test('image-only model predictions remain queryable without inventing mine records or GPS', async () => {
  const db = memoryDb({ missions: [{ mission_id: 'IMAGE' }], inference_runs: [{
    _id: 'image-run-1', run_id: 'image-run-1', mission_id: 'IMAGE', original_filename: 'image.jpg',
    predictions: [{ className: 'land_mines', confidence: 0.91, bbox: [1, 2, 30, 40] }],
    image_location: null, target_location_known: false, model: { name: 'best.pt', sha256: 'model-hash' }
  }] });
  const snapshot = await loadMissionSnapshot(db, 'IMAGE');
  const run = snapshot.documents.find(row => row.source_type === 'inference_run');
  assert.ok(run);
  assert.equal(run.facts.predictions[0].confidence, 0.91);
  assert.equal(run.facts.target_location_known, false);
  assert.equal(snapshot.summary.facts.total_records, 0);
  assert.equal(snapshot.summary.facts.image_predictions, 1);
  assert.equal(snapshot.summary.facts.confirmed, 0);
});
