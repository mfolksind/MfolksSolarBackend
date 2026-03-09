'use strict';

const { Router } = require('express');
const { validateSavingsInput } = require('../middleware/validateSavingsInput');
const { getTariff, reverseCalculateUnits, forwardCalculateBill } = require('../services/tariffService');
const { fetchPVGISData } = require('../services/pvgisService');

const router = Router();

/**
 * POST /api/calculate-solar-savings
 *
 * Full pipeline
 * ─────────────
 *  1. Validate input  (middleware)
 *  2. Load state + category tariff from JSON file
 *  3. Step A — Reverse-engineer current monthly consumption (kWh) from bill
 *  4. Call PVGIS API for real solar generation data
 *  5. Step B — Calculate net consumption after solar, compute new bill & savings
 *  6. Return enriched JSON payload
 */
router.post('/', validateSavingsInput, async (req, res) => {
  const { lat, lon, capacityKw, currentMonthlyBill, state, category } =
    req.validatedInput;

  try {
    // ── Step 2: Fetch tariff from JSON "database" ──────────────────────────────
    let tariff;
    try {
      tariff = getTariff(state, category);
    } catch (tariffErr) {
      // Return 404 for missing state/category combos — not a server error
      return res.status(404).json({ success: false, error: tariffErr.message });
    }

    console.log(
      `[savings] Tariff loaded: ${state} / ${category} ` +
        `(fixed: ₹${tariff.fixed_charge_per_kw}/kW, slabs: ${tariff.slabs.length})`
    );

    // ── Step 3: Reverse-engineer current consumption ───────────────────────────
    const currentMonthlyUnits = reverseCalculateUnits(currentMonthlyBill, tariff);

    console.log(
      `[savings] Bill ₹${currentMonthlyBill} → ` +
        `estimated consumption: ${currentMonthlyUnits} kWh/month`
    );

    // ── Step 4: Fetch PVGIS solar generation data ──────────────────────────────
    const pvgis = await fetchPVGISData(lat, lon, capacityKw);

    console.log(
      `[savings] PVGIS → monthly gen: ${pvgis.monthly_generation_kwh} kWh, ` +
        `tilt: ${pvgis.optimal_tilt_angle}°, azimuth: ${pvgis.optimal_azimuth_angle}°`
    );

    // ── Step 5: Financial calculations ────────────────────────────────────────
    // Net units remaining on the grid after solar covers part of consumption.
    // MVP rule: if solar fully covers consumption, net = 0 (no export credit).
    const netMonthlyUnits = Math.max(
      0,
      currentMonthlyUnits - pvgis.monthly_generation_kwh
    );

    const newMonthlyBill  = forwardCalculateBill(netMonthlyUnits, tariff);
    const monthlySavings  = parseFloat((currentMonthlyBill - newMonthlyBill).toFixed(2));
    const yearlySavings   = parseFloat((monthlySavings * 12).toFixed(2));

    console.log(
      `[savings] Net units: ${netMonthlyUnits.toFixed(2)} kWh | ` +
        `New bill: ₹${newMonthlyBill} | Monthly savings: ₹${monthlySavings}`
    );

    // ── Step 6: Return response ────────────────────────────────────────────────
    const responseData = {
      success: true,

      // Financial summary
      monthly_savings_rs:  monthlySavings,
      yearly_savings_rs:   yearlySavings,
      new_monthly_bill_rs: newMonthlyBill,

      // Solar generation
      solar_generation_monthly_kwh: pvgis.monthly_generation_kwh,
      solar_generation_annual_kwh:  pvgis.annual_generation_kwh,

      // System geometry
      optimal_tilt_angle:    pvgis.optimal_tilt_angle,
      optimal_azimuth_angle: pvgis.optimal_azimuth_angle,

      // Context (useful for the frontend)
      current_monthly_units_kwh: currentMonthlyUnits,
      net_monthly_units_kwh:     parseFloat(netMonthlyUnits.toFixed(2)),
      tariff_state:    tariff.state,
      tariff_category: tariff.category,
    };

    console.log('[savings] Final JSON response payload:', responseData);

    return res.status(200).json(responseData);
  } catch (err) {
    console.error('[savings] Unhandled error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
