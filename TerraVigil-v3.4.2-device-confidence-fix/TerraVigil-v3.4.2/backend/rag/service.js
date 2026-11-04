'use strict';

const { RagError, isRagError } = require('./errors');
const { readRagConfig, requireGeminiConfig, validateMissionId, validateQuestion } = require('./config');
const { loadMissionSnapshot } = require('./documents');
const { storeEmbeddings } = require('./embed-store');
const { retrieve } = require('./retrieve');
const { generateAnswer } = require('./generate');

function withDeadline(work, timeoutMs, parentSignal) {
  const controller = new AbortController();
  let timer;
  let relay;
  if (parentSignal) {
    relay = () => controller.abort();
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', relay, { once: true });
  }
  const timeout = Number.isFinite(timeoutMs) ? timeoutMs : 180000;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RagError('RAG_TIMEOUT', 504, 'RAG operation timed out.'));
    }, timeout);
  });
  return Promise.race([Promise.resolve().then(() => work(controller.signal)), deadline])
    .catch(error => {
      if (error && error.name === 'AbortError') throw new RagError('RAG_TIMEOUT', 504, 'RAG operation timed out.');
      if (isRagError(error)) throw error;
      throw error;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
      if (parentSignal && relay) parentSignal.removeEventListener('abort', relay);
    });
}

function createRagService({ getDB, embed, chunk, generate, autoPrepare = false, config: injectedConfig } = {}) {
  if (typeof getDB !== 'function') throw new Error('getDB is required');
  const getConfig = () => typeof injectedConfig === 'function' ? injectedConfig() : (injectedConfig || readRagConfig());
  const database = async () => {
    try {
      return await getDB();
    } catch (error) {
      if (isRagError(error)) throw error;
      throw new RagError('DATABASE_UNAVAILABLE', 503, 'Mission data is temporarily unavailable.');
    }
  };

  async function documents(missionId) {
    const config = getConfig();
    validateMissionId(missionId, config);
    const db = await database();
    const snapshot = await loadMissionSnapshot(db, missionId);
    return { mission_id: missionId, source_hash: snapshot.source_hash, documents: snapshot.documents };
  }

  async function prepare(missionId, { signal } = {}) {
    const config = getConfig();
    validateMissionId(missionId, config);
    const db = await database();
    return withDeadline(prepareSignal => storeEmbeddings(missionId, {
      db,
      embed,
      chunk,
      loadSnapshot: loadMissionSnapshot,
      signal: prepareSignal,
      config
    }), config.indexTimeoutMs, signal);
  }

  async function search(question, missionId, options = {}) {
    const config = getConfig();
    const validMission = validateMissionId(missionId, config);
    const validQuestion = validateQuestion(question, config);
    if (autoPrepare) await prepare(validMission);
    const db = await database();
    const requestConfig = {
      ...config,
      ...(options.limit === undefined ? {} : { topK: options.limit }),
      ...(options.minScore === undefined ? {} : { minScore: options.minScore })
    };
    const result = await retrieve(validQuestion, validMission, {
      db, embed, loadSnapshot: loadMissionSnapshot, config: requestConfig
    });
    return { mission_id: validMission, question: validQuestion, sources: result.sources };
  }

  async function ask(question, missionId, { signal, limit, minScore } = {}) {
    const config = getConfig();
    const validMission = validateMissionId(missionId, config);
    const validQuestion = validateQuestion(question, config);
    // Integrated operation must never pretend that a configured fixture is an LLM.
    if (autoPrepare && !generate) requireGeminiConfig(config);
    if (autoPrepare) await prepare(validMission, { signal });
    const db = await database();
    const requestConfig = {
      ...config,
      ...(limit === undefined ? {} : { topK: limit }),
      ...(minScore === undefined ? {} : { minScore })
    };
    const retrieval = await retrieve(validQuestion, validMission, {
      db, embed, loadSnapshot: loadMissionSnapshot, config: requestConfig
    });
    if (signal && signal.aborted) throw new RagError('RAG_TIMEOUT', 504, 'RAG generation timed out.');
    // Exact full-mission totals remain available even for greetings and queries
    // whose closest vectors are individual records. Never total a partial top-k.
    const summary = retrieval.summary || (autoPrepare ? (await loadMissionSnapshot(db, validMission)).summary : null);
    const evidence = summary ? [summary, ...retrieval.sources] : retrieval.sources;
    const answer = await withDeadline(generationSignal => (generate || generateAnswer)(validQuestion, evidence, {
      missionId: validMission,
      config,
      signal: generationSignal
    }), config.generationTimeoutMs, signal);
    if (signal && signal.aborted) throw new RagError('RAG_TIMEOUT', 504, 'RAG generation timed out.');
    const after = await loadMissionSnapshot(db, validMission);
    let currentManifest;
    try {
      currentManifest = await db.collection('rag_embeddings').findOne({
        _id: `index:${JSON.stringify(validMission)}`, kind: 'index', mission_id: validMission
      });
    } catch (error) {
      if (isRagError(error)) throw error;
      throw new RagError('DATABASE_UNAVAILABLE', 503, 'RAG index storage is temporarily unavailable.');
    }
    if (!currentManifest || currentManifest.generation !== retrieval.generation ||
        after.source_hash !== retrieval.source_hash) {
      throw new RagError('RAG_INDEX_CHANGED', 409, 'Mission data changed while the answer was generated. Retry.');
    }
    return {
      mission_id: validMission,
      question: validQuestion,
      answer,
      sources: evidence
    };
  }

  return { documents, prepare, search, ask };
}

module.exports = { createRagService, withDeadline };
