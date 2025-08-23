const functions = require('firebase-functions');
const axios = require('axios');

/**
 * Firebase function to find paddleable lakes on public lands using Overpass API
 * Integrates with Kaayko's existing API structure
 */

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
];

const QUERY_TIMEOUT = 180;
const HTTP_TIMEOUT = 60000; // 60 seconds
const MAX_RETRIES = 3;

/**
 * Calculate distance between two points using Haversine formula
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 + 
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * 
            Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Build Overpass query for water bodies
 */
function buildWaterQuery(lat, lon, radiusMeters) {
  const bboxSize = radiusMeters / 111000; // Rough degrees conversion
  const south = lat - bboxSize;
  const north = lat + bboxSize;
  const west = lon - bboxSize;
  const east = lon + bboxSize;
  
  return `[out:json][timeout:${QUERY_TIMEOUT}];
(
  way(${south},${west},${north},${east})
    ["natural"="water"]
    ["name"]
    ["intermittent"!="yes"];
  
  relation(${south},${west},${north},${east})
    ["natural"="water"]
    ["name"]
    ["intermittent"!="yes"];
    
  way(${south},${west},${north},${east})
    ["water"~"^(lake|reservoir)$"]
    ["name"];
    
  relation(${south},${west},${north},${east})
    ["water"~"^(lake|reservoir)$"]
    ["name"];
    
  node(${south},${west},${north},${east})
    ["place"~"^(lake|reservoir)$"]
    ["name"];
);
out center meta;`;
}

/**
 * Build Overpass query for public lands
 */
function buildPublicLandsQuery(lat, lon, radiusMeters) {
  const bboxSize = radiusMeters / 111000;
  const south = lat - bboxSize;
  const north = lat + bboxSize;
  const west = lon - bboxSize;
  const east = lon + bboxSize;
  
  return `[out:json][timeout:${QUERY_TIMEOUT}];
(
  way(${south},${west},${north},${east})
    ["boundary"="protected_area"];
  relation(${south},${west},${north},${east})
    ["boundary"="protected_area"];
    
  way(${south},${west},${north},${east})
    ["boundary"="national_park"];
  relation(${south},${west},${north},${east})
    ["boundary"="national_park"];
    
  way(${south},${west},${north},${east})
    ["leisure"="park"];
  relation(${south},${west},${north},${east})
    ["leisure"="park"];
    
  way(${south},${west},${north},${east})
    ["leisure"="nature_reserve"];
  relation(${south},${west},${north},${east})
    ["leisure"="nature_reserve"];
);
out center meta;`;
}

/**
 * Query Overpass API with retry logic
 */
async function queryOverpass(query, retryCount = 0) {
  const serverUrl = OVERPASS_SERVERS[retryCount % OVERPASS_SERVERS.length];
  
  try {
    console.log(`Querying Overpass API: ${serverUrl} (attempt ${retryCount + 1})`);
    
    const response = await axios.post(serverUrl, 
      `data=${encodeURIComponent(query)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Kaayko-API/1.0 (paddling conditions)'
        },
        timeout: HTTP_TIMEOUT
      }
    );
    
    if (response.status === 200 && response.data) {
      console.log(`✓ Overpass query successful: ${response.data.elements?.length || 0} elements`);
      return response.data;
    }
    
    throw new Error(`HTTP ${response.status}`);
    
  } catch (error) {
    console.error(`Overpass query failed for ${serverUrl}:`, error.message);
    
    if (retryCount < MAX_RETRIES - 1) {
      const waitTime = Math.min(1000 * Math.pow(2, retryCount), 10000);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return queryOverpass(query, retryCount + 1);
    }
    
    throw new Error(`All Overpass servers failed: ${error.message}`);
  }
}

/**
 * Extract coordinates from Overpass element
 */
function extractCoordinates(element) {
  if (element.center) {
    return { lat: element.center.lat, lon: element.center.lon };
  } else if (element.lat !== undefined && element.lon !== undefined) {
    return { lat: element.lat, lon: element.lon };
  }
  return null;
}

/**
 * Process water elements into standardized format
 */
function processWaterElements(elements, originLat, originLon) {
  return elements
    .map(element => {
      const coords = extractCoordinates(element);
      if (!coords) return null;
      
      const tags = element.tags || {};
      const name = tags.name || tags.reservoir_name || tags.official_name || 'Unnamed Water Body';
      
      let waterType = 'Lake';
      if (tags.water === 'reservoir' || name.toLowerCase().includes('reservoir')) {
        waterType = 'Reservoir';
      }
      
      const distanceMiles = haversineDistance(originLat, originLon, coords.lat, coords.lon);
      
      return {
        id: `water_${element.type}_${element.id}`,
        name: name,
        type: waterType,
        coordinates: {
          latitude: coords.lat,
          longitude: coords.lon
        },
        distanceMiles: Math.round(distanceMiles * 10) / 10,
        access: tags.access || 'unknown',
        operator: tags.operator || null,
        website: tags.website || null,
        tags: tags
      };
    })
    .filter(water => water !== null);
}

/**
 * Process public land elements
 */
function processPublicLands(elements) {
  return elements
    .map(element => {
      const coords = extractCoordinates(element);
      if (!coords) return null;
      
      const tags = element.tags || {};
      const name = tags.name || tags.official_name || 'Public Land';
      
      let landType = 'Public Land';
      if (tags.boundary === 'national_park') {
        landType = 'National Park';
      } else if (tags.boundary === 'protected_area') {
        landType = 'Protected Area';
      } else if (tags.leisure === 'park') {
        landType = 'Park';
      } else if (tags.leisure === 'nature_reserve') {
        landType = 'Nature Reserve';
      }
      
      return {
        id: `land_${element.type}_${element.id}`,
        name: name,
        type: landType,
        coordinates: {
          latitude: coords.lat,
          longitude: coords.lon
        },
        operator: tags.operator || null,
        protectClass: tags.protect_class || null,
        tags: tags
      };
    })
    .filter(land => land !== null);
}

/**
 * Filter waters that are close to public lands
 */
function filterPublicWaters(waters, publicLands, maxDistanceMiles = 0.3) {
  return waters
    .map(water => {
      let minDistance = Infinity;
      let closestLand = null;
      
      for (const land of publicLands) {
        const distance = haversineDistance(
          water.coordinates.latitude, water.coordinates.longitude,
          land.coordinates.latitude, land.coordinates.longitude
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          closestLand = land;
        }
      }
      
      if (minDistance <= maxDistanceMiles && closestLand) {
        return {
          ...water,
          publicLand: {
            name: closestLand.name,
            type: closestLand.type,
            distanceMiles: Math.round(minDistance * 100) / 100
          }
        };
      }
      
      return null;
    })
    .filter(water => water !== null);
}

/**
 * Main Firebase function
 */
exports.nearbyPublicLakes = functions
  .runWith({
    timeoutSeconds: 120,
    memory: '512MB'
  })
  .https.onCall(async (data, context) => {
    try {
      // Validate input
      const { latitude, longitude, radiusMiles = 25, limit = 20, publicDistanceMiles = 0.3 } = data;
      
      if (!latitude || !longitude) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'latitude and longitude are required'
        );
      }
      
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Invalid coordinates'
        );
      }
      
      console.log(`Finding public lakes near ${latitude}, ${longitude} within ${radiusMiles} miles`);
      
      const radiusMeters = radiusMiles * 1609.34;
      
      // Query water bodies and public lands in parallel
      const [waterData, landsData] = await Promise.all([
        queryOverpass(buildWaterQuery(latitude, longitude, radiusMeters)),
        queryOverpass(buildPublicLandsQuery(latitude, longitude, radiusMeters))
      ]);
      
      // Process the data
      const waters = processWaterElements(waterData.elements || [], latitude, longitude);
      const publicLands = processPublicLands(landsData.elements || []);
      
      console.log(`Found ${waters.length} water bodies and ${publicLands.length} public lands`);
      
      // Filter for waters on public lands
      let publicWaters = filterPublicWaters(waters, publicLands, publicDistanceMiles);
      
      // Sort by distance and apply limit
      publicWaters.sort((a, b) => a.distanceMiles - b.distanceMiles);
      if (limit > 0) {
        publicWaters = publicWaters.slice(0, limit);
      }
      
      console.log(`Returning ${publicWaters.length} public lakes`);
      
      return {
        success: true,
        location: {
          latitude,
          longitude,
          radiusMiles
        },
        count: publicWaters.length,
        lakes: publicWaters,
        metadata: {
          totalWaters: waters.length,
          totalPublicLands: publicLands.length,
          maxPublicDistance: publicDistanceMiles,
          generatedAt: new Date().toISOString()
        }
      };
      
    } catch (error) {
      console.error('Error in nearbyPublicLakes:', error);
      
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      
      throw new functions.https.HttpsError(
        'internal',
        'Failed to fetch nearby public lakes',
        { originalError: error.message }
      );
    }
  });
