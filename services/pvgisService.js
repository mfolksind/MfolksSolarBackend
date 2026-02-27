'use strict';

const axios = require('axios');

// ─── PVGIS endpoint ───────────────────────────────────────────────────────────
// EU Joint Research Centre — free, no API key required.
// Documentation: https://re.jrc.ec.europa.eu/pvg_tools/en/#api_5.2
const PVGIS_BASE_URL = 'https://re.jrc.ec.europa.eu/api/v5_2/PVcalc';

// System loss factor (%) — 14% is the standard recommended value
const SYSTEM_LOSS_PERCENT = 14;

// Timeout for the external HTTP call (ms)
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * @typedef {Object} PVGISResult
 * @property {number} annual_generation_kwh   - Total yearly AC energy output (kWh)
 * @property {number} monthly_generation_kwh  - Average monthly AC output (kWh)
 * @property {number} optimal_tilt_angle      - Optimum panel tilt angle (degrees)
 * @property {number} optimal_azimuth_angle   - Optimum panel azimuth angle (degrees)
 */

/**
 * Call the PVGIS PVcalc endpoint and extract generation and geometry data.
 *
 * PVGIS response path reference:
 *  - Annual generation : outputs.totals.fixed.E_y
 *  - Tilt angle        : inputs.mounting_system.fixed.slope.value
 *  - Azimuth angle     : inputs.mounting_system.fixed.azimuth.value
 *
 * @param {number} lat         - Latitude  (decimal degrees, -90 to 90)
 * @param {number} lon         - Longitude (decimal degrees, -180 to 180)
 * @param {number} capacityKw  - Peak power of the PV system (kWp)
 * @returns {Promise<PVGISResult>}
 * @throws {Error} on network failure, timeout, or unexpected response shape
 */
async function fetchPVGISData(lat, lon, capacityKw) {
  const params = {
    lat,
    lon,
    peakpower: capacityKw,
    loss: SYSTEM_LOSS_PERCENT,
    optimumangles: 1,       // Let PVGIS compute the optimal tilt & azimuth
    outputformat: 'json',
  };

  let response;
  try {
    response = await axios.get(PVGIS_BASE_URL, {
      params,
      timeout: REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      throw new Error(
        `PVGIS API timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Please try again.`
      );
    }
    // Axios wraps HTTP error responses inside err.response
    const status = err.response?.status ?? 'unknown';
    const detail = err.response?.data?.message ?? err.message;
    throw new Error(`PVGIS API request failed (HTTP ${status}): ${detail}`);
  }

  // ── Extract values from the nested PVGIS JSON ──────────────────────────────
  try {
    const data = response.data;

    const annualGenerationKwh = data.outputs?.totals?.fixed?.E_y;
    const tiltAngle           = data.inputs?.mounting_system?.fixed?.slope?.value;
    const azimuthAngle        = data.inputs?.mounting_system?.fixed?.azimuth?.value;

    if (annualGenerationKwh === undefined || annualGenerationKwh === null) {
      throw new Error('Missing field: outputs.totals.fixed.E_y');
    }
    if (tiltAngle === undefined || tiltAngle === null) {
      throw new Error('Missing field: inputs.mounting_system.fixed.slope.value');
    }
    if (azimuthAngle === undefined || azimuthAngle === null) {
      throw new Error('Missing field: inputs.mounting_system.fixed.azimuth.value');
    }

    const monthlyGenerationKwh = annualGenerationKwh / 12;

    return {
      annual_generation_kwh:  parseFloat(annualGenerationKwh.toFixed(2)),
      monthly_generation_kwh: parseFloat(monthlyGenerationKwh.toFixed(2)),
      optimal_tilt_angle:     parseFloat(tiltAngle.toFixed(1)),
      optimal_azimuth_angle:  parseFloat(azimuthAngle.toFixed(1)),
    };
  } catch (extractErr) {
    throw new Error(
      `Unexpected PVGIS response structure: ${extractErr.message}`
    );
  }
}

module.exports = { fetchPVGISData, PVGIS_BASE_URL };
