// functions/cache/paddleScoreCache.js
//
// Dedicated Firestore cache for pre-computed paddle scores.
// Document ID = spotId. TTL: 15 minutes.
// Used by the paddleScoreWarmer (writer) and paddlingout.js (reader).

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');

class PaddleScoreCache {
    constructor() {
        this.db = getFirestore();
        this.COLLECTION = 'paddle_score_cache';
        this.TTL_MINUTES = 15;
    }

    /**
     * Get cached paddle score for a single spot.
     * Returns null on miss or expiry.
     */
    async get(spotId) {
        try {
            const doc = await this.db.collection(this.COLLECTION).doc(spotId).get();
            if (!doc.exists) return null;

            const data = doc.data();
            if (!data.expiresAt || data.expiresAt.toDate() <= new Date()) {
                return null;
            }

            return data.scoreData;
        } catch (error) {
            logger.warn(`PaddleScoreCache.get failed for ${spotId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Store a paddle score for a single spot.
     */
    async set(spotId, scoreData) {
        try {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + this.TTL_MINUTES * 60 * 1000);

            await this.db.collection(this.COLLECTION).doc(spotId).set({
                spotId,
                scoreData,
                computedAt: FieldValue.serverTimestamp(),
                expiresAt
            });
            return true;
        } catch (error) {
            logger.warn(`PaddleScoreCache.set failed for ${spotId}: ${error.message}`);
            return false;
        }
    }

    /**
     * Fetch all non-expired cached scores as a Map<spotId, scoreData>.
     * Used by paddlingout.js GET / to serve all spots in one read.
     */
    async getAll() {
        try {
            const snapshot = await this.db.collection(this.COLLECTION).get();
            const result = new Map();
            const now = new Date();

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.expiresAt && data.expiresAt.toDate() > now && data.scoreData) {
                    result.set(doc.id, data.scoreData);
                }
            });

            return result;
        } catch (error) {
            logger.warn(`PaddleScoreCache.getAll failed: ${error.message}`);
            return new Map();
        }
    }

    /**
     * Batch-write multiple scores in a single Firestore commit.
     * @param {Array<{spotId: string, scoreData: object}>} entries
     */
    async setMany(entries) {
        if (!entries || entries.length === 0) return 0;

        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.TTL_MINUTES * 60 * 1000);

        // Firestore batch writes are limited to 500 ops each
        const BATCH_LIMIT = 400;
        let written = 0;

        for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
            const chunk = entries.slice(i, i + BATCH_LIMIT);
            const batch = this.db.batch();

            chunk.forEach(({ spotId, scoreData }) => {
                const ref = this.db.collection(this.COLLECTION).doc(spotId);
                batch.set(ref, {
                    spotId,
                    scoreData,
                    computedAt: FieldValue.serverTimestamp(),
                    expiresAt
                });
            });

            await batch.commit();
            written += chunk.length;
        }

        return written;
    }
}

module.exports = PaddleScoreCache;
