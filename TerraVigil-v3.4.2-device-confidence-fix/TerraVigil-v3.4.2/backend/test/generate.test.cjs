'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateAnswer, buildPrompt, FALLBACK, classifyProviderError } = require('../rag/generate');
const { chunkDocuments } = require('../rag/chunk');

test('a retrieved risk projection supplies complete exact record facts and totals to generation', async () => {
  const facts = { mission_id: 'M1', status: 'UNCONFIRMED', risk_level: 'HIGH', latitude: 17.44545, longitude: 78.34815, yolo_confidence: 0.77, metal_detected: false };
  const summary = { mission_id: 'M1', highest_risk: 'HIGH', total_records: 8, confirmed: 4, unconfirmed: 4 };
  const chunks = await chunkDocuments([
    { mission_id: 'M1', source_type: 'observation', source_id: 'O1', record_id: 'row-o1', facts, validation_issues: ['example_issue'] },
    { mission_id: 'M1', source_type: 'summary', source_id: null, record_id: 'summary', facts: summary, validation_issues: [] }
  ], { tokenCount: text => text.length, maxTokens: 512 });
  const evidence = chunks.filter(row => /(?:risk level|highest risk) =/.test(row.text));
  assert.equal(evidence.length, 2);
  let sentPrompt;
  const answer = await generateAnswer('Where is the highest-risk observation and is it confirmed?', evidence, {
    missionId: 'M1', config: { generationTimeoutMs: 1000 }, callModel: async prompt => {
      sentPrompt = prompt;
      return 'Verified prompt handoff.';
    }
  });
  assert.equal(answer, 'Verified prompt handoff.');
  const blocks = [...sentPrompt.matchAll(/BEGIN_FACTS\n([\s\S]*?)\nEND_FACTS/g)];
  assert.ok(blocks[0][1].includes('17.44545'), 'stored location must reach generation despite a short risk search chunk');
  const context = blocks.map(block => JSON.parse(block[1]));
  assert.deepEqual(context[0], { facts, validation_issues: ['example_issue'] });
  assert.deepEqual(context[1], { facts: summary, validation_issues: [] });
});

test('no context never contacts Gemini', async () => {
  let calls = 0;
  const answer = await generateAnswer('Drone temperature?', [], {
    missionId: 'M1', config: {}, callModel: async () => { calls += 1; return 'invented'; }
  });
  assert.equal(answer, FALLBACK);
  assert.equal(calls, 0);
});

test('mission context is labelled and keeps confirmation separate from risk', () => {
  const prompt = buildPrompt('What is the risk?', [{
    mission_id: 'M1', source_type: 'observation', source_id: 'O1', record_id: 'mongo-o1',
    text: '{"status":"UNCONFIRMED","risk_level":"HIGH"}'
  }], 'M1');
  assert.match(prompt, /UNCONFIRMED/);
  assert.match(prompt, /HIGH/);
  assert.match(prompt, /Information not available in mission data\./);
});

test('uses injected provider and never leaks provider exception text', async () => {
  const answer = await generateAnswer('What is the risk?', [{
    mission_id: 'M1', source_type: 'summary', record_id: null, chunk_index: 0, text: '{"highest_risk":"HIGH"}'
  }], {
    missionId: 'M1', config: { generationTimeoutMs: 1000 }, callModel: async prompt => {
      assert.match(prompt, /highest_risk/);
      return 'The highest stored risk is HIGH.';
    }
  });
  assert.equal(answer, 'The highest stored risk is HIGH.');
});

test('provider categories are safe and fixed', () => {
  assert.equal(classifyProviderError({ status: 401, message: 'fake-secret=abc' }).code, 'GEMINI_AUTH_FAILED');
  assert.equal(classifyProviderError({ status: 404 }).code, 'GEMINI_MODEL_UNAVAILABLE');
  assert.equal(classifyProviderError({ status: 429 }).code, 'GEMINI_RATE_LIMITED');
  assert.equal(classifyProviderError({ message: 'fake-secret=abc' }).code, 'GEMINI_FAILED');
});

test('Gemini transport sends a real generation request and exposes no key in its URL or health', async t => {
  const { defaultCallModel, getGenerationStatus } = require('../rag/generate');
  assert.equal(typeof getGenerationStatus, 'function');
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    assert.match(url, /models\/test-model:generateContent$/);
    assert.ok(!url.includes('private-key'));
    assert.equal(options.headers['x-goog-api-key'], 'private-key');
    assert.equal(JSON.parse(options.body).contents[0].parts[0].text, 'A grounded prompt');
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'internal', thought: true }, { text: 'Answer [1]' }] } }] }) };
  };
  const answer = await defaultCallModel('A grounded prompt', { config: { geminiKey: 'private-key', geminiModel: 'test-model', generationTimeoutMs: 1000 } });
  assert.equal(answer, 'Answer [1]');
  assert.equal(getGenerationStatus().ready, true);
  assert.ok(!JSON.stringify(getGenerationStatus()).includes('private-key'));
});
