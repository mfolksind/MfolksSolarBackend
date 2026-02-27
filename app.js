'use strict';

const express = require('express');
const cors = require('cors');
const solarSavingsRouter = require('./routes/solarSavings');

/**
 * Create and configure the Express application.
 *
 * Exported as a factory so server.js can call app.listen()
 * and tests can import the same app without binding a port.
 *
 * @returns {import('express').Application}
 */
function createApp() {
  const app = express();

  // ── Global middleware ─────────────────────────────────────────────────────
  app.use(cors());
  app.use(express.json());

  // ── Routes ───────────────────────────────────────────────────────────────
  app.use('/api/calculate-solar-savings', solarSavingsRouter);

  // ── Health check ─────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Route not found.' });
  });

  return app;
}

module.exports = { createApp };
