'use strict';

/**
 * tests/solarSavings.test.js
 *
 * Test suite for the Solar Savings Calculator backend.
 *
 * Sections
 * ────────
 *   1. Unit — tariffService (pure financial math, no I/O)
 *   2. Unit — validateSavingsInput middleware
 *   3. Integration — POST /api/calculate-solar-savings  (PVGIS mocked)
 *
 * Run: npm test
 */

const request = require('supertest');

// ─── Module under test ────────────────────────────────────────────────────────
const {
  getTariff,
  reverseCalculateUnits,
  forwardCalculateBill,
  calcFixedCharge,
  ASSUMED_CONNECTED_LOAD_KW,
} = require('../services/tariffService');

const { validateSavingsInput } = require('../middleware/validateSavingsInput');
const { createApp } = require('../app');

// ─── Mock PVGIS so tests never hit the network ────────────────────────────────
jest.mock('../services/pvgisService', () => ({
  fetchPVGISData: jest.fn(),
  PVGIS_BASE_URL: 'https://re.jrc.ec.europa.eu/api/v5_2/PVcalc',
}));
const { fetchPVGISData } = require('../services/pvgisService');

// ─── Shared test fixtures ─────────────────────────────────────────────────────
const MP_RESIDENTIAL = {
  state: 'Madhya Pradesh',
  category: 'residential',
  fixed_charge_per_kw: 150,
  slabs: [
    { min_units: 0,   max_units: 150,   rate_per_unit: 5.05 },
    { min_units: 151, max_units: 300,   rate_per_unit: 5.80 },
    { min_units: 301, max_units: 99999, rate_per_unit: 6.70 },
  ],
};

const MOCK_PVGIS = {
  annual_generation_kwh:  1800,
  monthly_generation_kwh: 150,
  optimal_tilt_angle:     23.5,
  optimal_azimuth_angle:  180,
};

const VALID_BODY = {
  lat: 23.2,
  lon: 77.4,
  capacity_kw: 5,
  current_monthly_bill: 2000,
  state: 'Madhya Pradesh',
  category: 'residential',
};

// ══════════════════════════════════════════════════════════════════════════════
// 1. UNIT TESTS — tariffService
// ══════════════════════════════════════════════════════════════════════════════
describe('tariffService', () => {

  // ── getTariff ────────────────────────────────────────────────────────────
  describe('getTariff()', () => {
    test('returns the correct tariff for MP residential', () => {
      const t = getTariff('Madhya Pradesh', 'residential');
      expect(t.state).toBe('Madhya Pradesh');
      expect(t.category).toBe('residential');
      expect(t.slabs).toHaveLength(3);
    });

    test('is case-insensitive for state and category', () => {
      const t = getTariff('madhya pradesh', 'RESIDENTIAL');
      expect(t.state).toBe('Madhya Pradesh');
    });

    test('returns correct tariff for Maharashtra commercial', () => {
      const t = getTariff('Maharashtra', 'commercial');
      expect(t.category).toBe('commercial');
      expect(t.slabs.length).toBeGreaterThan(0);
    });

    test('throws for an unknown state', () => {
      expect(() => getTariff('Atlantis', 'residential')).toThrow(/No tariff found/i);
    });

    test('throws for a known state but unknown category', () => {
      expect(() => getTariff('Madhya Pradesh', 'agricultural')).toThrow(/No tariff found/i);
    });

    test('error message lists available states', () => {
      try {
        getTariff('Unknown State', 'residential');
      } catch (e) {
        expect(e.message).toMatch(/Available states/i);
      }
    });
  });

  // ── calcFixedCharge ──────────────────────────────────────────────────────
  describe('calcFixedCharge()', () => {
    test('returns fixed_charge_per_kw × ASSUMED_CONNECTED_LOAD_KW', () => {
      const charge = calcFixedCharge(MP_RESIDENTIAL);
      expect(charge).toBe(150 * ASSUMED_CONNECTED_LOAD_KW); // 750
    });

    test('ASSUMED_CONNECTED_LOAD_KW is 5', () => {
      expect(ASSUMED_CONNECTED_LOAD_KW).toBe(5);
    });
  });

  // ── reverseCalculateUnits ────────────────────────────────────────────────
  describe('reverseCalculateUnits()', () => {
    test('returns 0 when bill equals or is less than fixed charge', () => {
      const fixedOnly = calcFixedCharge(MP_RESIDENTIAL); // 750
      expect(reverseCalculateUnits(fixedOnly, MP_RESIDENTIAL)).toBe(0);
      expect(reverseCalculateUnits(fixedOnly - 100, MP_RESIDENTIAL)).toBe(0);
    });

    test('correctly reverse-calculates units in slab 1 (0-150)', () => {
      // 100 units × 5.05 = 505 energy + 750 fixed = 1255
      const bill = 750 + 100 * 5.05;
      const units = reverseCalculateUnits(bill, MP_RESIDENTIAL);
      expect(units).toBeCloseTo(100, 1);
    });

    test('correctly handles consumption exactly at slab 1 boundary (150 units)', () => {
      // 150 × 5.05 + 750 fixed = 757.5 + 750 = 1507.5
      const bill = 750 + 150 * 5.05;
      const units = reverseCalculateUnits(bill, MP_RESIDENTIAL);
      expect(units).toBeCloseTo(150, 1);
    });

    test('correctly reverse-calculates units spanning slab 1 + slab 2', () => {
      // 200 units: 150 × 5.05 + 50 × 5.80 + 750 = 757.5 + 290 + 750 = 1797.5
      const bill = 750 + 150 * 5.05 + 50 * 5.80;
      const units = reverseCalculateUnits(bill, MP_RESIDENTIAL);
      expect(units).toBeCloseTo(200, 1);
    });

    test('correctly reverse-calculates units spanning all 3 slabs', () => {
      // 350 units: 150×5.05 + 150×5.80 + 50×6.70 + 750 = 757.5+870+335+750 = 2712.5
      const bill = 750 + 150 * 5.05 + 150 * 5.80 + 50 * 6.70;
      const units = reverseCalculateUnits(bill, MP_RESIDENTIAL);
      expect(units).toBeCloseTo(350, 1);
    });
  });

  // ── forwardCalculateBill ─────────────────────────────────────────────────
  describe('forwardCalculateBill()', () => {
    test('returns only fixed charge when units = 0', () => {
      const bill = forwardCalculateBill(0, MP_RESIDENTIAL);
      expect(bill).toBe(750); // 150 × 5 fixed
    });

    test('correctly calculates bill for slab 1 consumption', () => {
      // 100 units × 5.05 + 750 = 1255
      const bill = forwardCalculateBill(100, MP_RESIDENTIAL);
      expect(bill).toBeCloseTo(1255, 2);
    });

    test('correctly calculates bill spanning slabs 1 and 2', () => {
      // 200 units: 150×5.05 + 50×5.80 + 750 = 757.5 + 290 + 750 = 1797.5
      const bill = forwardCalculateBill(200, MP_RESIDENTIAL);
      expect(bill).toBeCloseTo(1797.5, 2);
    });

    test('correctly calculates bill spanning all 3 slabs', () => {
      // 350 units: 150×5.05 + 150×5.80 + 50×6.70 + 750 = 2712.5
      const bill = forwardCalculateBill(350, MP_RESIDENTIAL);
      expect(bill).toBeCloseTo(2712.5, 2);
    });

    test('round-trip: forwardCalculateBill(reverseCalculateUnits(bill)) ≈ bill', () => {
      [1200, 1800, 2500, 3500, 5000].forEach((originalBill) => {
        const units = reverseCalculateUnits(originalBill, MP_RESIDENTIAL);
        const recoveredBill = forwardCalculateBill(units, MP_RESIDENTIAL);
        // Allow ₹1 tolerance for floating-point rounding
        expect(Math.abs(recoveredBill - originalBill)).toBeLessThan(1);
      });
    });

    test('handles negative units gracefully (returns fixed charge)', () => {
      const bill = forwardCalculateBill(-50, MP_RESIDENTIAL);
      expect(bill).toBe(750);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. UNIT TESTS — validateSavingsInput middleware
// ══════════════════════════════════════════════════════════════════════════════
describe('validateSavingsInput middleware', () => {
  function runMiddleware(body) {
    const req = { body };
    const res = {
      _status: null,
      _json: null,
      status(code) { this._status = code; return this; },
      json(data)   { this._json = data;  return this; },
    };
    const next = jest.fn();
    validateSavingsInput(req, res, next);
    return { req, res, next };
  }

  test('calls next() for a fully valid payload', () => {
    const { next, req } = runMiddleware(VALID_BODY);
    expect(next).toHaveBeenCalled();
    expect(req.validatedInput).toMatchObject({
      lat: 23.2,
      lon: 77.4,
      capacityKw: 5,
      currentMonthlyBill: 2000,
      state: 'Madhya Pradesh',
      category: 'residential',
    });
  });

  test('normalises category to lowercase', () => {
    const { next, req } = runMiddleware({ ...VALID_BODY, category: 'COMMERCIAL' });
    expect(next).toHaveBeenCalled();
    expect(req.validatedInput.category).toBe('commercial');
  });

  test('coerces numeric string fields', () => {
    const { next, req } = runMiddleware({
      ...VALID_BODY,
      lat: '23.2',
      lon: '77.4',
      capacity_kw: '5',
      current_monthly_bill: '2000',
    });
    expect(next).toHaveBeenCalled();
    expect(typeof req.validatedInput.lat).toBe('number');
  });

  // ── Presence ───────────────────────────────────────────────────────────────
  ['lat', 'lon', 'capacity_kw', 'current_monthly_bill', 'state', 'category'].forEach(
    (field) => {
      test(`rejects missing ${field} with 400`, () => {
        const body = { ...VALID_BODY };
        delete body[field];
        const { res, next } = runMiddleware(body);
        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(400);
        expect(res._json.success).toBe(false);
        expect(res._json.error).toMatch(new RegExp(field, 'i'));
      });
    }
  );

  // ── Range checks ───────────────────────────────────────────────────────────
  test('rejects lat > 90', () => {
    const { res } = runMiddleware({ ...VALID_BODY, lat: 91 });
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/lat/i);
  });

  test('rejects lat < -90', () => {
    const { res } = runMiddleware({ ...VALID_BODY, lat: -91 });
    expect(res._status).toBe(400);
  });

  test('rejects lon > 180', () => {
    const { res } = runMiddleware({ ...VALID_BODY, lon: 181 });
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/lon/i);
  });

  test('rejects lon < -180', () => {
    const { res } = runMiddleware({ ...VALID_BODY, lon: -181 });
    expect(res._status).toBe(400);
  });

  test('rejects capacity_kw = 0', () => {
    const { res } = runMiddleware({ ...VALID_BODY, capacity_kw: 0 });
    expect(res._status).toBe(400);
  });

  test('rejects negative capacity_kw', () => {
    const { res } = runMiddleware({ ...VALID_BODY, capacity_kw: -1 });
    expect(res._status).toBe(400);
  });

  test('rejects current_monthly_bill = 0', () => {
    const { res } = runMiddleware({ ...VALID_BODY, current_monthly_bill: 0 });
    expect(res._status).toBe(400);
  });

  test('rejects negative current_monthly_bill', () => {
    const { res } = runMiddleware({ ...VALID_BODY, current_monthly_bill: -500 });
    expect(res._status).toBe(400);
  });

  test('rejects invalid category "agricultural"', () => {
    const { res } = runMiddleware({ ...VALID_BODY, category: 'agricultural' });
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/category/i);
  });

  test('accepts boundary lat=90, lon=180', () => {
    const { next } = runMiddleware({ ...VALID_BODY, lat: 90, lon: 180 });
    expect(next).toHaveBeenCalled();
  });

  test('rejects empty body', () => {
    const { res } = runMiddleware({});
    expect(res._status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. INTEGRATION TESTS — POST /api/calculate-solar-savings
//    PVGIS is mocked via jest.mock — no network calls.
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/calculate-solar-savings', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Success path ───────────────────────────────────────────────────────────
  describe('success path', () => {
    beforeEach(() => {
      fetchPVGISData.mockResolvedValue(MOCK_PVGIS);
    });

    test('returns HTTP 200', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.status).toBe(200);
    });

    test('response has success: true', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.body.success).toBe(true);
    });

    test('response contains all required financial fields', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      const required = [
        'monthly_savings_rs',
        'yearly_savings_rs',
        'new_monthly_bill_rs',
        'solar_generation_monthly_kwh',
        'optimal_tilt_angle',
        'optimal_azimuth_angle',
      ];
      required.forEach((key) => expect(res.body).toHaveProperty(key));
    });

    test('yearly_savings_rs = monthly_savings_rs × 12', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.body.yearly_savings_rs).toBeCloseTo(
        res.body.monthly_savings_rs * 12,
        1
      );
    });

    test('new_monthly_bill_rs is less than current_monthly_bill', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.body.new_monthly_bill_rs).toBeLessThan(VALID_BODY.current_monthly_bill);
    });

    test('monthly_savings_rs is positive', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.body.monthly_savings_rs).toBeGreaterThan(0);
    });

    test('solar_generation_monthly_kwh matches PVGIS mock', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.body.solar_generation_monthly_kwh).toBe(
        MOCK_PVGIS.monthly_generation_kwh
      );
    });

    test('optimal_tilt_angle matches PVGIS mock', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.body.optimal_tilt_angle).toBe(MOCK_PVGIS.optimal_tilt_angle);
    });

    test('optimal_azimuth_angle matches PVGIS mock', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.body.optimal_azimuth_angle).toBe(MOCK_PVGIS.optimal_azimuth_angle);
    });

    test('calls fetchPVGISData with the correct arguments', async () => {
      await request(app).post('/api/calculate-solar-savings').send(VALID_BODY);
      expect(fetchPVGISData).toHaveBeenCalledTimes(1);
      expect(fetchPVGISData).toHaveBeenCalledWith(
        VALID_BODY.lat,
        VALID_BODY.lon,
        VALID_BODY.capacity_kw
      );
    });

    test('new_monthly_bill_rs >= 0', async () => {
      // Even if solar fully covers consumption the bill cannot go negative
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.body.new_monthly_bill_rs).toBeGreaterThanOrEqual(0);
    });

    test('works when solar generation fully covers consumption (net = 0)', async () => {
      // Only ₹800 bill → ~10 kWh consumption; mock generates 500 kWh/month
      fetchPVGISData.mockResolvedValue({ ...MOCK_PVGIS, monthly_generation_kwh: 500 });
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send({ ...VALID_BODY, current_monthly_bill: 800 });
      expect(res.status).toBe(200);
      // net_monthly_units should be 0
      expect(res.body.net_monthly_units_kwh).toBe(0);
      // Bill should be just the fixed charge
      expect(res.body.new_monthly_bill_rs).toBe(calcFixedCharge(MP_RESIDENTIAL));
    });

    test('works for Maharashtra commercial tariff', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send({
          ...VALID_BODY,
          state: 'Maharashtra',
          category: 'commercial',
          current_monthly_bill: 10000,
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('works for Delhi residential tariff', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send({
          ...VALID_BODY,
          lat: 28.6,
          lon: 77.2,
          state: 'Delhi',
          category: 'residential',
          current_monthly_bill: 3500,
        });
      expect(res.status).toBe(200);
    });

    test('accepts string-coerced numeric fields', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send({
          lat: '23.2',
          lon: '77.4',
          capacity_kw: '5',
          current_monthly_bill: '2000',
          state: 'Madhya Pradesh',
          category: 'residential',
        });
      expect(res.status).toBe(200);
    });
  });

  // ── Validation failures (400) ──────────────────────────────────────────────
  describe('validation failures → HTTP 400', () => {
    const requiredFields = [
      'lat', 'lon', 'capacity_kw', 'current_monthly_bill', 'state', 'category',
    ];
    requiredFields.forEach((field) => {
      test(`missing ${field} → 400`, async () => {
        const body = { ...VALID_BODY };
        delete body[field];
        const res = await request(app)
          .post('/api/calculate-solar-savings')
          .send(body);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    test('invalid category → 400', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send({ ...VALID_BODY, category: 'agricultural' });
      expect(res.status).toBe(400);
    });

    test('empty body → 400', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send({});
      expect(res.status).toBe(400);
    });

    test('does NOT call fetchPVGISData when validation fails', async () => {
      await request(app)
        .post('/api/calculate-solar-savings')
        .send({ ...VALID_BODY, lat: 999 });
      expect(fetchPVGISData).not.toHaveBeenCalled();
    });
  });

  // ── Tariff not found (404) ─────────────────────────────────────────────────
  describe('tariff not found → HTTP 404', () => {
    test('unknown state → 404', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send({ ...VALID_BODY, state: 'Atlantis' });
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('valid state + unsupported category → 404', async () => {
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send({ ...VALID_BODY, category: 'industrial', state: 'Unknown State' });
      expect(res.status).toBe(404);
    });
  });

  // ── PVGIS failure path (500) ───────────────────────────────────────────────
  describe('PVGIS errors → HTTP 500', () => {
    test('network timeout → 500', async () => {
      fetchPVGISData.mockRejectedValue(
        new Error('PVGIS API timed out after 15s. Please try again.')
      );
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/timed out/i);
    });

    test('malformed PVGIS response → 500', async () => {
      fetchPVGISData.mockRejectedValue(
        new Error('Unexpected PVGIS response structure: Missing field: outputs.totals.fixed.E_y')
      );
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    test('generic PVGIS HTTP error → 500', async () => {
      fetchPVGISData.mockRejectedValue(
        new Error('PVGIS API request failed (HTTP 503): Service Unavailable')
      );
      const res = await request(app)
        .post('/api/calculate-solar-savings')
        .send(VALID_BODY);
      expect(res.status).toBe(500);
    });
  });

  // ── Health check ──────────────────────────────────────────────────────────
  describe('GET /health', () => {
    test('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    test('includes a valid ISO timestamp', async () => {
      const res = await request(app).get('/health');
      expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    });
  });

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  describe('unknown routes', () => {
    test('GET /unknown → 404', async () => {
      const res = await request(app).get('/unknown');
      expect(res.status).toBe(404);
    });

    test('POST /api/nonexistent → 404', async () => {
      const res = await request(app).post('/api/nonexistent').send({});
      expect(res.status).toBe(404);
    });
  });
});
