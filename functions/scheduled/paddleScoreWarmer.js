// functions/scheduled/paddleScoreWarmer.js
//
// Scheduled function: warms paddle_score_cache for all curated spots every 15 minutes.
// Also exports aggregatePaddleFeedback (daily) which computes MAE/RMSE/bias from
// user feedback and writes per-spot calibration offsets to paddle_spot_calibrations.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const PaddleScoreCache = require('../cache/paddleScoreCache');
const { computePaddleScoreForSpot } = require('../api/weather/paddleScoreCompute');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Read all curated spots directly from Firestore (no HTTP call to the API).
 * Returns [{id, lat, lng, name}]
 */
async function getLocationsFromFirestore() {
    const db = getFirestore();
    try {
        const snapshot = await db.collection('paddlingSpots').get();
        return snapshot.docs
            .map(doc => {
                const data = doc.data();
                return {
                    id:   doc.id,
                    lat:  data.location?.latitude,
                    lng:  data.location?.longitude,
                    name: data.lakeName || data.title || doc.id
                };
            })
            .filter(loc => loc.lat && loc.lng);
    } catch (err) {
        logger.error('getLocationsFromFirestore failed:', err);
        return [];
    }
}

/**
 * Load per-spot dynamic calibration offsets from paddle_spot_calibrations.
 * Returns Map<spotId, biasOffset>.
 */
async function loadCalibrationOffsets() {
    const db = getFirestore();
    const offsets = new Map();
    try {
        const snapshot = await db.collection('paddle_spot_calibrations').get();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (typeof data.biasOffset === 'number') {
                offsets.set(doc.id, data.biasOffset);
            }
        });
    } catch (err) {
        logger.warn('loadCalibrationOffsets: failed to read offsets, using 0 for all spots', err.message);
    }
    return offsets;
}

// ─── Paddle Score Cache Warmer ───────────────────────────────────────────────

/**
 * Runs every 15 minutes. Pre-computes paddle scores for all curated spots
 * and writes them to paddle_score_cache so paddlingout.js reads without ML calls.
 */
exports.warmPaddleScoreCache = onSchedule({
    schedule: '*/15 * * * *',
    timeZone: 'America/Los_Angeles',
    timeoutSeconds: 540,
    memory: '512MiB',
    retryConfig: { retryCount: 1 }
}, async () => {
    logger.info('warmPaddleScoreCache: starting');

    const [locations, calibrationOffsets] = await Promise.all([
        getLocationsFromFirestore(),
        loadCalibrationOffsets()
    ]);

    if (locations.length === 0) {
        logger.warn('warmPaddleScoreCache: no locations found, skipping');
        return;
    }

    logger.info(`warmPaddleScoreCache: processing ${locations.length} spots`);

    const BATCH_SIZE = 5;
    const results = [];

    for (let i = 0; i < locations.length; i += BATCH_SIZE) {
        const batch = locations.slice(i, i + BATCH_SIZE);

        const batchResults = await Promise.allSettled(
            batch.map(loc => computePaddleScoreForSpot(loc, { calibrationOffsets }))
        );

        batchResults.forEach((outcome, idx) => {
            const loc = batch[idx];
            if (outcome.status === 'fulfilled' && outcome.value) {
                results.push({ spotId: loc.id, scoreData: outcome.value });
            } else {
                const reason = outcome.reason?.message || 'null result';
                logger.warn(`warmPaddleScoreCache: failed for ${loc.id}: ${reason}`);
            }
        });

        // Small delay between batches to respect WeatherAPI rate limits
        if (i + BATCH_SIZE < locations.length) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    if (results.length > 0) {
        const cache = new PaddleScoreCache();
        const written = await cache.setMany(results);
        logger.info(`warmPaddleScoreCache: wrote ${written} scores to cache (${results.length}/${locations.length} succeeded)`);
    } else {
        logger.warn('warmPaddleScoreCache: no scores computed, cache not updated');
    }
});

// ─── Feedback Aggregation ────────────────────────────────────────────────────

/**
 * Runs daily at 3am PT. Aggregates paddle_predictions_feedback into:
 *   - paddle_model_metrics (global + per-spot MAE, RMSE, bias)
 *   - paddle_spot_calibrations (per-spot bias offsets for spots with ≥10 samples)
 */
exports.aggregatePaddleFeedback = onSchedule({
    schedule: '0 3 * * *',
    timeZone: 'America/Los_Angeles',
    timeoutSeconds: 300,
    memory: '256MiB'
}, async () => {
    logger.info('aggregatePaddleFeedback: starting');

    const db = getFirestore();

    const snapshot = await db.collection('paddle_predictions_feedback').get();
    if (snapshot.empty) {
        logger.info('aggregatePaddleFeedback: no feedback documents, skipping');
        return;
    }

    const bySpot = {};
    const globalPairs = [];

    snapshot.forEach(doc => {
        const { spotId, predictedScore, actualScore } = doc.data();
        if (typeof predictedScore !== 'number' || typeof actualScore !== 'number') return;

        const pair = { predicted: predictedScore, actual: actualScore };
        globalPairs.push(pair);

        if (!bySpot[spotId]) bySpot[spotId] = [];
        bySpot[spotId].push(pair);
    });

    function computeMetrics(pairs) {
        if (pairs.length === 0) return null;
        const errors = pairs.map(p => p.actual - p.predicted);
        const mae  = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
        const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
        const bias = errors.reduce((s, e) => s + e, 0) / errors.length;
        return { mae, rmse, bias, sampleCount: pairs.length };
    }

    const globalMetrics = computeMetrics(globalPairs);
    const writeBatch = db.batch();

    // Write global metrics
    if (globalMetrics) {
        writeBatch.set(db.collection('paddle_model_metrics').doc('global'), {
            ...globalMetrics,
            computedAt: FieldValue.serverTimestamp()
        });
    }

    const MIN_SAMPLES_FOR_CALIBRATION = 10;

    // Write per-spot metrics and calibration offsets
    for (const [spotId, pairs] of Object.entries(bySpot)) {
        const metrics = computeMetrics(pairs);
        if (!metrics) continue;

        writeBatch.set(db.collection('paddle_model_metrics').doc(spotId), {
            ...metrics,
            spotId,
            computedAt: FieldValue.serverTimestamp()
        });

        if (metrics.sampleCount >= MIN_SAMPLES_FOR_CALIBRATION) {
            // bias = mean(actual - predicted)
            // positive bias → model under-predicts → apply positive offset
            // negative bias → model over-predicts → apply negative offset
            const cappedOffset = Math.max(-1.0, Math.min(1.0, metrics.bias));
            writeBatch.set(db.collection('paddle_spot_calibrations').doc(spotId), {
                spotId,
                biasOffset: cappedOffset,
                sampleCount: metrics.sampleCount,
                lastUpdated: FieldValue.serverTimestamp(),
                autoComputed: true
            });
        }
    }

    await writeBatch.commit();

    logger.info(`aggregatePaddleFeedback: complete. ${globalPairs.length} total samples, ${Object.keys(bySpot).length} spots.`);
    if (globalMetrics) {
        logger.info(`Global metrics — MAE: ${globalMetrics.mae.toFixed(3)}, RMSE: ${globalMetrics.rmse.toFixed(3)}, Bias: ${globalMetrics.bias.toFixed(3)}`);
    }
});
