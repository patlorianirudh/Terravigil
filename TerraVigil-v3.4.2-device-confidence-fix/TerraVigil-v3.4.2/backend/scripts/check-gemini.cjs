'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { readRagConfig } = require('../rag/config');
const { defaultCallModel, classifyProviderError } = require('../rag/generate');

(async () => {
  let config;
  try {
    config = readRagConfig();
    if (!config.geminiKey) {
      console.log(JSON.stringify({ configured: false, reason: 'missing_key', model: config.geminiModel }));
      process.exitCode = 1;
      return;
    }
    await defaultCallModel('Reply with the single word READY.', { config });
    console.log(JSON.stringify({ configured: true, model: config.geminiModel, status: 'ready' }));
  } catch (error) {
    const safe = classifyProviderError(error);
    console.error(JSON.stringify({
      configured: Boolean(config && config.geminiKey),
      model: config && config.geminiModel,
      code: safe.code,
      status: safe.status
    }));
    process.exitCode = 1;
  }
})();
