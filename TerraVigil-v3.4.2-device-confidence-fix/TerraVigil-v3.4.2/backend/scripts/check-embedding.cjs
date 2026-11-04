'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createEmbedding } = require('../rag/embed');
const { readRagConfig } = require('../rag/config');

(async () => {
  const config = readRagConfig();
  try {
    const vector = await createEmbedding('TerraVigil embedding readiness check.');
    let norm = 0;
    for (const value of vector) norm += value * value;
    console.log(JSON.stringify({
      model: config.embeddingModel,
      dimensions: vector.length,
      finite: vector.every(Number.isFinite),
      nonzero_norm: Number.isFinite(norm) && norm > 0,
      cache_ready: fs.existsSync(path.resolve(config.modelCacheDir))
    }));
  } catch (error) {
    console.error(JSON.stringify({
      model: config.embeddingModel,
      cache_ready: fs.existsSync(path.resolve(config.modelCacheDir)),
      status: 'unavailable'
    }));
    process.exitCode = 1;
  }
})();
