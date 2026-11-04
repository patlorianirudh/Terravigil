'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshot } = require('../rag/documents');
const { storeEmbeddings, readCurrentIndex } = require('../rag/embed-store');
const { memoryDb } = require('./helpers/memory-db.cjs');

function options(db) {
  const snapshot = createSnapshot({
    missions: [{ _id: 'm1', mission_id: 'M1', status: 'COMPLETED' }],
    observations: [{ _id: 'o1', mission_id: 'M1', observation_id: 'O1', status: 'UNCONFIRMED', risk_level: 'HIGH', metal_detected: false }]
  }, 'M1');
  return {
    db,
    config: { embeddingModel: 'test-model', chunkMaxTokens: 256 },
    loadSnapshot: async () => snapshot,
    embed: {
      tokenCount: text => Array.from(text).length,
      createEmbedding: async () => Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0)
    }
  };
}

test('legacy chunk schemas are stale and rebuilt even when mission facts and vectors are unchanged', async t => {
  for (const version of [undefined, 1, 'rag-chunk-v1']) await t.test(String(version), async () => {
    const db = memoryDb();
    const config = options(db);
    const first = await storeEmbeddings('M1', config);
    const collection = db.collection('rag_embeddings');
    await collection.updateOne({ kind: 'index', mission_id: 'M1' }, version === undefined
      ? { $unset: { chunk_schema_version: '' } }
      : { $set: { chunk_schema_version: version } });
    await assert.rejects(() => readCurrentIndex('M1', config), error => error.code === 'RAG_INDEX_STALE' && error.status === 409);
    const rebuilt = await storeEmbeddings('M1', config);
    assert.equal(rebuilt.reused, false);
    assert.notEqual(rebuilt.generation, first.generation);
    assert.equal(rebuilt.source_hash, first.source_hash);
    const index = await readCurrentIndex('M1', config);
    assert.notEqual(index.manifest.chunk_schema_version, undefined);
    assert.notEqual(index.manifest.chunk_schema_version, version);
    assert.ok(index.chunks.every(chunk => chunk.chunk_schema_version === index.manifest.chunk_schema_version));
    const repeated = await storeEmbeddings('M1', config);
    assert.equal(repeated.reused, true);
    assert.equal(repeated.generation, rebuilt.generation);
  });
});

test('a generation containing a different chunk schema cannot be read or reused', async () => {
  const db = memoryDb();
  const config = options(db);
  const first = await storeEmbeddings('M1', config);
  const firstChunk = db.rows('rag_embeddings').find(row => row.kind === 'chunk');
  await db.collection('rag_embeddings').updateOne({ _id: firstChunk._id }, { $unset: { chunk_schema_version: '' } });
  await assert.rejects(() => readCurrentIndex('M1', config), error => error.code === 'RAG_INDEX_INVALID');
  const rebuilt = await storeEmbeddings('M1', config);
  assert.equal(rebuilt.reused, false);
  assert.notEqual(rebuilt.generation, first.generation);
  await readCurrentIndex('M1', config);
});

test('legacy embedding runtimes require a rebuild even when the source and model name match', async t => {
  for (const profile of [undefined, 'xenova-2.17.2:cpu:q8:mean:l2']) await t.test(String(profile), async () => {
    const db = memoryDb();
    const config = options(db);
    const first = await storeEmbeddings('M1', config);
    await db.collection('rag_embeddings').updateOne({ kind: 'index', mission_id: 'M1' }, profile === undefined
      ? { $unset: { embedding_profile: '' } }
      : { $set: { embedding_profile: profile } });
    await assert.rejects(() => readCurrentIndex('M1', config), error => error.code === 'RAG_INDEX_STALE');
    const rebuilt = await storeEmbeddings('M1', config);
    assert.equal(rebuilt.reused, false);
    assert.notEqual(rebuilt.generation, first.generation);
    assert.equal(rebuilt.source_hash, first.source_hash);
    const index = await readCurrentIndex('M1', config);
    assert.equal(typeof index.manifest.embedding_profile, 'string');
    assert.notEqual(index.manifest.embedding_profile, profile);
    assert.ok(index.chunks.every(chunk => chunk.embedding_profile === index.manifest.embedding_profile));
    const repeated = await storeEmbeddings('M1', config);
    assert.equal(repeated.reused, true);
    assert.equal(repeated.generation, rebuilt.generation);
  });
});

test('an active generation cannot mix vectors from different embedding runtimes', async () => {
  const db = memoryDb();
  const config = options(db);
  const first = await storeEmbeddings('M1', config);
  const firstChunk = db.rows('rag_embeddings').find(row => row.kind === 'chunk');
  await db.collection('rag_embeddings').updateOne({ _id: firstChunk._id }, { $unset: { embedding_profile: '' } });
  await assert.rejects(() => readCurrentIndex('M1', config), error => error.code === 'RAG_INDEX_INVALID');
  const rebuilt = await storeEmbeddings('M1', config);
  assert.equal(rebuilt.reused, false);
  assert.notEqual(rebuilt.generation, first.generation);
  await readCurrentIndex('M1', config);
});
