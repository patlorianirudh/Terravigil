'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createRagRouter } = require('../rag/routes');
const { RagError } = require('../rag/errors');

async function withServer(service, fn) {
  const app = express();
  app.use(createRagRouter(service));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  try { return await fn(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('routes trim questions and keep mission IDs exact', async () => {
  const calls = [];
  const service = {
    documents: async missionId => ({ mission_id: missionId, source_hash: 'hash', documents: [] }),
    prepare: async missionId => ({ mission_id: missionId, status: 'ready', indexed_chunks: 1 }),
    search: async (question, missionId) => { calls.push(['search', question, missionId]); return { mission_id: missionId, question, sources: [] }; },
    ask: async (question, missionId) => { calls.push(['ask', question, missionId]); return { mission_id: missionId, question, answer: 'ok', sources: [] }; }
  };
  await withServer(service, async base => {
    const response = await fetch(`${base}/missions/M%201/ask?q=%20What%20is%20the%20risk%3F%20`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mission_id: 'M 1', question: 'What is the risk?', answer: 'ok', sources: [] });
    assert.deepEqual(calls[0], ['ask', 'What is the risk?', 'M 1']);
  });
});

test('routes map typed failures and do not expose provider exception text', async () => {
  const canary = 'provider-error-canary';
  const service = {
    documents: async () => { throw new RagError('MISSION_NOT_FOUND', 404, 'Mission not found.'); },
    prepare: async () => { throw new RagError('RAG_NOT_INDEXED', 409, 'Prepare this mission data before asking questions.'); },
    search: async () => ({ mission_id: 'M1', sources: [] }),
    ask: async () => { const error = new Error(canary); error.status = 401; throw error; }
  };
  await withServer(service, async base => {
    const missing = await fetch(`${base}/missions/M1/rag-documents`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { code: 'MISSION_NOT_FOUND', message: 'Mission not found.' });
    const notIndexed = await fetch(`${base}/missions/M1/create-embeddings`, { method: 'POST' });
    assert.equal(notIndexed.status, 409);
    assert.equal((await notIndexed.json()).code, 'RAG_NOT_INDEXED');
    const failed = await fetch(`${base}/missions/M1/ask?q=hello`);
    assert.equal(failed.status, 503);
    const body = await failed.text();
    assert.equal(body.includes(canary), false);
  });
});

test('rejects repeated and overlong scalar query parameters', async () => {
  const service = { documents: async () => ({}), prepare: async () => ({}), search: async () => ({}), ask: async () => ({}) };
  await withServer(service, async base => {
    const repeated = await fetch(`${base}/missions/M1/search?q=one&q=two`);
    assert.equal(repeated.status, 400);
    assert.equal((await repeated.json()).code, 'INVALID_REQUEST');
    const missing = await fetch(`${base}/missions/M1/search`);
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).code, 'INVALID_REQUEST');
  });
});
