# ⏰ How Scheduled Functions Work

**Cloud Scheduler + Firebase Functions = Pre-computed Cache**

## Overview

Scheduled functions run at specific times (6am, 12pm, 6pm, 10pm) to pre-compute and cache forecasts for all paddling locations. This ensures instant API responses without waiting for ML predictions.

## Architecture

```
Cloud Scheduler (Cron)
        ↓
Firebase Function Triggers
        ↓
Loop Through All Locations
        ↓
Call ML Service for Each
        ↓
Cache Results in Firestore
        ↓
FastForecast API Serves Cached Data (192ms)
```

## Scheduled Functions

Located in: `functions/scheduled/`

### 1. **forecastScheduler** (4x daily)
- Schedule: 6am, 12pm, 6pm, 10pm PST
- Purpose: Pre-compute forecasts for all 17+ paddling locations
- Cache TTL: 6 hours
- Reduces API response time: 7s → 192ms

## Configuration

```javascript
// functions/src/scheduled/forecastScheduler.js
exports.scheduledForecastUpdate = onSchedule({
  schedule: '0 6,12,18,22 * * *',  // 6am, 12pm, 6pm, 10pm
  timeZone: 'America/Los_Angeles'
}, async (event) => {
  // Pre-compute and cache all forecasts
});
```

## Benefits

1. **Instant Responses**: Cached data served in <200ms
2. **ML Efficiency**: ML service called only 4x daily, not on every request
3. **Cost Reduction**: Fewer ML service calls = lower costs
4. **Reliability**: Always have recent data even if ML service is slow

## Deployment

Scheduled functions are automatically deployed with:
```bash
cd deployment
./deploy-firebase-functions.sh
```

Or deploy only scheduled functions:
```bash
cd functions
npm run deploy:scheduled
```

## Monitoring

Check scheduled function logs in Firebase Console:
- Functions → scheduledForecastUpdate
- View execution history
- Monitor cache hit rates
- Check for errors

## Related Documentation

- Cache Architecture: `docs/API-QUICK-REFERENCE-v2.1.0.md`
- Deployment Guide: `docs/deployment/DEPLOYMENT_GUIDE.md`
- FastForecast API: `../functions/api/weather/README.md`
