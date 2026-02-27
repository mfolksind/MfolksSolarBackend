'use strict';

const path = require('path');
const fs = require('fs');

// ─── Assumed connected load (kW) used for fixed-charge calculation ────────────
// Residential tariffs in India typically assume a standard 5 kW sanctioned load
// for computing the monthly fixed charge.
const ASSUMED_CONNECTED_LOAD_KW = 5;

/**
 * Compute the number of units a slab covers.
 *
 * Indian tariff convention:
 *   { min_units: 0,   max_units: 150 } → 150 units  ("first 150 units")
 *   { min_units: 151, max_units: 300 } → 150 units  ("next 150 units")
 *   { min_units: 301, max_units: 99999 } → very large (open-ended top slab)
 *
 * Formula: max - min when min > 0 (avoids the off-by-one for the first slab)
 *          max when min === 0
 *
 * @param {{ min_units: number, max_units: number }} slab
 * @returns {number}
 */
function slabCapacity(slab) {
  return slab.min_units === 0
    ? slab.max_units
    : slab.max_units - slab.min_units + 1;
}

// ─── Load the JSON file once at module startup (synchronous, small file) ──────
const TARIFF_FILE = path.join(__dirname, '..', 'data', 'tariffs.json');
let _tariffs; // lazy-loaded cache

/**
 * Load and return the tariff array from the JSON file.
 * Caches the result in module scope after first load.
 *
 * @returns {Array} Raw tariff array
 */
function loadTariffs() {
  if (!_tariffs) {
    try {
      const raw = fs.readFileSync(TARIFF_FILE, 'utf8');
      _tariffs = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to load tariffs.json: ${err.message}`);
    }
  }
  return _tariffs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the tariff document that matches a given state + category pair.
 *
 * @param {string} state    - e.g. "Madhya Pradesh"
 * @param {string} category - "residential" | "commercial" | "industrial"
 * @returns {{ state, category, fixed_charge_per_kw, slabs }}
 * @throws {Error} if no matching tariff is found
 */
function getTariff(state, category) {
  const tariffs = loadTariffs();

  const match = tariffs.find(
    (t) =>
      t.state.toLowerCase().trim() === state.toLowerCase().trim() &&
      t.category.toLowerCase().trim() === category.toLowerCase().trim()
  );

  if (!match) {
    const available = [...new Set(tariffs.map((t) => t.state))].join(', ');
    throw new Error(
      `No tariff found for state="${state}", category="${category}". ` +
        `Available states: ${available}`
    );
  }

  return match;
}

/**
 * Calculate the fixed component of the monthly electricity bill.
 *
 * @param {object} tariff - Tariff document from getTariff()
 * @returns {number} Fixed charge in ₹
 */
function calcFixedCharge(tariff) {
  return tariff.fixed_charge_per_kw * ASSUMED_CONNECTED_LOAD_KW;
}

/**
 * STEP A — Reverse-engineer monthly unit consumption from a bill amount.
 *
 * Algorithm:
 *  1. Subtract fixed charges from the total bill to isolate the energy charge.
 *  2. Walk through each telescopic slab in order:
 *       a. Calculate the maximum cost that this slab can contribute.
 *       b. If remaining energy charge >= slab max cost → consume all units in
 *          that slab and subtract; move to next slab.
 *       c. Otherwise → the remaining charge falls within this slab; compute
 *          fractional units and stop.
 *
 * @param {number} currentMonthlyBill - Total bill in ₹ (including fixed charge)
 * @param {object} tariff             - Tariff document from getTariff()
 * @returns {number} Estimated monthly consumption in kWh (rounded to 2 dp)
 */
function reverseCalculateUnits(currentMonthlyBill, tariff) {
  const fixedCharge = calcFixedCharge(tariff);
  let energyCharge = currentMonthlyBill - fixedCharge;

  // Guard: if the bill is entirely covered by the fixed charge
  if (energyCharge <= 0) {
    return 0;
  }

  let totalUnits = 0;

  for (const slab of tariff.slabs) {
    const slabCapacityUnits = slabCapacity(slab);
    const slabMaxCost = slabCapacityUnits * slab.rate_per_unit;

    if (slab.rate_per_unit === 0) {
      // Free slab — consume all units without depleting energy charge
      totalUnits += slabCapacityUnits;

      // If this is the last slab and it's free, just return what we have
      if (slab.max_units >= 99999) break;
      continue;
    }

    if (energyCharge >= slabMaxCost) {
      // This slab is fully consumed
      totalUnits += slabCapacityUnits;
      energyCharge -= slabMaxCost;
    } else {
      // This slab partially covers the remaining energy charge
      const partialUnits = energyCharge / slab.rate_per_unit;
      totalUnits += partialUnits;
      energyCharge = 0;
      break;
    }

    // Remaining energy charge fully consumed
    if (energyCharge <= 0) break;
  }

  return parseFloat(totalUnits.toFixed(2));
}

/**
 * STEP B — Forward-calculate a monthly electricity bill from unit consumption.
 *
 * Algorithm:
 *  1. Add the fixed charge component.
 *  2. Walk through each telescopic slab:
 *       a. If remaining units exceed this slab → charge the whole slab capacity.
 *       b. Otherwise → charge just the remaining units at this slab's rate.
 *
 * @param {number} units  - Monthly consumption in kWh
 * @param {object} tariff - Tariff document from getTariff()
 * @returns {number} Total monthly bill in ₹ (rounded to 2 dp)
 */
function forwardCalculateBill(units, tariff) {
  if (units <= 0) {
    // Even at 0 units the fixed charge still applies
    return parseFloat(calcFixedCharge(tariff).toFixed(2));
  }

  let remaining = units;
  let energyCharge = 0;

  for (const slab of tariff.slabs) {
    if (remaining <= 0) break;

    const slabCapacityUnits = slabCapacity(slab);
    const unitsInThisSlab = Math.min(remaining, slabCapacityUnits);

    energyCharge += unitsInThisSlab * slab.rate_per_unit;
    remaining -= unitsInThisSlab;
  }

  const totalBill = calcFixedCharge(tariff) + energyCharge;
  return parseFloat(totalBill.toFixed(2));
}

module.exports = {
  getTariff,
  reverseCalculateUnits,
  forwardCalculateBill,
  calcFixedCharge,
  ASSUMED_CONNECTED_LOAD_KW,
};
