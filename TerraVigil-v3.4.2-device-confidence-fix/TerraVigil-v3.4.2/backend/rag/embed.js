'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RagError } = require('./errors');
const { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } = require('./config');
let embeddingStatus = { ready: false, checkedAt: null };
const getEmbeddingStatus = () => ({ ...embeddingStatus });

function vectorValues(vector) {
  if (Array.isArray(vector) || ArrayBuffer.isView(vector)) return Array.from(vector);
  if (vector && Array.isArray(vector.data)) return vector.data.slice();
  if (vector && ArrayBuffer.isView(vector.data)) return Array.from(vector.data);
  return null;
}

function isValidVector(vector) {
  const values = vectorValues(vector);
  if (!values || values.length !== EMBEDDING_DIMENSIONS || values.some(value => !Number.isFinite(value))) return false;
  let norm = 0;
  for (const value of values) norm += value * value;
  return Number.isFinite(norm) && norm > 0;
}

function normalize(values) {
  let norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return null;
  return values.map(value => value / norm);
}

function outputVector(output) {
  const values = vectorValues(output);
  if (!values) return null;
  if (values.length === EMBEDDING_DIMENSIONS) return normalize(values);
  const dims = output && Array.isArray(output.dims) ? output.dims : null;
  const dimension = dims && dims[dims.length - 1] ? dims[dims.length - 1] : EMBEDDING_DIMENSIONS;
  if (dimension !== EMBEDDING_DIMENSIONS || values.length % dimension !== 0) return null;
  const rows = values.length / dimension;
  const pooled = Array.from({ length: dimension }, () => 0);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < dimension; column += 1) pooled[column] += values[row * dimension + column];
  }
  return normalize(pooled.map(value => value / rows));
}

async function defaultLoadExtractor() {
  const { modelCacheDir } = require('./config').readRagConfig();
  fs.mkdirSync(modelCacheDir, { recursive: true });
  const transformers = await import('@huggingface/transformers');
  if (transformers.env) {
    transformers.env.cacheDir = modelCacheDir;
    transformers.env.allowRemoteModels = true;
    transformers.env.allowLocalModels = true;
  }
  return transformers.pipeline('feature-extraction', EMBEDDING_MODEL, { device: 'cpu', dtype: 'q8' });
}

function makeEmbedder(loadExtractor = defaultLoadExtractor) {
  let extractorPromise;
  const getExtractor = () => {
    if (!extractorPromise) {
      extractorPromise = Promise.resolve().then(() => loadExtractor()).catch(error => {
        extractorPromise = undefined;
        if (error instanceof RagError) throw error;
        throw new RagError('EMBEDDING_UNAVAILABLE', 503, 'Local embedding model is unavailable.');
      });
    }
    return extractorPromise;
  };

  async function tokenCount(text) {
    if (typeof text !== 'string') throw new RagError('INVALID_REQUEST', 400, 'Text must be a string.');
    const extractor = await getExtractor();
    try {
      const encoded = extractor && extractor.tokenizer && extractor.tokenizer.encode
        // Transformers.js tokenizers include their configured special tokens in
        // encode(text). Passing an options object as the second argument is
        // interpreted as a text pair by some tokenizer versions.
        ? extractor.tokenizer.encode(text)
        : null;
      if (encoded && Array.isArray(encoded)) return encoded.length;
      if (encoded && ArrayBuffer.isView(encoded)) return encoded.length;
      if (encoded && Array.isArray(encoded.input_ids)) return encoded.input_ids.length;
      throw new Error('tokenizer unavailable');
    } catch (error) {
      if (error instanceof RagError) throw error;
      throw new RagError('EMBEDDING_UNAVAILABLE', 503, 'Local embedding tokenizer is unavailable.');
    }
  }

  async function createEmbedding(text) {
    if (typeof text !== 'string' || text.length === 0) throw new RagError('INVALID_REQUEST', 400, 'Cannot embed empty text.');
    const extractor = await getExtractor();
    try {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      const vector = outputVector(output);
      if (!vector || !isValidVector(vector)) throw new Error('invalid embedding vector');
      embeddingStatus = { ready: true, checkedAt: new Date().toISOString() };
      return vector;
    } catch (error) {
      if (error instanceof RagError) throw error;
      throw new RagError('EMBEDDING_UNAVAILABLE', 503, 'Local embedding model is unavailable.');
    }
  }

  return { createEmbedding, tokenCount, getExtractor };
}

const defaultClient = makeEmbedder();

module.exports = {
  makeEmbedder,
  createEmbedding: defaultClient.createEmbedding,
  tokenCount: defaultClient.tokenCount,
  getExtractor: defaultClient.getExtractor,
  isValidVector,
  vectorValues,
  getEmbeddingStatus
};
