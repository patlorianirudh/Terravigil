'use strict';

const express = require('express');
const { createReportService } = require('./service');
const { ReportError } = require('./snapshot');

function createReportRouter(options) {
  const service = createReportService(options);
  const router = express.Router();
  const route = handler => async (req, res, next) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };
  router.get('/reports', route(async (req, res) => { res.json(await service.list(req.query.sessionId)); }));
  router.post('/reports', route(async (req, res) => { res.status(201).json(await service.create(req.body)); }));
  router.get('/reports/:id', route(async (req, res) => { res.json(await service.get(req.params.id)); }));
  router.get('/reports/:id/download', route(async (req, res) => {
    const file = await service.download(req.params.id, req.query.format);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'ETag': `"sha256-${file.hash}"`
    });
    res.send(file.bytes);
  }));
  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const known = error instanceof ReportError;
    const status = known ? error.status : 503;
    const message = known ? error.message : 'Report storage or generation is temporarily unavailable. No new report was published.';
    res.status(status).json({ code: known ? error.code : 'REPORT_STORAGE_UNAVAILABLE', error: message, message,
      ...(error.narrativeError ? { narrativeError: error.narrativeError } : {}) });
  });
  return router;
}

module.exports = { createReportRouter };
