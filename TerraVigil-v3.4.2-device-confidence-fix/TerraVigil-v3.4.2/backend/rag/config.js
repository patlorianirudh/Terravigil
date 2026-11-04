'use strict';

const path = require('node:path');
const { RagError } = require('./errors');

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSIONS = 384;
// Bump this when the embedding runtime, model, tokenizer, dtype or pooling changes.
// A model name alone cannot establish that old and new vectors are compatible.
const EMBEDDING_PROFILE = `${EMBEDDING_MODEL}:transformers-4.3.0:ort-1.30.0:cpu:q8:mean:l2`;
const MAX_QUESTION_LENGTH = 1000;
const MAX_MISSION_ID_LENGTH = 128;
const MAX_QUESTION_TOKENS = 256;

function parseNumber(env, name, fallback, { integer = false, min, max } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  const valid = Number.isFinite(value) && (!integer || Number.isInteger(value)) &&
    (min === undefined || value >= min) && (max === undefined || value <= max);
  if (!valid) {
    throw new RagError('RAG_NOT_CONFIGURED', 503, `Invalid RAG setting ${name}.`);
  }
  return value;
}

function parseModel(env) {
  const raw = env.GEMINI_MODEL;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 'gemini-2.5-flash';
  const value = String(raw).trim();
  if (value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new RagError('RAG_NOT_CONFIGURED', 503, 'Invalid GEMINI_MODEL setting.');
  }
  return value;
}

function readRagConfig(env = process.env) {
  return {
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    chunkMaxTokens: 256,
    maxQuestionTokens: MAX_QUESTION_TOKENS,
    maxQuestionLength: MAX_QUESTION_LENGTH,
    maxMissionIdLength: MAX_MISSION_ID_LENGTH,
    topK: parseNumber(env, 'RAG_TOP_K', 3, { integer: true, min: 1, max: 10 }),
    minScore: parseNumber(env, 'RAG_MIN_SCORE', 0.30, { min: 0, max: 1 }),
    generationTimeoutMs: parseNumber(env, 'RAG_GENERATION_TIMEOUT_MS', 45000, {
      integer: true, min: 100, max: 900000
    }),
    indexTimeoutMs: parseNumber(env, 'RAG_INDEX_TIMEOUT_MS', 180000, {
      integer: true, min: 100, max: 1800000
    }),
    geminiKey: env.GEMINI_API_KEY ? String(env.GEMINI_API_KEY).trim() : null,
    geminiModel: parseModel(env),
    modelCacheDir: path.join(__dirname, '..', '.cache', 'transformers')
  };
}

function requireGeminiConfig(config) {
  if (!config || !config.geminiKey || !config.geminiModel) {
    throw new RagError('GEMINI_NOT_CONFIGURED', 503,
      'Gemini is not configured. Set GEMINI_API_KEY and GEMINI_MODEL in the backend .env.');
  }
}

function validateMissionId(value, config = {}) {
  const max = config.maxMissionIdLength || MAX_MISSION_ID_LENGTH;
  if (typeof value !== 'string' || value.length === 0 || value.length > max ||
      value.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new RagError('INVALID_REQUEST', 400, 'mission_id must be a non-empty safe string.');
  }
  return value;
}

function validateQuestion(value, config = {}) {
  const max = config.maxQuestionLength || MAX_QUESTION_LENGTH;
  if (typeof value !== 'string' || value.length === 0 || value.length > max ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw new RagError('INVALID_REQUEST', 400, 'q must be a question of at most 1,000 characters.');
  }
  const question = value.trim();
  if (!question) throw new RagError('INVALID_REQUEST', 400, 'q must not be empty.');
  return question;
}

function validateScalar(value, name) {
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
    throw new RagError('INVALID_REQUEST', 400, `${name} must be a scalar value.`);
  }
  return value;
}

module.exports = {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROFILE,
  MAX_QUESTION_LENGTH,
  MAX_MISSION_ID_LENGTH,
  MAX_QUESTION_TOKENS,
  readRagConfig,
  requireGeminiConfig,
  validateMissionId,
  validateQuestion,
  validateScalar
};
