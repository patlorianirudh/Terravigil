'use strict';

const { RagError, isRagError } = require('./errors');
const { readRagConfig } = require('./config');
const { loadMissionSnapshot } = require('./documents');
const { readCurrentIndex } = require('./embed-store');
const { createEmbedding, isValidVector } = require('./embed');

function cosineSimilarity(a, b) {
  if (!isValidVector(a) || !isValidVector(b)) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  const score = denominator ? dot / denominator : null;
  return Number.isFinite(score) ? score : null;
}

function publicSource(chunk, score) {
  const source = {
    mission_id: chunk.mission_id,
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
    score
  };
  return source;
}

function rankChunks(queryVector, chunks, { limit = 3, minScore = 0.30 } = {}) {
  if (!isValidVector(queryVector)) return [];
  if (!Number.isInteger(limit) || limit < 1) throw new RagError('INVALID_REQUEST', 400, 'top-k must be between 1 and 10.');
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) throw new RagError('INVALID_REQUEST', 400, 'min score must be between 0 and 1.');
  return chunks.map(chunk => {
    const score = cosineSimilarity(queryVector, chunk.embedding);
    return score === null ? null : { chunk, score };
  }).filter(Boolean).filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score ||
      String(a.chunk.source_type).localeCompare(String(b.chunk.source_type)) ||
      String(a.chunk.record_id ?? '').localeCompare(String(b.chunk.record_id ?? '')) ||
      Number(a.chunk.chunk_index || 0) - Number(b.chunk.chunk_index || 0))
    .slice(0, limit)
    .map(item => publicSource(item.chunk, item.score));
}

function explicitRecord(query, chunk) {
  // Identifiers are exact lookup hints, not natural-language semantics. Keep
  // their real similarity scores; never fabricate a high embedding score.
  return [chunk.source_id, chunk.record_id].some(id => {
    if (typeof id !== 'string' || id.length < 4 || id === chunk.mission_id) return false;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9_-])${escaped}(?=$|[^a-z0-9_-])`, 'i').test(query);
  });
}

async function retrieveOnce(query, missionId, options) {
  const config = options.config || readRagConfig();
  const db = options.db;
  const embedClient = options.embed || { createEmbedding, tokenCount: require('./embed').tokenCount };
  const embed = typeof embedClient === 'function' ? embedClient : embedClient.createEmbedding.bind(embedClient);
  const tokenCount = typeof embedClient === 'object' && embedClient.tokenCount
    ? embedClient.tokenCount.bind(embedClient)
    : null;
  const loadSnapshot = options.loadSnapshot || loadMissionSnapshot;
  const index = await readCurrentIndex(missionId, { db, loadSnapshot });
  if (tokenCount) {
    const count = await tokenCount(query);
    if (!Number.isFinite(count) || count > config.maxQuestionTokens) {
      throw new RagError('INVALID_REQUEST', 400, 'The question is too long for the local embedding model.');
    }
  }
  const queryVector = await embed(query);
  const ranked = rankChunks(queryVector, index.chunks, {
    limit: Math.max(config.topK, index.chunks.length),
    minScore: config.minScore
  });
  const summary = ranked.find(source => source.source_type === 'summary') || null;
  const exact = index.chunks.filter(chunk => !['summary', 'mission'].includes(chunk.source_type) && explicitRecord(query, chunk))
    .map(chunk => ({ ...publicSource(chunk, cosineSimilarity(queryVector, chunk.embedding)), retrieval_method: 'exact-id' }));
  const seen = new Set();
  const sources = [...exact, ...ranked].filter(source => {
    if (source.source_type === 'summary') return false;
    const key = `${source.source_type}:${source.record_id ?? source.source_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, config.topK);

  const after = await loadSnapshot(db, missionId);
  let currentManifest;
  try {
    currentManifest = await db.collection('rag_embeddings').findOne({
      _id: index.manifest._id, kind: 'index', mission_id: missionId
    });
  } catch (error) {
    if (isRagError(error)) throw error;
    throw new RagError('DATABASE_UNAVAILABLE', 503, 'RAG index storage is temporarily unavailable.');
  }
  if (!currentManifest || currentManifest.generation !== index.manifest.generation ||
      after.source_hash !== index.snapshot.source_hash || currentManifest.source_hash !== index.snapshot.source_hash) {
    throw new RagError('RAG_INDEX_CHANGED', 409, 'Mission data changed while it was being searched. Retry.');
  }
  return {
    mission_id: missionId,
    sources,
    summary,
    source_hash: index.snapshot.source_hash,
    generation: index.manifest.generation
  };
}

async function retrieve(query, missionId, options = {}) {
  const config = options.config || readRagConfig();
  if (typeof query !== 'string' || !query.trim()) throw new RagError('INVALID_REQUEST', 400, 'q must not be empty.');
  const limit = options.limit ?? config.topK;
  const minScore = options.minScore ?? config.minScore;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RagError('INVALID_REQUEST', 400, 'top-k must be between 1 and 10.');
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) throw new RagError('INVALID_REQUEST', 400, 'min score must be between 0 and 1.');
  const scoped = { ...options, config: { ...config, topK: limit, minScore } };
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await retrieveOnce(query, missionId, scoped);
    } catch (error) {
      if (isRagError(error) && error.code === 'RAG_INDEX_CHANGED' && attempt === 0) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError || new RagError('RAG_INDEX_CHANGED', 409, 'Mission index changed while it was being read. Retry.');
}

module.exports = { cosineSimilarity, rankChunks, retrieve, publicSource };
