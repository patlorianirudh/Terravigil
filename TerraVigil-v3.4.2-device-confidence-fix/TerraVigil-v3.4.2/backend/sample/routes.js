'use strict';
const express = require('express');
const { dispatchSample } = require('./service');

// The live API reads the virtual sample without inserting it into MongoDB.
function createSampleRouter() {
  const router = express.Router();
  router.use((req, res, next) => {
    try {
      const result = dispatchSample(req.method, req.url, req.body);
      if (!result) return next();
      return res.status(result.status).json(result.body);
    } catch (error) { return next(error); }
  });
  return router;
}
module.exports = { createSampleRouter };
