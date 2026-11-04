'use strict';

const crypto = require('node:crypto');
const { RagError, isRagError } = require('./errors');
const { readRagConfig, EMBEDDING_PROFILE } = require('./config');
const { loadMissionSnapshot } = require('./documents');
const { CHUNK_SCHEMA_VERSION, chunkDocuments } = require('./chunk');
const { createEmbedding, isValidVector } = require('./embed');

const locks = new Map();
const indexIds = missionId => `index:${JSON.stringify(missionId)}`;
const chunkId = (missionId, generation, chunk) =>
  `chunk:${JSON.stringify(missionId)}:${generation}:${chunk.source_type}:${JSON.stringify(chunk.record_id)}:${chunk.chunk_index}`;

function assertNotAborted(signal) {
  if (signal && signal.aborted) throw new RagError('RAG_TIMEOUT', 504, 'RAG preparation timed out.');
}

async function ensureIndexes(db) {
  const collection = db.collection('rag_embeddings');
  if (typeof collection.createIndex !== 'function') return;
  await collection.createIndex({ kind: 1, mission_id: 1, generation: 1 }, { name: 'rag_kind_mission_generation' });
  await collection.createIndex(
    { mission_id: 1, generation: 1, source_type: 1, record_id: 1, chunk_index: 1 },
    {
      name: 'rag_chunk_identity',
      unique: true,
      partialFilterExpression: { kind: 'chunk' }
    }
  );
}

async function findManifest(db, missionId) {
  try {
    return await db.collection('rag_embeddings').findOne({
      _id: indexIds(missionId), kind: 'index', mission_id: missionId
    });
  } catch (error) {
    if (isRagError(error)) throw error;
    throw new RagError('DATABASE_UNAVAILABLE', 503, 'RAG index storage is temporarily unavailable.');
  }
}

async function removeStaged(db, missionId, generation) {
  try {
    await db.collection('rag_embeddings').deleteMany({ kind: 'chunk', mission_id: missionId, generation });
  } catch (_) {
    // A failed cleanup must never remove another mission's data or mask the original error.
  }
}

async function prepareLocked(missionId, options) {
  const config = options.config || readRagConfig();
  const db = options.db;
  const embedClient = options.embed || { createEmbedding, tokenCount: require('./embed').tokenCount };
  const embed = typeof embedClient === 'function' ? embedClient : embedClient.createEmbedding.bind(embedClient);
  const tokenCount = typeof embedClient === 'object' && embedClient.tokenCount
    ? embedClient.tokenCount.bind(embedClient)
    : require('./embed').tokenCount;
  const makeChunks = options.chunk || chunkDocuments;
  const loadSnapshot = options.loadSnapshot || loadMissionSnapshot;
  const signal = options.signal;
  let generation;
  assertNotAborted(signal);
  try {
    await ensureIndexes(db);
    const snapshot = await loadSnapshot(db, missionId);
    assertNotAborted(signal);
    const current = await findManifest(db, missionId);
    if (current && current.source_hash === snapshot.source_hash &&
        current.chunk_schema_version === CHUNK_SCHEMA_VERSION && current.embedding_profile === EMBEDDING_PROFILE) {
      const currentChunks = await db.collection('rag_embeddings').find({
        kind: 'chunk', mission_id: missionId, generation: current.generation
      }).toArray();
      if (current.chunk_count === currentChunks.length && currentChunks.every(row =>
        row.chunk_schema_version === CHUNK_SCHEMA_VERSION && row.embedding_profile === EMBEDDING_PROFILE &&
        isValidVector(row.embedding))) {
        return {
          mission_id: missionId,
          status: 'ready',
          indexed_chunks: current.chunk_count,
          source_hash: current.source_hash,
          generation: current.generation,
          model: current.model,
          reused: true
        };
      }
    }

    generation = crypto.randomUUID();
    const chunks = await makeChunks(snapshot.documents, {
      tokenCount,
      maxTokens: config.chunkMaxTokens
    });
    assertNotAborted(signal);
    const stored = [];
    for (const chunk of chunks) {
      assertNotAborted(signal);
      const embedding = await embed(chunk.text);
      if (!isValidVector(embedding)) {
        throw new RagError('EMBEDDING_UNAVAILABLE', 503, 'The local embedding model returned an invalid vector.');
      }
      stored.push({
        _id: chunkId(missionId, generation, chunk),
        kind: 'chunk',
        mission_id: missionId,
        generation,
        model: config.embeddingModel,
        embedding_profile: EMBEDDING_PROFILE,
        chunk_schema_version: CHUNK_SCHEMA_VERSION,
        source_type: chunk.source_type,
        source_id: chunk.source_id ?? null,
        record_id: chunk.record_id ?? null,
        section: chunk.section,
        document: chunk.document,
        facts: chunk.facts,
        validation_issues: chunk.validation_issues || [],
        text: chunk.text,
        chunk_index: chunk.chunk_index,
        content_hash: chunk.content_hash,
        embedding,
        created_at: new Date()
      });
    }
    assertNotAborted(signal);
    if (stored.length) await db.collection('rag_embeddings').insertMany(stored, { ordered: true });

    const after = await loadSnapshot(db, missionId);
    if (after.source_hash !== snapshot.source_hash) {
      throw new RagError('RAG_INDEX_CHANGED', 409, 'Mission data changed while it was being prepared. Prepare again.');
    }
    assertNotAborted(signal);

    const manifest = {
      _id: indexIds(missionId),
      kind: 'index',
      mission_id: missionId,
      generation,
      source_hash: snapshot.source_hash,
      model: config.embeddingModel,
      embedding_profile: EMBEDDING_PROFILE,
      chunk_schema_version: CHUNK_SCHEMA_VERSION,
      chunk_count: stored.length,
      created_at: new Date(),
      updated_at: new Date()
    };
    if (current) {
      const { _id: _manifestId, ...manifestFields } = manifest;
      const result = await db.collection('rag_embeddings').updateOne(
        { _id: current._id, kind: 'index', mission_id: missionId, generation: current.generation },
        { $set: manifestFields }
      );
      if (!result || result.matchedCount !== 1) {
        throw new RagError('RAG_INDEX_CHANGED', 409, 'Another preparation changed this mission index. Retry.');
      }
    } else {
      try {
        await db.collection('rag_embeddings').insertOne(manifest);
      } catch (error) {
        if (error && error.code === 11000) {
          throw new RagError('RAG_INDEX_CHANGED', 409, 'Another preparation changed this mission index. Retry.');
        }
        throw error;
      }
    }
    return {
      mission_id: missionId,
      status: 'ready',
      indexed_chunks: stored.length,
      source_hash: snapshot.source_hash,
      generation,
      model: config.embeddingModel,
      reused: false
    };
  } catch (error) {
    if (generation) await removeStaged(db, missionId, generation);
    if (isRagError(error)) throw error;
    throw new RagError('DATABASE_UNAVAILABLE', 503, 'RAG index storage is temporarily unavailable.');
  }
}

async function storeEmbeddings(missionId, options = {}) {
  const previous = locks.get(missionId) || Promise.resolve();
  const run = previous.catch(() => undefined).then(() => prepareLocked(missionId, options));
  locks.set(missionId, run);
  try {
    return await run;
  } finally {
    if (locks.get(missionId) === run) locks.delete(missionId);
  }
}

async function readCurrentIndex(missionId, options = {}) {
  const db = options.db;
  const loadSnapshot = options.loadSnapshot || loadMissionSnapshot;
  const snapshot = await loadSnapshot(db, missionId);
  const manifest = await findManifest(db, missionId);
  if (!manifest) throw new RagError('RAG_NOT_INDEXED', 409, 'Prepare this mission data before asking questions.');
  if (manifest.chunk_schema_version !== CHUNK_SCHEMA_VERSION) {
    throw new RagError('RAG_INDEX_STALE', 409, 'The mission index format changed. Prepare the mission again before asking.');
  }
  if (manifest.embedding_profile !== EMBEDDING_PROFILE) {
    throw new RagError('RAG_INDEX_STALE', 409, 'The embedding runtime changed. Prepare the mission again before asking.');
  }
  if (manifest.source_hash !== snapshot.source_hash) {
    throw new RagError('RAG_INDEX_STALE', 409, 'Mission data changed. Prepare the mission again before asking.');
  }
  let chunks;
  try {
    chunks = await db.collection('rag_embeddings').find({
      kind: 'chunk', mission_id: missionId, generation: manifest.generation
    }).toArray();
  } catch (error) {
    if (isRagError(error)) throw error;
    throw new RagError('DATABASE_UNAVAILABLE', 503, 'RAG index storage is temporarily unavailable.');
  }
  if (!Number.isInteger(manifest.chunk_count) || manifest.chunk_count !== chunks.length ||
      chunks.some(chunk => chunk.chunk_schema_version !== CHUNK_SCHEMA_VERSION ||
        chunk.embedding_profile !== EMBEDDING_PROFILE || !isValidVector(chunk.embedding))) {
    throw new RagError('RAG_INDEX_INVALID', 409, 'The active mission index is incomplete. Prepare it again.');
  }
  return { snapshot, manifest, chunks };
}

module.exports = { storeEmbeddings, readCurrentIndex, ensureIndexes, indexIds };
