'use strict';

/**
 * server.js — Entry point
 *
 * createApp() calls require('dotenv').config() before anything else, so
 * process.env is fully populated by the time we read PORT here.
 */
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '* (all origins)';

const app = createApp();

app.listen(PORT, () => {
  console.log(`\n✅  Solar Savings backend`);
  console.log(`   Listening  → http://localhost:${PORT}`);
  console.log(`   CORS allow → ${CORS_ORIGIN}`);
  console.log(`   POST /api/calculate-solar-savings`);
  console.log(`   GET  /health\n`);
});
