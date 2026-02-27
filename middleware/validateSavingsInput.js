'use strict';

const VALID_CATEGORIES = ['residential', 'commercial', 'industrial'];

/**
 * Express middleware that validates the JSON body for POST /api/calculate-solar-savings.
 *
 * Required fields
 * ───────────────
 * • lat                  — number, -90 to 90
 * • lon                  — number, -180 to 180
 * • capacity_kw          — number, > 0
 * • current_monthly_bill — number, > 0  (₹)
 * • state                — non-empty string
 * • category             — "residential" | "commercial" | "industrial"
 *
 * On success, attaches `req.validatedInput` with coerced values and calls next().
 * On failure, responds immediately with HTTP 400.
 */
function validateSavingsInput(req, res, next) {
  const { lat, lon, capacity_kw, current_monthly_bill, state, category } = req.body;

  // ── Presence checks ─────────────────────────────────────────────────────────
  const missing = [];
  if (lat               === undefined || lat               === null) missing.push('lat');
  if (lon               === undefined || lon               === null) missing.push('lon');
  if (capacity_kw       === undefined || capacity_kw       === null) missing.push('capacity_kw');
  if (current_monthly_bill === undefined || current_monthly_bill === null) missing.push('current_monthly_bill');
  if (!state || String(state).trim() === '')    missing.push('state');
  if (!category || String(category).trim() === '') missing.push('category');

  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Missing required field(s): ${missing.join(', ')}.`,
    });
  }

  // ── Type & range checks ─────────────────────────────────────────────────────
  const latNum = parseFloat(lat);
  if (isNaN(latNum) || latNum < -90 || latNum > 90) {
    return res.status(400).json({
      success: false,
      error: '`lat` must be a number between -90 and 90.',
    });
  }

  const lonNum = parseFloat(lon);
  if (isNaN(lonNum) || lonNum < -180 || lonNum > 180) {
    return res.status(400).json({
      success: false,
      error: '`lon` must be a number between -180 and 180.',
    });
  }

  const capacityNum = parseFloat(capacity_kw);
  if (isNaN(capacityNum) || capacityNum <= 0) {
    return res.status(400).json({
      success: false,
      error: '`capacity_kw` must be a positive number.',
    });
  }

  const billNum = parseFloat(current_monthly_bill);
  if (isNaN(billNum) || billNum <= 0) {
    return res.status(400).json({
      success: false,
      error: '`current_monthly_bill` must be a positive number (₹).',
    });
  }

  const categoryNorm = String(category).toLowerCase().trim();
  if (!VALID_CATEGORIES.includes(categoryNorm)) {
    return res.status(400).json({
      success: false,
      error: `\`category\` must be one of: ${VALID_CATEGORIES.join(', ')}.`,
    });
  }

  // ── Attach coerced, validated values ────────────────────────────────────────
  req.validatedInput = {
    lat:                latNum,
    lon:                lonNum,
    capacityKw:         capacityNum,
    currentMonthlyBill: billNum,
    state:              String(state).trim(),
    category:           categoryNorm,
  };

  next();
}

module.exports = { validateSavingsInput, VALID_CATEGORIES };
