'use strict';

// Load .env variables into process.env as early as possible.
// In production (NODE_ENV=production) these come from the host environment
// instead, but dotenv.config() is a no-op if the file is missing, so this
// is always safe to call.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const solarSavingsRouter = require('./routes/solarSavings');

// ─── CORS configuration ───────────────────────────────────────────────────────
// CORS_ORIGIN accepts a comma-separated list of allowed origins, e.g.:
//   CORS_ORIGIN=http://localhost:4321,https://mysolar.app
//
// In development with no env var set we allow everything (*) so you can
// test from any tool (Postman, Bruno, etc.) without friction.
const RAW_ORIGINS = process.env.CORS_ORIGIN || '';

const corsOptions = (() => {
  if (!RAW_ORIGINS.trim()) {
    // No restriction — allow all origins (development convenience)
    return { origin: '*' };
  }

  const allowedOrigins = RAW_ORIGINS
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    origin(requestOrigin, callback) {
      // Allow server-to-server requests (no Origin header) and listed origins
      if (!requestOrigin || allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
      } else {
        callback(
          new Error(
            `CORS: origin "${requestOrigin}" is not allowed. ` +
              `Allowed: ${allowedOrigins.join(', ')}`
          )
        );
      }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  };
})();

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and configure the Express application.
 *
 * Exported as a factory so server.js can call `app.listen()` and the test
 * suite can import the same app without binding a TCP port.
 *
 * @returns {import('express').Application}
 */
function createApp() {
  const app = express();

  // ── Global middleware ───────────────────────────────────────────────────────
  app.use(cors(corsOptions));
  app.options('/{*path}', cors(corsOptions)); // pre-flight for all routes (Express 5 syntax)
  app.use(express.json());

  // ── Routes ─────────────────────────────────────────────────────────────────
  app.use('/api/calculate-solar-savings', solarSavingsRouter);

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development',
    });
  });

  // ── 404 catch-all ───────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Route not found.' });
  });

  return app;
}

module.exports = { createApp };
