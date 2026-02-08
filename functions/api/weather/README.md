# 🌊 Weather API

ML-powered paddle conditions — real-time ratings, multi-day forecasts, safety warnings, and nearby water discovery. The largest module in the codebase (23 files).

## Files (23)

| File | Role |
|------|------|
| **Routers** | |
| `paddleScore.js` | `GET /paddleScore` — current ML paddle rating |
| `fastForecast.js` | `GET /fastForecast` — cached 3-day hourly forecast |
| `forecast.js` | `GET /forecast`, `POST /forecast/batch` — premium on-demand forecast |
| `nearbyWater.js` | `GET /nearbyWater` — Overpass API water body search |
| `paddlingout.js` | `GET /paddlingOut`, `GET /paddlingOut/:id` — spot listings |
| **Services** | |
| `paddleScoreService.js` | Full ML pipeline: weather → standardize → predict → calibrate → warn |
| `fastForecastService.js` | 3-day hourly forecast with per-hour ML scores |
| `forecastService.js` | Core forecast generation + batch + Firestore caching |
| `nearbyWaterService.js` | Overpass API queries, dedup, public land filtering |
| `paddlingoutService.js` | Paddle score computation for spot listings |
| `unifiedWeatherService.js` | Central weather data fetcher (WeatherAPI + cache + marine + batch) |
| **ML Pipeline** | |
| `mlService.js` | Cloud Run ML client + rule-based fallback |
| `modelCalibration.js` | Post-ML calibration (water temp, season, location, wind) |
| `dataStandardization.js` | ML input/output unit normalization |
| `inputStandardization.js` | Parameter alias resolution middleware (lat/lng/spotId) |
| **Safety** | |
| `smartWarnings.js` | 8-category safety warning generator, top-3 prioritized |
| `paddlePenalties.js` | Enhanced penalty engine (wind, UV, waves, precip, etc.) |
| `paddlePenaltyConfig.js` | Thresholds and helper functions for penalty system |
| **Utilities** | |
| `forecastHelpers.js` | `generatePaddleSummary()`, `calculateSafetyLevel()` |
| `sharedWeatherUtils.js` | Rate limiter, security headers, coord validation |
| `waterTempEstimation.js` | Heuristic water temp from air temp + latitude + season |
| `weatherFallback.js` | 6-strategy coordinate fallback for API coverage gaps |
| `weatherHelpers.js` | Pure functions: normalizeLocation, cacheKey, HTTP helpers |

---

## Endpoints (8)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/paddleScore` | ML-powered current paddle rating | None |
| GET | `/paddlingOut` | List all spots with live ML scores | None |
| GET | `/paddlingOut/:id` | Single spot detail with enrichment | None |
| GET | `/fastForecast` | Cached 3-day hourly forecast | None |
| GET | `/fastForecast/cache/stats` | Cache statistics | None |
| GET | `/forecast` | Premium on-demand forecast | None (rate-limited 10/min) |
| POST | `/forecast/batch` | Batch-generate forecasts for all locations | `requireAuth` + `requireAdmin` |
| GET | `/nearbyWater` | Find lakes/rivers/reservoirs nearby | None |

---

## ML Pipeline

```
Request (lat, lng or spotId)
    ↓
inputStandardization.js     → resolve aliases, validate coords
    ↓
unifiedWeatherService.js    → fetch from WeatherAPI (cached)
    ↓
dataStandardization.js      → normalize units for ML model
    ↓
mlService.js                → Cloud Run ML prediction (or rule-based fallback)
    ↓
modelCalibration.js         → adjust for water temp, season, location, wind
    ↓
smartWarnings.js            → generate safety warnings (8 categories, top 3)
    ↓
paddlePenalties.js          → apply penalty deductions
    ↓
Final Response              → rating 1.0–5.0 (0.5 increments) + warnings + conditions
```

### Rating Scale

| Rating | Label |
|--------|-------|
| 1.0 | Dangerous |
| 1.5–2.0 | Poor |
| 2.5–3.0 | Fair |
| 3.5–4.0 | Good |
| 4.5–5.0 | Excellent |

---

## Smart Warnings

8 warning categories, severity-sorted, top 3 returned:

1. **Wind** — gusts, sustained, direction
2. **UV** — UV index thresholds
3. **Waves** — height, period, swell
4. **Precipitation** — rain, snow, chance
5. **Temperature** — air temp extremes
6. **Visibility** — fog, haze
7. **Lightning** — thunderstorm risk
8. **Water Temperature** — hypothermia risk

---

## Common Parameters

Most endpoints accept:

| Param | Aliases | Description |
|-------|---------|-------------|
| `lat` | `latitude` | Latitude |
| `lng` | `lon`, `longitude` | Longitude |
| `spotId` | — | Firestore paddling spot ID (alternative to lat/lng) |

The `inputStandardization.js` middleware normalizes all aliases before the handler runs.

---

## Nearby Water (Overpass API)

`GET /nearbyWater` queries OpenStreetMap's Overpass API for:
- Lakes, ponds, reservoirs
- Rivers, streams, canals
- Coastlines

**Parameters:** `lat`, `lng`, `radius` (meters, default 5000), `limit`

Results are deduplicated and filtered for public accessibility.

---

## Forecast Caching & Scheduled Warming

- Forecasts cached in Firestore (`forecastCache` collection)
- 6 scheduled Cloud Functions pre-warm the cache for known paddling spots
- Cache stats exposed at `GET /fastForecast/cache/stats`

See `scheduled/forecastScheduler.js` and `cache/forecastCache.js` for implementation.

---

## External APIs

| API | Purpose |
|-----|---------|
| [WeatherAPI.com](https://www.weatherapi.com/) | Weather data + marine data |
| Overpass API (OpenStreetMap) | Nearby water body discovery |
| Cloud Run ML Service | Paddle condition prediction model |

---

## Firestore Collections

| Collection | Purpose |
|------------|---------|
| `paddlingSpots` | Known paddling locations |
| `forecastCache` | Cached forecast data |

---

**Test suites:**
- `__tests__/weather.test.js` (28 tests)
- `__tests__/integration/weather.integration.test.js`
