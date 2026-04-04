const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');

/**
 * Dynamic Location Polling Service
 * Discovers new/changed paddling spots by comparing Firestore paddlingSpots
 * against the previously-stored snapshot in known_locations.
 * Never makes HTTP calls back to the paddlingOut API — that's a circular dependency.
 */
class LocationPoller {
    constructor() {
        this.KNOWN_LOCATIONS_COLLECTION = 'known_locations';
    }

    /**
     * Fetch all locations directly from Firestore paddlingSpots collection.
     * Returns an array in the same shape the old HTTP call returned.
     */
    async fetchAllLocations() {
        const { getFirestore } = require('firebase-admin/firestore');
        const db = getFirestore();

        const snapshot = await Promise.race([
            db.collection('paddlingSpots').get(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Firestore timeout after 10s')), 10000)
            )
        ]);

        return snapshot.docs
            .map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    title: data.title || data.lakeName || doc.id,
                    lakeName: data.lakeName || data.title || doc.id,
                    subtitle: data.subtitle || '',
                    location: {
                        latitude: data.location?.latitude,
                        longitude: data.location?.longitude
                    }
                };
            })
            .filter(loc => loc.location.latitude && loc.location.longitude);
    }

    /**
     * Compare current locations with stored locations and detect changes
     */
    async detectLocationChanges() {
        try {
            const currentLocations = await this.fetchAllLocations();
            
            // Get stored locations from Firestore
            const { getFirestore } = require('firebase-admin/firestore');
            const db = getFirestore();
            
            const storedSnapshot = await db
                .collection(this.KNOWN_LOCATIONS_COLLECTION)
                .doc('locations')
                .get();

            const storedData = storedSnapshot.exists ? storedSnapshot.data() : { locations: [] };
            const storedLocations = storedData.locations || [];

            // Extract location data for comparison
            const currentLocationMap = new Map();
            currentLocations.forEach(loc => {
                currentLocationMap.set(loc.id, {
                    id: loc.id,
                    name: loc.title || loc.lakeName,
                    lat: loc.location.latitude,
                    lng: loc.location.longitude,
                    subtitle: loc.subtitle
                });
            });

            const storedLocationMap = new Map();
            storedLocations.forEach(loc => {
                storedLocationMap.set(loc.id, loc);
            });

            // Detect changes
            const changes = {
                added: [],
                removed: [],
                updated: [],
                total: currentLocations.length,
                previousTotal: storedLocations.length
            };

            // Find new locations
            for (const [id, location] of currentLocationMap) {
                if (!storedLocationMap.has(id)) {
                    changes.added.push(location);
                } else {
                    // Check for updates (coordinate changes, name changes)
                    const stored = storedLocationMap.get(id);
                    if (stored.lat !== location.lat || 
                        stored.lng !== location.lng || 
                        stored.name !== location.name) {
                        changes.updated.push({
                            ...location,
                            previous: stored
                        });
                    }
                }
            }

            // Find removed locations
            for (const [id, location] of storedLocationMap) {
                if (!currentLocationMap.has(id)) {
                    changes.removed.push(location);
                }
            }

            // Update stored locations
            await db
                .collection(this.KNOWN_LOCATIONS_COLLECTION)
                .doc('locations')
                .set({
                    locations: Array.from(currentLocationMap.values()),
                    last_updated: new Date(),
                    total_count: currentLocations.length
                });

            return changes;
        } catch (error) {
            logger.error('Error detecting location changes:', error);
            throw error;
        }
    }

    /**
     * Get current known locations for forecast processing
     */
    async getKnownLocations() {
        try {
            const { getFirestore } = require('firebase-admin/firestore');
            const db = getFirestore();
            
            const doc = await db
                .collection(this.KNOWN_LOCATIONS_COLLECTION)
                .doc('locations')
                .get();

            if (!doc.exists) {
                // Fallback to hardcoded locations if none stored
                logger.warn('No stored locations found, using fallback list');
                return this.getFallbackLocations();
            }

            const data = doc.data();
            return data.locations || [];
        } catch (error) {
            logger.error('Error getting known locations:', error);
            return this.getFallbackLocations();
        }
    }

    /**
     * Fallback locations (current hardcoded list)
     */
    getFallbackLocations() {
        return [
            { id: "ambazari", lat: 21.129713, lng: 79.045547, name: "Ambazari Lake" },
            { id: "antero", lat: 38.982687, lng: -105.896563, name: "Antero Reservoir" },
            { id: "colorado", lat: 38.604813, lng: -109.573563, name: "Colorado River" },
            { id: "cottonwood", lat: 38.781063, lng: -106.277812, name: "Cottonwood Lake" },
            { id: "crescent", lat: 48.052813, lng: -123.870438, name: "Lake Crescent" },
            { id: "diablo", lat: 48.690938, lng: -121.097188, name: "Diablo Lake" },
            { id: "jackson", lat: 43.845863, lng: -110.600359, name: "Jackson Lake" },
            { id: "jenny", lat: 43.749638, lng: -110.729578, name: "Jenny Lake" },
            { id: "kens", lat: 38.479188, lng: -109.428062, name: "Kens Lake" },
            { id: "lewisville", lat: 33.156487, lng: -96.949953, name: "Lewisville Lake" },
            { id: "mcdonald", lat: 48.52838, lng: -113.992351, name: "Lake McDonald" },
            { id: "merrimack", lat: 42.88141, lng: -71.47342, name: "Merrimack River" },
            { id: "powell", lat: 37.01513, lng: -111.536362, name: "Lake Powell" },
            { id: "taylorpark", lat: 38.823442, lng: -106.579883, name: "Taylor Park Reservoir" },
            { id: "trinity", lat: 32.881187, lng: -96.929937, name: "Trinity River" },
            { id: "union", lat: 47.627413, lng: -122.338984, name: "Lake Union" },
            { id: "whiterock", lat: 32.833188, lng: -96.729687, name: "White Rock Lake" }
        ];
    }
}

/**
 * Daily location polling - runs every day at 5 AM UTC
 * Discovers new locations and detects changes
 */
exports.pollLocations = onSchedule({
    schedule: '0 5 * * *', // Daily at 5 AM UTC
    timeZone: 'UTC',
    memory: '512MiB',
    timeoutSeconds: 300
}, async (event) => {
    logger.info('🌍 Starting daily location polling...');
    
    const poller = new LocationPoller();
    
    try {
        const changes = await poller.detectLocationChanges();
        
        logger.info(`📊 Location polling results:
            Total locations: ${changes.total} (was ${changes.previousTotal})
            New locations: ${changes.added.length}
            Updated locations: ${changes.updated.length}
            Removed locations: ${changes.removed.length}`);

        if (changes.added.length > 0) {
            logger.info('🆕 New locations discovered:', changes.added.map(l => `${l.id} (${l.name})`));
        }

        if (changes.updated.length > 0) {
            logger.info('📝 Updated locations:', changes.updated.map(l => `${l.id} (${l.name})`));
        }

        if (changes.removed.length > 0) {
            logger.warn('🗑️  Removed locations:', changes.removed.map(l => `${l.id} (${l.name})`));
        }

        return {
            success: true,
            changes,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        logger.error('❌ Location polling failed:', error);
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
});

module.exports = { LocationPoller };
