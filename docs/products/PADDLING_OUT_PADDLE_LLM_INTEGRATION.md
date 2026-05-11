# Paddling Out -> Paddle LLM Integration

Paddling Out keeps the public product API and frontend routes. The standalone
`paddle-llm` service becomes the preferred internal model upstream.

## Runtime Flow

```text
Frontend -> Paddling Out API -> Paddle LLM /predict
                         \-> legacy ML service fallback
                         \-> conservative rule fallback
```

The browser should not call Paddle LLM directly. Product caching, rate limits,
and safety fallback stay in the Paddling Out backend.

## Environment

```bash
PADDLE_LLM_URL=https://paddle-llm-xxxxx.run.app
PADDLE_LLM_API_KEY=...
PADDLE_LLM_TIMEOUT_MS=8000

# Optional during migration
ML_SERVICE_URL=https://legacy-kaayko-ml-service.run.app
```

## Code Path

`functions/api/weather/mlService.js` now prefers Paddle LLM when
`PADDLE_LLM_URL` is set.

The adapter lives in:

```text
functions/api/weather/paddleLlmClient.js
```

It maps the existing standardized feature object into Paddle LLM's
`paddle-llm.predict.v1` contract and normalizes the response back to the legacy
shape expected by `paddleScore`, `fastForecast`, and `forecast`.

## Fallback Order

1. Paddle LLM `/predict`.
2. Legacy `ML_SERVICE_URL` `/predict`.
3. Local conservative rules.

This lets us deploy Paddle LLM without breaking current Paddling Out behavior.
