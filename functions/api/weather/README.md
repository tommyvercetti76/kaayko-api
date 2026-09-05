# Weather And Paddling APIs

Last reviewed: 2026-09-05

This module powers Paddling Out lake discovery, forecasts, Paddle Scores, community submissions, and the partial trainer/tourist API.

## Routes

Mounted in `functions/index.js`:

- `/paddlingOut` -> `paddlingout.js`
- `/nearbyWater` -> `nearbyWater.js`
- `/paddleScore` -> `paddleScore.js`
- `/fastForecast` -> `fastForecast.js`
- `/forecast` -> `forecast.js`
- `/paddle-trainer` -> `paddleTrainer.js`

## Paddling Out

Routes:

- `GET /paddlingOut`
- `GET /paddlingOut/:id`
- `GET /paddlingOut/geocode`
- `POST /paddlingOut/submitEntry`
- `POST /paddlingOut/lakeRequests`
- `GET /paddlingOut/admin/submissions`
- `POST /paddlingOut/admin/submissions/:id/validate`
- `POST /paddlingOut/admin/submissions/:id/reject`

Community submission visibility is controlled by `communitySpotVisibility.js`.

## Paddle Score

Routes:

- `GET /paddleScore`
- `POST /paddleScore/feedback`
- `POST /paddleScore/publicRating`
- `POST /paddleScore/batch`
- `GET /paddleScore/metrics`

Public rating must validate spot IDs and avoid raw IP storage.

## Forecast

Routes:

- `GET /fastForecast`
- `GET /fastForecast/cache/stats`
- `GET /forecast`
- `POST /forecast/batch`

Use `fastForecast` for public frontend forecast pages where possible.

## Nearby Water

Route:

- `GET /nearbyWater`

Validate lat/lng/radius on the server. Do not rely only on frontend clamps.

## Paddle Trainer

Currently implemented:

- `GET /paddle-trainer/tourist-lakes`
- `GET /paddle-trainer/tourist-weather`
- `POST /paddle-trainer/ratings`

The deployed trainer frontend calls additional endpoints that are not implemented here. Treat trainer as partial until backend routes or frontend hiding/gating are complete.

## Tests

Run:

```bash
npm run test:paddlingout
node ./node_modules/jest/bin/jest.js --runInBand __tests__/weather-paddle-score.test.js --forceExit --detectOpenHandles
```

