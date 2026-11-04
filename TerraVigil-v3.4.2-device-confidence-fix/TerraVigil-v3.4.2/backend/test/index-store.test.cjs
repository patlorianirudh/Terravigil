'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { storeEmbeddings, readCurrentIndex } = require('../rag/embed-store');
const { rankChunks, retrieve } = require('../rag/retrieve');
const { createSnapshot } = require('../rag/documents');
const { RagError } = require('../rag/errors');
const { memoryDb } = require('./helpers/memory-db.cjs');

const vector = index => Array.from({ length: 384 }, (_, n) => n === index ? 1 : 0);

function snapshotFor(missionId = 'M1', risk = 'HIGH') {
  return createSnapshot({
    missions: [{ _id: `mission-${missionId}`, mission_id: missionId, location: 'Field', status: 'COMPLETED' }],
    detections: [{ _id: `detection-${missionId}`, mission_id: missionId, detection_id: 'D1', status: 'CONFIRMED', risk_level: risk, yolo_confidence: 0.95 }],
    observations: [], telemetry: []
  }, missionId);
}

function options(snapshot, embed = async text => text.includes('summary') ? vector(1) : vector(0)) {
  return {
    config: { embeddingModel: 'test-model', chunkMaxTokens: 256 },
    embed,
    chunk: async documents => documents.map((document, index) => ({ ...document, chunk_index: index, content_hash: `hash-${index}` })),
    loadSnapshot: async () => snapshot
  };
}

test('ranks validated vectors and omits the vector from public evidence', () => {
  const rows = [
    { mission_id: 'M1', record_id: 'near', text: 'HIGH risk', embedding: vector(0) },
    { mission_id: 'M1', record_id: 'far', text: 'Other evidence', embedding: vector(1) },
    { mission_id: 'M1', record_id: 'bad', text: 'Invalid vector', embedding: [Number.NaN] }
  ];
  const result = rankChunks(vector(0), rows, { limit: 3, minScore: 0.3 });
  assert.deepEqual(result.map(row => row.record_id), ['near']);
  assert.equal(result[0].score, 1);
  assert.equal('embedding' in result[0], false);
});

test('publishes a complete generation and reuses an unchanged source hash', async () => {
  const db = memoryDb();
  const snapshot = snapshotFor();
  const first = await storeEmbeddings('M1', { db, ...options(snapshot) });
  const second = await storeEmbeddings('M1', { db, ...options(snapshot) });
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(first.generation, second.generation);
  assert.equal(db.rows('rag_embeddings').filter(row => row.kind === 'chunk').length, first.indexed_chunks);
});

test('failed staging leaves the active manifest and old chunks untouched', async () => {
  const db = memoryDb();
  const snapshot = snapshotFor();
  const first = await storeEmbeddings('M1', { db, ...options(snapshot) });
  const before = db.rows('rag_embeddings');
  await assert.rejects(() => storeEmbeddings('M1', {
    ...options(snapshotFor('M1', 'LOW')),
    db,
    embed: async () => { throw new Error('embedding failed'); }
  }), error => error.code === 'DATABASE_UNAVAILABLE');
  const after = db.rows('rag_embeddings');
  assert.equal(after.find(row => row.kind === 'index').generation, first.generation);
  assert.equal(after.filter(row => row.kind === 'chunk').length, before.filter(row => row.kind === 'chunk').length);
});

test('source changes during preparation never publish staged data', async () => {
  const db = memoryDb();
  const first = snapshotFor();
  const changed = snapshotFor('M1', 'LOW');
  let loads = 0;
  await assert.rejects(() => storeEmbeddings('M1', {
    db,
    config: { embeddingModel: 'test-model', chunkMaxTokens: 256 },
    embed: async () => vector(0),
    chunk: async documents => documents.map((document, index) => ({ ...document, chunk_index: index, content_hash: `hash-${index}` })),
    loadSnapshot: async () => (++loads === 1 ? first : changed)
  }), error => error.code === 'RAG_INDEX_CHANGED');
  assert.equal(db.rows('rag_embeddings').some(row => row.kind === 'index'), false);
  assert.equal(db.rows('rag_embeddings').some(row => row.kind === 'chunk'), false);
});

test('retrieval is mission isolated and rejects a stale source', async () => {
  const db = memoryDb();
  const snapshot = snapshotFor();
  await storeEmbeddings('M1', { db, ...options(snapshot) });
  await assert.rejects(() => retrieve('risk', 'M2', {
    db, config: { embeddingModel: 'test-model', topK: 3, minScore: 0.3, maxQuestionTokens: 256 },
    embed: async () => vector(0), loadSnapshot: async () => { throw new RagError('MISSION_NOT_FOUND', 404, 'Mission not found.'); }
  }), error => error.code === 'MISSION_NOT_FOUND');
  const changed = snapshotFor('M1', 'LOW');
  await assert.rejects(() => retrieve('risk', 'M1', {
    db, config: { embeddingModel: 'test-model', topK: 3, minScore: 0.3, maxQuestionTokens: 256 },
    embed: async () => vector(0), loadSnapshot: async () => changed
  }), error => error.code === 'RAG_INDEX_STALE');
});
