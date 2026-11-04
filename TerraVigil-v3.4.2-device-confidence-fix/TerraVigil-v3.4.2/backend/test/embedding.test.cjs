'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { makeEmbedder, isValidVector } = require('../rag/embed');
const { chunkText, chunkDocuments } = require('../rag/chunk');

function extractorForTests() {
  const extractor = async () => ({ data: Float32Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0) });
  extractor.tokenizer = { encode: text => Array.from(text) };
  return extractor;
}

test('shares initialization and does not truncate the end of source text', async () => {
  let loads = 0;
  const client = makeEmbedder(async () => { loads += 1; return extractorForTests(); });
  await Promise.all([client.createEmbedding('a'), client.createEmbedding('b')]);
  assert.equal(loads, 1);
  const input = 'first 🛰 last';
  const chunks = await chunkText(input, { tokenCount: client.tokenCount, maxTokens: 6 });
  assert.equal(chunks.join(''), input);
  for (const chunk of chunks) assert.ok(await client.tokenCount(chunk) <= 6);
});

test('resets a rejected lazy load so a later request can recover', async () => {
  let loads = 0;
  const client = makeEmbedder(async () => {
    loads += 1;
    if (loads === 1) throw new Error('download failed');
    return extractorForTests();
  });
  await assert.rejects(() => client.createEmbedding('first'), /Local embedding model is unavailable/);
  assert.ok(await client.createEmbedding('second'));
  assert.equal(loads, 2);
});

test('accepts only finite nonzero 384-dimensional vectors', () => {
  assert.equal(isValidVector(Array(384).fill(1)), true);
  assert.equal(isValidVector(Array(383).fill(1)), false);
  assert.equal(isValidVector(Array(384).fill(0)), false);
  const nan = Array(384).fill(1); nan[10] = Number.NaN;
  assert.equal(isValidVector(nan), false);
});

test('preserves unstructured source text and metadata through token-bounded chunks', async () => {
  const client = makeEmbedder(async () => extractorForTests());
  const chunks = await chunkDocuments([{
    mission_id: 'M1', source_type: 'observation', source_id: 'O1', record_id: 'mongo-o1',
    section: 'Observation', validation_issues: [],
    text: 'abcdefghij'
  }], { tokenCount: client.tokenCount, maxTokens: 4 });
  assert.equal(chunks.map(chunk => chunk.text).join(''), 'abcdefghij');
  assert.ok(chunks.every(chunk => chunk.mission_id === 'M1' && chunk.record_id === 'mongo-o1'));
});

test('projects each structured fact in sorted order with full exact evidence metadata', async () => {
  const document = {
    mission_id: 'M1', source_type: 'observation', source_id: 'O1', record_id: 'mongo-o1',
    section: 'Observation', document: 'observation record',
    facts: {
      status: 'UNCONFIRMED', risk_level: 'HIGH', metal_detected: false,
      normalized_center: { y: 0.75, x: 0.25 }, metal_signal: null
    },
    validation_issues: ['status_sensor_conflict'], text: 'stale text must not replace stored facts'
  };
  const before = structuredClone(document);
  const chunks = await chunkDocuments([document], { tokenCount: text => Array.from(text).length });
  assert.deepEqual(chunks.map(chunk => chunk.text), [
    'Mission observation: metal detected = false.\nValidation issues: ["status_sensor_conflict"]',
    'Mission observation: metal signal = null.\nValidation issues: ["status_sensor_conflict"]',
    'Mission observation: normalized center = {"x":0.25,"y":0.75}.\nValidation issues: ["status_sensor_conflict"]',
    'Mission observation: risk level = "HIGH".\nValidation issues: ["status_sensor_conflict"]',
    'Mission observation: status = "UNCONFIRMED".\nValidation issues: ["status_sensor_conflict"]'
  ]);
  assert.deepEqual(chunks.map(chunk => chunk.chunk_index), [0, 1, 2, 3, 4]);
  for (const chunk of chunks) {
    for (const field of ['mission_id', 'source_type', 'source_id', 'record_id', 'section', 'document', 'facts', 'validation_issues']) {
      assert.deepEqual(chunk[field], document[field]);
    }
    assert.equal(chunk.content_hash, crypto.createHash('sha256').update(chunk.text, 'utf8').digest('hex'));
    assert.ok(Array.from(chunk.text).length <= 256);
  }
  assert.deepEqual(document, before);
});

test('projection ordering and hashes are stable while a changed value changes its chunk hash', async () => {
  const original = {
    mission_id: 'M1', source_type: 'detection', source_id: 'D1', record_id: 'mongo-d1',
    facts: { risk_level: 'HIGH', normalized_center: { y: 0.75, x: 0.25 }, metal_signal: 0.86 },
    validation_issues: []
  };
  const reversed = { ...original, facts: { metal_signal: 0.86, normalized_center: { x: 0.25, y: 0.75 }, risk_level: 'HIGH' } };
  const tokenize = { tokenCount: text => Array.from(text).length };
  const first = await chunkDocuments([original], tokenize);
  const second = await chunkDocuments([reversed], tokenize);
  assert.deepEqual(first, second);
  const changed = await chunkDocuments([{ ...original, facts: { ...original.facts, risk_level: 'LOW' } }], tokenize);
  assert.deepEqual(first.map((chunk, index) => chunk.content_hash === changed[index].content_hash), [true, true, false]);
  const duplicateLogicalId = await chunkDocuments([original, { ...original, record_id: 'mongo-d2' }], tokenize);
  assert.deepEqual([...new Set(duplicateLogicalId.map(chunk => chunk.record_id))], ['mongo-d1', 'mongo-d2']);
});

test('long field projections preserve every Unicode character and source fact within the token bound', async () => {
  const facts = { note: 'First 🛰 "quoted" value\n'.repeat(30) + 'END-OF-STORED-VALUE' };
  const document = { mission_id: 'M1', source_type: 'mission', record_id: 'mongo-m1', facts, validation_issues: [] };
  const chunks = await chunkDocuments([document], { tokenCount: text => Array.from(text).length, maxTokens: 64 });
  const expected = `Mission mission: note = ${JSON.stringify(facts.note)}.\nValidation issues: []`;
  assert.equal(chunks.map(chunk => chunk.text).join(''), expected);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(Array.from(chunk.text).length <= 64);
    assert.deepEqual(chunk.facts, facts);
    assert.deepEqual(chunk.validation_issues, []);
  }
});
