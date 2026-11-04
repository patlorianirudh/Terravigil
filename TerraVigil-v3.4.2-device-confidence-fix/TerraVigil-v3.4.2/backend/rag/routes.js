'use strict';

const express = require('express');
const { publicError, RagError } = require('./errors');
const { readRagConfig, validateMissionId, validateQuestion, validateScalar } = require('./config');

function responseSignal(req, res) {
  // IncomingMessage.signal may already be aborted once its body was consumed.
  // The expensive response work should stop only when the client disconnects.
  const controller = new AbortController();
  const aborted = () => controller.abort();
  const closed = () => { if (!res.writableEnded) controller.abort(); cleanup(); };
  const cleanup = () => { req.off('aborted', aborted); res.off('close', closed); };
  req.once('aborted', aborted);
  res.once('close', closed);
  return { signal: controller.signal, cleanup };
}

function optionalNumber(query, name, { integer = false, min, max } = {}) {
  if (query[name] === undefined) return undefined;
  const raw = validateScalar(query[name], name);
  if (typeof raw !== 'string' || raw.trim() === '') throw new RagError('INVALID_REQUEST', 400, `${name} must be a scalar number.`);
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) ||
      (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new RagError('INVALID_REQUEST', 400, `${name} is out of range.`);
  }
  return value;
}

function createRagRouter(service) {
  if (!service || typeof service.documents !== 'function' || typeof service.prepare !== 'function' ||
      typeof service.search !== 'function' || typeof service.ask !== 'function') {
    throw new Error('A complete RAG service is required');
  }
  const router = express.Router();

  router.get('/missions/:mission_id/rag-documents', async (req, res, next) => {
    try {
      const config = readRagConfig();
      const missionId = validateMissionId(req.params.mission_id, config);
      res.json(await service.documents(missionId));
    } catch (error) { next(error); }
  });

  router.post('/missions/:mission_id/create-embeddings', async (req, res, next) => {
    const request = responseSignal(req, res);
    try {
      const config = readRagConfig();
      const missionId = validateMissionId(req.params.mission_id, config);
      res.json(await service.prepare(missionId, { signal: request.signal }));
    } catch (error) { next(error); } finally { request.cleanup(); }
  });

  router.get('/missions/:mission_id/search', async (req, res, next) => {
    try {
      const config = readRagConfig();
      const missionId = validateMissionId(req.params.mission_id, config);
      const rawQuestion = validateScalar(req.query.q, 'q');
      const question = validateQuestion(rawQuestion, config);
      const limit = optionalNumber(req.query, 'top_k', { integer: true, min: 1, max: 10 });
      const minScore = optionalNumber(req.query, 'min_score', { min: 0, max: 1 });
      res.json(await service.search(question, missionId, { limit, minScore }));
    } catch (error) { next(error); }
  });

  router.get('/missions/:mission_id/ask', async (req, res, next) => {
    const request = responseSignal(req, res);
    try {
      const config = readRagConfig();
      const missionId = validateMissionId(req.params.mission_id, config);
      const rawQuestion = validateScalar(req.query.q, 'q');
      const question = validateQuestion(rawQuestion, config);
      const limit = optionalNumber(req.query, 'top_k', { integer: true, min: 1, max: 10 });
      const minScore = optionalNumber(req.query, 'min_score', { min: 0, max: 1 });
      res.json(await service.ask(question, missionId, { signal: request.signal, limit, minScore }));
    } catch (error) { next(error); } finally { request.cleanup(); }
  });

  router.use((error, _req, res, _next) => {
    const { status, body } = publicError(error);
    if (!res.headersSent) res.status(status).json(body);
  });
  return router;
}

module.exports = { createRagRouter, optionalNumber };
