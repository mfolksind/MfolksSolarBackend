# Solar Calculator — Express.js Backend

A standalone Express server that accepts location + system capacity, generates a mock 24-hour weather forecast, runs daytime hours through an XGBoost ML model via Python, and returns predicted solar generation.

---

## Project structure

```
Weather backend/
├── server.js                        ← Express app (entry point)
├── predict.py                       ← Python ML predictor
├── solar_xgboost_master_model.pkl   ← ⚠️ You must place this here!
├── package.json
└── .gitignore
```

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| Python | ≥ 3.8 |
| pip packages | `pandas`, `scikit-learn`, `xgboost`, `pickle` (stdlib) |

Install Python deps:
```bash
pip install pandas xgboost scikit-learn
```

---

## Setup & run

```bash
# Install Node deps
npm install

# Drop your trained model here (REQUIRED)
# solar_xgboost_master_model.pkl

# Start the server (with auto-reload on save)
npm run dev

# Or production start
npm start
```

Server listens on **http://localhost:3001** by default.  
Set the `PORT` env variable to override.

---

## API

### `POST /api/calculate-solar`

**Request body (JSON)**
```json
{
  "latitude":   28.6139,
  "longitude":  77.2090,
  "capacity_kw": 10
}
```

**Success response**
```json
{
  "success": true,
  "daily_total_kwh": 42.71,
  "hourly_breakdown": [
    {
      "hour": 6,
      "generation_kwh": 0.18,
      "irradiation": 95,
      "ambient_temp": 26.3,
      "module_temp": 29.8
    }
  ],
  "full_weather_forecast": [ ... ]
}
```

**Error response**
```json
{
  "success": false,
  "error": "Descriptive error message"
}
```

### `GET /health`
Returns `{ "status": "ok" }` — useful for uptime checks.

---

## How it works

```
Frontend
  │
  │  POST /api/calculate-solar  { latitude, longitude, capacity_kw }
  ▼
server.js
  ├─ generateMockWeatherForecast()  →  24-hour array (IRRADIATION, AMBIENT_TEMP, MODULE_TEMP)
  ├─ Filter: keep only hours where IRRADIATION > 0  (nighttime bypass)
  ├─ spawn('python', ['predict.py', JSON.stringify(payload)])
  │     └─ predict.py loads solar_xgboost_master_model.pkl
  │     └─ Runs model.predict() on daytime rows
  │     └─ Scales output by (user_capacity_kw / 2000)
  │     └─ Prints JSON to stdout
  ├─ Sum hourly predictions → daily_total_kwh
  └─ Return JSON to frontend
```
