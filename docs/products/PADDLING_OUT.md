# Paddling Out Backend Product Map

Last reviewed: 2026-09-05

Paddling Out backend routes power the public lake directory, forecasts, search, Add Lake submissions, ratings, and the partial trainer/tourist experience.

## Runtime Mounts

Mounted in `functions/index.js`:

- `GET /paddlingOut`
- `GET /paddlingOut/:id`
- `GET /paddlingOut/geocode`
- `POST /paddlingOut/submitEntry`
- `POST /paddlingOut/lakeRequests`
- `GET /paddlingOut/admin/submissions`
- `POST /paddlingOut/admin/submissions/:id/validate`
- `POST /paddlingOut/admin/submissions/:id/reject`
- `GET /nearbyWater`
- `GET /paddleScore`
- `POST /paddleScore/feedback`
- `POST /paddleScore/publicRating`
- `POST /paddleScore/batch`
- `GET /paddleScore/metrics`
- `GET /fastForecast`
- `GET /fastForecast/cache/stats`
- `GET /forecast`
- `POST /forecast/batch`
- `GET /paddle-trainer/tourist-lakes`
- `GET /paddle-trainer/tourist-weather`
- `POST /paddle-trainer/ratings`

## Primary Files

- `functions/api/weather/paddlingout.js`
- `functions/api/weather/communitySpotVisibility.js`
- `functions/api/weather/nearbyWater.js`
- `functions/api/weather/paddleScore.js`
- `functions/api/weather/fastForecast.js`
- `functions/api/weather/forecast.js`
- `functions/api/weather/paddleTrainer.js`
- `functions/api/weather/paddleScoreCompute.js`
- `functions/api/weather/paddleLlmClient.js`

## Add Lake Submission Model

Current model: admin-review-before-publication.

Important behavior:

- Public submission accepts text fields plus 1-3 images.
- Images are limited by count, MIME type, magic bytes, per-image size, and total payload size.
- Rate limiting and dedupe are applied by client/IP hash and normalized lake/location fields.
- Backend writes a hidden public-shaped `paddlingSpots/{spotId}` doc plus `paddling_lake_submissions/{spotId}` for admin review.
- New submissions use `submissionStatus: pending` and `goLiveAt: null`.
- `isPublicPaddlingSpot()` hides pending community submissions.
- Admin validation sets `submissionStatus: validated`, making the spot public.
- Admin rejection marks rejected and clears/deletes public image fields by default.
- Submitter contact email is stored only on the admin submission doc and must not be returned publicly.

Frontend copy must not promise automatic 2-day publication unless backend `goLiveAt` behavior is intentionally restored.

## Forecast And Search

Search and forecast public APIs are live:

- Search geocoding should use `GET /paddlingOut/geocode`, not browser-direct Nominatim calls.
- Nearby water search uses `GET /nearbyWater`.
- Batch scoring uses `POST /paddleScore/batch`, capped by input limits and anonymous request controls.
- Fast Forecast is the preferred public forecast path for the frontend.
- Heavy `forecast` remains available and rate-limited.

## Rate And Trainer

Public rating:

- `POST /paddleScore/publicRating` is intended for the no-auth public Rate page.
- It must validate public spot IDs, avoid raw IP storage for new ratings, and use hardened client identity.

Trainer:

- Current backend implements only tourist lakes, tourist weather, and rating POST.
- The deployed trainer frontend calls additional endpoints not implemented by this router.
- Do not treat trainer as a complete public feature until those endpoints exist or the UI hides those branches.

## Tests

Run from `functions/`:

```bash
npm run test:paddlingout
node ./node_modules/jest/bin/jest.js --runInBand __tests__/weather-paddle-score.test.js --forceExit --detectOpenHandles
```

The September audit run passed both suites.

## Current P0/P1 Backlog

- Align Add Lake frontend copy with admin-review behavior.
- Fix public Rate routing/UX or implement missing trainer APIs.
- Harden public rating IP handling and public spot validation.
- Lower-bound/validate `nearbyWater` radius.

