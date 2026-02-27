'use strict';

/**
 * server.js — Entry point
 *
 * Imports the configured Express app and binds it to a TCP port.
 * All business logic lives in app.js and its dependencies.
 */
const { createApp } = require('./app');

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`✅  Solar Savings backend running → http://localhost:${PORT}`);
  console.log(`   POST /api/calculate-solar-savings`);
  console.log(`   GET  /health`);
});
