/**
 * Kortex Public Route Handlers — redirect + resolve logic
 * Extracted from publicRouter.js for primer compliance.
 *
 * @module api/kortex/publicRouteHandlers
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const db = admin.firestore();

const { handleRedirect, checkLinkExists } = require('./redirectHandler');
const { resolveContext } = require('./attributionService');

// ─── Legacy location helpers (absorbed from deepLinks) ──
const LEGACY_LOCATIONS = {
  torch789:  { name: 'Torch Lake', lat: 44.0, lon: -85.0 },
  tahoe123:  { name: 'Lake Tahoe', lat: 39.0968, lon: -120.0324 },
  antero456: { name: 'Antero Reservoir', lat: 38.9, lon: -106.2 },
  antero:    { name: 'Antero Reservoir', lat: 38.9, lon: -106.2 }
};

async function resolveLocationContext(locationId) {
  try {
    const snapshot = await db.collection('paddlingOutSpots').get();
    for (const doc of snapshot.docs) {
      const d = doc.data();
      if (doc.id === locationId || (d.name || '').toLowerCase().replace(/\s+/g, '') === locationId.toLowerCase()) {
        return { id: doc.id, name: d.name, lat: d.coordinates?.latitude, lon: d.coordinates?.longitude, type: 'paddling_location' };
      }
    }
    const legacy = LEGACY_LOCATIONS[locationId];
    if (legacy) return { id: locationId, name: legacy.name, lat: legacy.lat, lon: legacy.lon, type: 'legacy_location' };
    return null;
  } catch (err) {
    console.error('[Kortex] Location lookup error:', err);
    return null;
  }
}

// ─── GET /l/:id — unified redirect ─────────────────────
async function redirectHandler(req, res) {
  const code = req.params.id;

  // Priority 1 — Kortex smart link
  const linkCheck = await checkLinkExists(code);
  if (linkCheck.exists) return handleRedirect(req, res, code, { trackAnalytics: true });

  // Priority 2 — Legacy location link
  const location = await resolveLocationContext(code);
  if (location) {
    const ctxToken = crypto.randomUUID();
    db.collection('ctx_tokens').doc(ctxToken).set({
      ctxId: ctxToken, linkId: code, space: 'lake',
      params: { id: location.id, name: location.name, lat: location.lat, lon: location.lon },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), claimed: false
    }).catch(err => console.error('[Kortex] ctx_token save error:', err));
    return res.redirect(302, `https://kaayko.com/paddlingout?id=${code}&_kctx=${ctxToken}`);
  }

  // 404
  return res.status(404).send(`<!DOCTYPE html><html><head><title>Link Not Found | Kaayko</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#0a0a0a;color:#fff}
    a{color:#D4A84B;text-decoration:none}</style></head>
    <body><h2>🔍 Link Not Found</h2><p>The link "${code}" doesn't exist.</p>
    <a href="https://kaayko.com">Go to Kaayko →</a></body></html>`);
}

// ─── GET /resolve — context restoration + attribution ───
async function resolve(req, res) {
  try {
    const { clickId, deviceId, platform, appVersion, userId } = req.query;

    // New attribution flow
    if (clickId || deviceId) {
      const result = await resolveContext({ clickId, deviceId, platform, appVersion, userId,
        metadata: { userAgent: req.get('user-agent'), ip: req.ip || req.connection.remoteAddress } });
      return res.json(result);
    }

    // Legacy cookie / ctx_token flow
    const ctxId = req.query.id || (req.cookies && req.cookies.kaayko_ctxid) || (req.cookies && req.cookies.kaayko_lake_id);
    const cachedLocation = req.cookies && req.cookies.kaayko_location;

    if (cachedLocation) {
      try {
        const locationData = JSON.parse(cachedLocation);
        return res.json({ success: true, source: 'cache', attributed: false, context: locationData, timestamp: new Date().toISOString() });
      } catch (e) { console.error('[PublicLink] Cache parse error:', e); }
    }

    if (ctxId) {
      try {
        const ctxDoc = await db.collection('ctx_tokens').doc(ctxId).get();
        if (ctxDoc.exists) {
          return res.json({ success: true, source: 'database', attributed: false, context: ctxDoc.data().params, timestamp: new Date().toISOString() });
        }
      } catch (dbError) { console.error('[PublicLink] Database error:', dbError); }
    }

    return res.status(404).json({ success: false, source: 'not_found', attributed: false, error: 'Context not found',
      message: 'App opened without attribution context. This is normal for organic installs.', ctxId: ctxId || 'none', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[PublicLink] Resolve error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
}

module.exports = { redirectHandler, resolve };
