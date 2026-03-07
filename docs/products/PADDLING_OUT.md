# Paddling Out Backend

## Scope

Paddling Out is the weather and location intelligence product in Kaayko. It combines spot discovery, forecast generation, cached fast responses, paddle scoring, nearby water search, and AI-facing wrappers.

## Mounted routes on `main`

Core public and premium routes:

- `GET /paddlingOut`
- `GET /paddlingOut/:id`
- `GET /nearbyWater`
- `GET /paddleScore`
- `GET /fastForecast`
- `GET /fastForecast/cache/stats`
- `GET /forecast`
- `POST /forecast/batch`

AI wrapper routes:

- `GET /gptActions/health`
- `GET /gptActions/paddleScore`
- `GET /gptActions/forecast`
- `GET /gptActions/locations`
- `POST /gptActions/findNearby`

Primary route files:

- [`functions/api/weather/paddlingout.js`](../../functions/api/weather/paddlingout.js)
- [`functions/api/weather/nearbyWater.js`](../../functions/api/weather/nearbyWater.js)
- [`functions/api/weather/paddleScore.js`](../../functions/api/weather/paddleScore.js)
- [`functions/api/weather/fastForecast.js`](../../functions/api/weather/fastForecast.js)
- [`functions/api/weather/forecast.js`](../../functions/api/weather/forecast.js)
- [`functions/api/ai/gptActions.js`](../../functions/api/ai/gptActions.js)

## Scheduled jobs

Forecast warming and health jobs are exported from [`functions/scheduled/forecastScheduler.js`](../../functions/scheduled/forecastScheduler.js):

- `earlyMorningForecast`
- `morningForecastUpdate`
- `afternoonForecastUpdate`
- `eveningForecastUpdate`
- `emergencyForecastRefresh`
- `forecastSchedulerHealth`

These jobs prefill cache surfaces used by `fastForecast`.

## Frontend consumers

Primary frontend files:

- `src/paddlingout.html`
- `src/js/services/apiClient.js`
- `src/js/paddlingout.js`
- `src/js/advancedModal.js`
- `src/js/customLocation.js`
- `src/js/components/*`
- `src/js/about-dynamic.js`

## External systems

- Weather provider integrations via the unified weather services
- Cloud Run ML service in [`ml-service`](../../ml-service)
- OpenStreetMap / Overpass for nearby water discovery
- Firestore-backed cache layers

## Security and access

- Public forecast and location routes are rate-limited or input-normalized inside module implementations.
- `forecast` is the heavier internal or premium generation path; `fastForecast` is the cached public path.
- AI wrapper endpoints should be treated as public contract surfaces because they simplify access for external agents.

## Quality and maintenance notes

- The current automated suite on `main` does not include weather regression coverage.
- The frontend carries both production and emulator toggles; verify current endpoint usage before changing routing.
- A proper maintenance automation should run spot list fetches, cached forecast fetches, premium forecast generation, nearby water lookup, and cache-stat sanity checks.
