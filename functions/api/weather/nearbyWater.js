// functions/src/api/nearbyWater.js
// Simple working nearbyWater API that actually returns lakes
// WITH IN-MEMORY CACHING for 30 minutes

const express = require("express");
const https = require("https");
const { logger } = require("firebase-functions");

const router = express.Router();

// In-memory cache for water body results
const waterBodyCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Clean up old cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of waterBodyCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      waterBodyCache.delete(key);
    }
  }
  logger.info(`🧹 Cache cleanup: ${waterBodyCache.size} entries remaining`);
}, 10 * 60 * 1000);

// Enhanced Overpass query function with mirror fallback
async function queryOverpass(query) {
  const mirrors = [
    'overpass-api.de',
    'overpass.kumi.systems',
    'lz4.overpass-api.de'
  ];
  
  const postData = `data=${encodeURIComponent(query)}`;
  
  for (const hostname of mirrors) {
    try {
      const data = await new Promise((resolve, reject) => {
        const options = {
          hostname,
          port: 443,
          path: '/api/interpreter',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': 'Kaayko-API/1.0 (paddling conditions)'
          }
        };

        const req = https.request(options, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve(data);
            } catch (e) {
              logger.error(`Overpass JSON parse error from ${hostname}:`, e);
              reject(e);
            }
          });
        });

        req.on('error', (e) => {
          logger.error(`Overpass request error from ${hostname}:`, e);
          reject(e);
        });

        req.setTimeout(45000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });

        req.write(postData);
        req.end();
      });
      
      logger.info(`✅ Overpass query successful via ${hostname}`);
      return data;
      
    } catch (error) {
      logger.warn(`⚠️ Overpass mirror ${hostname} failed:`, error.message);
      continue;
    }
  }
  
  logger.error('❌ All Overpass mirrors failed');
  return { elements: [] };
}

// Calculate distance between two points in miles
function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Main API endpoint
router.get("/", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat || req.query.latitude);
    const lng = parseFloat(req.query.lng || req.query.longitude);
    const radius = parseInt(req.query.radius || 50);
    const publicOnly = req.query.publicOnly === 'true';

    if (!lat || !lng || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        error: "Invalid coordinates",
        message: "Please provide valid lat/lng parameters"
      });
    }

    // Check cache first (round to 2 decimal places for ~1km precision)
    const cacheKey = `${Math.round(lat * 100) / 100},${Math.round(lng * 100) / 100},${radius},${publicOnly}`;
    const cached = waterBodyCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      logger.info(`✅ Cache HIT for ${cacheKey} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
      return res.json({
        ...cached.data,
        cached: true,
        cacheAge: Math.round((Date.now() - cached.timestamp) / 1000)
      });
    }
    
    logger.info(`❌ Cache MISS for ${cacheKey} - fetching from Overpass API`);

    logger.info(`🔎 Searching for water bodies near ${lat}, ${lng} within ${radius}km${publicOnly ? ' (PUBLIC ONLY)' : ''}`);

    const radiusMeters = radius * 1000;
    
    // Enhanced query prioritizing major water bodies and reservoirs
    const waterQuery = `
[out:json][timeout:90];
(
  // Major reservoirs and lakes - explicit search
  relation(around:${radiusMeters},${lat},${lng})["landuse"="reservoir"]["name"];
  way(around:${radiusMeters},${lat},${lng})["landuse"="reservoir"]["name"];
  relation(around:${radiusMeters},${lat},${lng})["water"="lake"]["name"];
  way(around:${radiusMeters},${lat},${lng})["water"="lake"]["name"];
  relation(around:${radiusMeters},${lat},${lng})["place"="lake"]["name"];
  way(around:${radiusMeters},${lat},${lng})["place"="lake"]["name"];
  
  // Natural water bodies with names
  relation(around:${radiusMeters},${lat},${lng})["natural"="water"]["name"];
  way(around:${radiusMeters},${lat},${lng})["natural"="water"]["name"];
  
  // Major rivers (limited to avoid duplicates)
  relation(around:${radiusMeters},${lat},${lng})["waterway"="river"]["name"];
);
out center tags;
    `.trim();    const waterData = await queryOverpass(waterQuery);
    logger.info(`📦 Overpass returned ${waterData.elements?.length || 0} water elements`);

    let publicLandsData = { elements: [] };
    if (publicOnly) {
      // Query for public lands - simple working format
      const publicQuery = `
[out:json][timeout:90];
(
  relation(around:${radiusMeters},${lat},${lng})["boundary"="protected_area"];
  relation(around:${radiusMeters},${lat},${lng})["boundary"="national_park"];
  relation(around:${radiusMeters},${lat},${lng})["boundary"="park"];
  way(around:${radiusMeters},${lat},${lng})["leisure"="nature_reserve"];
  relation(around:${radiusMeters},${lat},${lng})["leisure"="nature_reserve"];
  way(around:${radiusMeters},${lat},${lng})["leisure"="park"];
  relation(around:${radiusMeters},${lat},${lng})["leisure"="park"];
);
out tags center;
      `.trim();
      
      publicLandsData = await queryOverpass(publicQuery);
      logger.info(`🏞️ Found ${publicLandsData.elements?.length || 0} public land areas`);
    }

    const waterBodies = [];
    let skippedNoName = 0;
    let skippedNoCoords = 0;
    let skippedTooSmall = 0;

    for (const element of waterData.elements || []) {
      const tags = element.tags || {};
      const name = tags.name || tags.reservoir_name || tags.official_name;
      const nameLower = name ? name.toLowerCase() : '';
      
      if (!name || name.trim().length === 0) {
        skippedNoName++;
        continue;
      }

      // Get coordinates - improved logic
      let elementLat, elementLng;
      
      if (element.center) {
        elementLat = element.center.lat;
        elementLng = element.center.lon;
      } else if (element.bounds) {
        const bounds = element.bounds;
        elementLat = (bounds.minlat + bounds.maxlat) / 2;
        elementLng = (bounds.minlon + bounds.maxlon) / 2;
      } else if (element.lat && element.lon) {
        elementLat = element.lat;
        elementLng = element.lon;
      } else {
        skippedNoCoords++;
        continue;
      }

      // Calculate distance
      const distance = distanceMiles(lat, lng, elementLat, elementLng);
      
      // Enhanced filtering - skip very small water features and prioritize major lakes
      let areaKm2 = null;
      // Note: Without bounds we can't calculate area, but we can use other criteria
      
      // Skip features without names unless they're major tagged water bodies
      const isMajorFeature = (
        tags.waterway === 'river' || 
        tags.water === 'lake' || 
        tags.landuse === 'reservoir' ||
        tags.place === 'lake' ||
        (name && (
          nameLower.includes('lake lewisville') || nameLower.includes('white rock') || 
          nameLower.includes('trinity river') || nameLower.includes('grapevine') ||
          nameLower.includes('arlington') || nameLower.includes('ray hubbard') ||
          nameLower.includes('bachman') || nameLower.includes('mountain creek')
        ))
      );
      
      // Skip unnamed small water features (only keep major tagged ones)
      if (!name && !isMajorFeature) {
        skippedTooSmall++;
        continue;
      }

      // Enhanced type detection - prioritize actual water bodies
      let type = "Water Body";
      let priority = 3; // Default priority (lower number = higher priority)
      
      // Major lakes and reservoirs get highest priority
      if (tags.landuse === "reservoir" || tags.water === "reservoir" || nameLower.includes("reservoir")) {
        type = "Reservoir";
        priority = 1;
      } else if (tags.place === "reservoir") {
        type = "Reservoir";  
        priority = 1;
      } else if (tags.water === "lake" || tags.place === "lake" || nameLower.includes("lake")) {
        type = "Lake";
        priority = 1;
      } else if (tags.waterway === "river") {
        type = "River";
        priority = 2;
      } else if (nameLower.includes("pond")) {
        type = "Pond";
        priority = 4;
      } else if (tags.natural === "water") {
        // Default for natural=water
        type = "Lake";
        priority = 2;
      }

      // Boost priority for well-known major lakes and reservoirs
      if (nameLower.includes('lewisville') || nameLower.includes('white rock') || 
          nameLower.includes('trinity') || nameLower.includes('grapevine') ||
          nameLower.includes('arlington') || nameLower.includes('ray hubbard') ||
          nameLower.includes('bachman') || nameLower.includes('mountain creek') ||
          nameLower.includes('caddo') || nameLower.includes('texoma') ||
          nameLower.includes('joe pool') || nameLower.includes('cedar creek')) {
        priority = 0; // Highest priority
      }

      const waterBody = {
        name: name.trim(),
        type: type,
        lat: elementLat,
        lng: elementLng,
        distanceMiles: Math.round(distance * 10) / 10,
        areaKm2: null, // We can't calculate without bounds
        access: tags.access || 'unknown',
        operator: tags.operator || null,
        priority: priority // For sorting by importance
      };

      // Add public land information if available
      if (publicOnly && publicLandsData.elements?.length > 0) {
        let minPublicDistance = Infinity;
        let closestPublicLand = null;

        for (const publicEl of publicLandsData.elements) {
          const publicTags = publicEl.tags || {};
          let publicLat, publicLng;

          if (publicEl.center) {
            publicLat = publicEl.center.lat;
            publicLng = publicEl.center.lon;
          } else if (publicEl.bounds) {
            const bounds = publicEl.bounds;
            publicLat = (bounds.minlat + bounds.maxlat) / 2;
            publicLng = (bounds.minlon + bounds.maxlon) / 2;
          } else if (publicEl.lat && publicEl.lon) {
            publicLat = publicEl.lat;
            publicLng = publicEl.lon;
          } else {
            continue;
          }

          const publicDistance = distanceMiles(elementLat, elementLng, publicLat, publicLng);
          if (publicDistance < minPublicDistance) {
            minPublicDistance = publicDistance;
            closestPublicLand = {
              name: publicTags.name || publicTags.official_name || 'Public Land',
              type: publicTags.boundary || publicTags.leisure || 'public',
              distanceMiles: Math.round(publicDistance * 100) / 100
            };
          }
        }

        // Only include if within reasonable distance of public land (0.3 miles)
        if (minPublicDistance <= 0.3 && closestPublicLand) {
          waterBody.publicLand = closestPublicLand;
          waterBodies.push(waterBody);
        }
      } else {
        // Include all water bodies if not filtering for public only
        waterBodies.push(waterBody);
      }
    }

    // Deduplication - group nearby segments of same water body
    const deduplicatedBodies = [];
    const seenNames = new Set();
    
    for (const waterBody of waterBodies) {
      const baseName = waterBody.name.toLowerCase()
        .replace(/\s+(lake|river|creek|reservoir|pond)\s*$/, '') // Remove common suffixes for grouping
        .trim();
      
      // Check if we already have this water body or a very similar one
      const existingIndex = deduplicatedBodies.findIndex(existing => {
        const existingBaseName = existing.name.toLowerCase()
          .replace(/\s+(lake|river|creek|reservoir|pond)\s*$/, '')
          .trim();
        
        // Group if same base name and within 2 miles of each other
        if (existingBaseName === baseName) {
          const distance = distanceMiles(waterBody.lat, waterBody.lng, existing.lat, existing.lng);
          return distance <= 2;
        }
        return false;
      });
      
      if (existingIndex >= 0) {
        // Keep the closer one or the one with better type
        const existing = deduplicatedBodies[existingIndex];
        const shouldReplace = (
          waterBody.distanceMiles < existing.distanceMiles || 
          (waterBody.priority < existing.priority && Math.abs(waterBody.distanceMiles - existing.distanceMiles) < 1)
        );
        
        if (shouldReplace) {
          deduplicatedBodies[existingIndex] = waterBody;
        }
      } else {
        deduplicatedBodies.push(waterBody);
      }
    }

    // Enhanced sorting - priority-based with major lakes first
    deduplicatedBodies.sort((a, b) => {
      // First sort by priority (0 = highest priority)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      
      // Then prioritize public access
      const publicScore = (wb) => {
        if (wb.publicLand) return 10;
        if (wb.access === 'public') return 5;
        return 0;
      };
      
      const publicScoreA = publicScore(a);
      const publicScoreB = publicScore(b);
      
      if (publicScoreA !== publicScoreB) {
        return publicScoreB - publicScoreA;
      }
      
      // Finally sort by distance
      return a.distanceMiles - b.distanceMiles;
    });

    // Clean results - remove priority field before returning
    const results = deduplicatedBodies.slice(0, 20).map(wb => {
      const { priority, ...result } = wb;
      return result;
    });
    
    logger.info(`🔍 DEBUG: Skipped ${skippedNoName} elements (no name), ${skippedNoCoords} elements (no coords)`);
    logger.info(`✅ Returning ${results.length} REAL water bodies${publicOnly ? ' on public lands' : ''} (deduplicated from ${waterBodies.length})`);
    if (results.length > 0) {
      logger.info(`🎯 Top result: ${results[0].name} (${results[0].type}) - ${results[0].distanceMiles}mi${results[0].areaKm2 ? ` [${results[0].areaKm2}km²]` : ''}${results[0].publicLand ? ` [${results[0].publicLand.name}]` : ''}`);
    }

    const responseData = {
      success: true,
      location: { lat, lng, radiusKm: radius },
      waterBodies: results,
      publicOnly: publicOnly,
      timestamp: new Date().toISOString(),
      cached: false
    };

    // Store in cache
    waterBodyCache.set(cacheKey, {
      data: responseData,
      timestamp: Date.now()
    });
    logger.info(`💾 Cached result for ${cacheKey} (${waterBodyCache.size} total entries)`);

    res.json(responseData);

  } catch (error) {
    logger.error("❌ nearbyWater error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message
    });
  }
});

module.exports = router;