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

Public rating must validate spot IDs and avoid raw IP storage. The current
working tree does this for new public rating labels through `callerKey()`.

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

## Scoring core

`scoringPipeline.scoreFromFeatures` is the one path every surface scores
through: predict -> heuristic calibrate -> isotonic recalibrate -> penalties ->
offset -> snap -> interpret.

Two rules govern this module and are easy to break by accident:

- **Time and place are inputs, never ambient state.** Anything seasonal or
  hour-of-day reads the LOCATION-LOCAL clock of the hour being scored, passed in
  as `localTime`. Cloud Functions run in UTC; `new Date()` here has caused three
  separate published-score bugs (see ALGORITHM_CHANGELOG v2.5.0).
- **Stand down rather than guess.** A rule that cannot read what it needs
  returns a zero adjustment with a stated reason. A calibrator artifact that is
  missing, corrupt, or fitted on a different score generator falls back to the
  identity map, not to a default curve.

Model artifacts live in `functions/data/models/` — the only location that
survives a deploy. They are produced in the `paddle-llm` repo and must be
copied in as a release step.

| Env var | Effect |
|---|---|
| `PADDLE_SCORE_CALIBRATION=off` | disable isotonic recalibration entirely |
| `PADDLE_SCORE_CALIBRATOR_PATH` | load the calibrator from this exact file (and only this file) |
| `PADDLE_SCORE_CALIBRATION_SOURCES` | comma-separated `predictionSource` values the curve may be applied to |
| `PADDLE_LOCAL_MODEL=off` | force the remote Cloud Run model even when a local artifact exists |
| `PADDLE_LOCAL_MODEL_PATH` | load the in-process model from this exact file |

## Tests

Run:

```bash
npm run test:paddlingout
npm run test:paddlescore   # weather-paddle-score + api/weather/__tests__
```
