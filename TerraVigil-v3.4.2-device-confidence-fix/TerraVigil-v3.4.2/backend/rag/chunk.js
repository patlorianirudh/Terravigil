'use strict';

const crypto = require('node:crypto');
const { RagError } = require('./errors');
const { canonicalJson } = require('./documents');

const CHUNK_SCHEMA_VERSION = 2;

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function checkedCount(tokenCount, text) {
  const count = await tokenCount(text);
  if (!Number.isFinite(count) || count < 0) throw new RagError('INVALID_REQUEST', 400, 'The tokenizer returned an invalid token count.');
  return count;
}

async function chunkText(text, { tokenCount, maxTokens = 256 } = {}) {
  if (typeof text !== 'string') throw new RagError('INVALID_REQUEST', 400, 'Chunk text must be a string.');
  if (typeof tokenCount !== 'function') throw new RagError('INVALID_REQUEST', 400, 'A tokenizer is required.');
  if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new RagError('INVALID_REQUEST', 400, 'maxTokens must be a positive integer.');
  if (text.length === 0) return [];
  const characters = Array.from(text);
  const chunks = [];
  let start = 0;

  while (start < characters.length) {
    const remainder = characters.slice(start).join('');
    if (await checkedCount(tokenCount, remainder) <= maxTokens) {
      chunks.push(remainder);
      break;
    }
    let low = start + 1;
    let high = characters.length;
    let best = start;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = characters.slice(start, middle).join('');
      if (await checkedCount(tokenCount, candidate) <= maxTokens) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best === start) {
      throw new RagError('INVALID_REQUEST', 400, 'Text contains a token that exceeds the embedding limit.');
    }
    chunks.push(characters.slice(start, best).join(''));
    start = best;
  }
  for (const chunk of chunks) {
    if (await checkedCount(tokenCount, chunk) > maxTokens) {
      throw new RagError('INVALID_REQUEST', 400, 'The source text could not be split within the embedding limit.');
    }
  }
  return chunks;
}

async function chunkDocuments(documents, { tokenCount, maxTokens = 256 } = {}) {
  if (!Array.isArray(documents)) throw new RagError('INVALID_REQUEST', 400, 'Documents must be an array.');
  const chunks = [];
  for (const document of documents) {
    const facts = document.facts;
    const keys = facts && typeof facts === 'object' && !Array.isArray(facts)
      ? Object.keys(facts).filter(key => facts[key] !== undefined).sort()
      : [];
    // Short, factual projections keep unrelated coordinates/IDs from diluting a
    // field's embedding. Labels are derived mechanically; values and validation
    // issues remain exact, and every chunk retains the complete source facts.
    const projections = keys.length ? keys.map(key => [
      `Mission ${document.source_type || 'record'}: ${key.replaceAll('_', ' ')} = ${canonicalJson(facts[key])}.`,
      `Validation issues: ${canonicalJson(document.validation_issues || [])}`
    ].join('\n')) : [document.text || ''];
    const pieces = [];
    for (const projection of projections) {
      pieces.push(...await chunkText(projection, { tokenCount, maxTokens }));
    }
    pieces.forEach((text, index) => {
      chunks.push({
        mission_id: document.mission_id,
        source_type: document.source_type,
        source_id: document.source_id ?? null,
        record_id: document.record_id ?? null,
        section: document.section,
        document: document.document,
        facts: document.facts,
        validation_issues: document.validation_issues || [],
        text,
        chunk_index: index,
        content_hash: contentHash(text)
      });
    });
  }
  return chunks;
}

module.exports = { CHUNK_SCHEMA_VERSION, chunkText, chunkDocuments, contentHash };
