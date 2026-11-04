'use strict';
const express = require('express');
function createBridgeRouter(service) {
  const router = express.Router();
  router.get('/bridge/status', async (_req, res) => res.json(await service.status()));
  router.get('/bridge/events', async (req, res) => res.json(await service.events(typeof req.query.mission_id === 'string' ? req.query.mission_id : undefined)));
  router.post('/bridge/restart', async (_req, res) => { await service.restart(); res.json(await service.status()); });
  router.post('/bridge/demo', (_req, res) => res.status(410).json({ code: 'PRACTICE_REMOVED', message: 'Simulated detections are disabled in this version.' }));
  router.get('/bridge/images/:id', async (req, res) => {
    const file = await service.imageFile(req.params.id);
    if (!file) return res.status(404).json({ code: 'IMAGE_NOT_AVAILABLE', message: 'Image not ready. Check its image status in Firebase & telemetry.' });
    res.setHeader('Cache-Control', 'private, no-store');
    // imageFile has already constrained the real path and raster extension.
    // Test sessions live under .runtime, so Express's default dotfile rejection
    // would otherwise reject the entire parent path.
    res.sendFile(file, { dotfiles: 'allow' });
  });
  return router;
}
module.exports = { createBridgeRouter };
