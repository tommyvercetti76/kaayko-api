/**
 * KaleKutz — Fitbit OAuth + sync
 *
 * GET  /api/kutz/fitbit/auth        → redirects to Fitbit OAuth (requires auth)
 * GET  /api/kutz/fitbit/callback    → Fitbit redirects here (no auth — public)
 * POST /api/kutz/fitbit/sync        → sync today's steps + calories (requires auth)
 * GET  /api/kutz/fitbit/status      → check connection status (requires auth)
 * POST /api/kutz/fitbit/disconnect  → remove stored tokens (requires auth)
 *
 * Setup required (in functions/.env):
 *   FITBIT_CLIENT_ID=your_fitbit_app_client_id
 *   FITBIT_CLIENT_SECRET=your_fitbit_app_client_secret
 *   FITBIT_REDIRECT_URI=https://api-vwcc5j4qda-uc.a.run.app/kutz/fitbit/callback
 *
 * Register your Fitbit app at: https://dev.fitbit.com/apps/new
 *   - OAuth 2.0 Application Type: Server
 *   - Callback URL: https://api-vwcc5j4qda-uc.a.run.app/kutz/fitbit/callback
 *   - Scopes needed: activity, heartrate, profile
 */

const admin = require('firebase-admin');
const db    = admin.firestore();

const crypto        = require('crypto');
const CLIENT_ID     = process.env.FITBIT_CLIENT_ID;
const CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET;
const REDIRECT_URI  = process.env.FITBIT_REDIRECT_URI
  || 'https://api-vwcc5j4qda-uc.a.run.app/kutz/fitbit/callback';
const APP_RETURN    = 'https://kaaykostore.web.app/kutz';

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── OAuth state ───────────────────────────────────────────────────────────────
// The state used to be base64(uid): anyone could start the flow with another
// user's uid and bind their own Fitbit tokens to that account. It is now a
// signed, expiring payload; the callback only trusts a uid it can verify.
const STATE_TTL_MS = 10 * 60 * 1000;
function stateKey() {
  return crypto.createHmac('sha256', CLIENT_SECRET || 'fitbit-unconfigured').update('kaayko-fitbit-oauth-state').digest();
}
function signState(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, n: crypto.randomBytes(8).toString('hex'), exp: Date.now() + STATE_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
/** @returns {string|null} the uid the state was minted for, or null */
function readState(state) {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!data || typeof data.uid !== 'string' || !data.uid || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
  return data.uid;
}

// ── Token storage ─────────────────────────────────────────────────────────────
// Tokens live in users/{uid}/kutzPrivate/fitbit, which firestore.rules denies to
// every client. They used to sit in kutzProfile/fitbit, which the signed-in user
// can read — a leaked refresh token is a standing grant to their Fitbit data.
// A legacy doc is moved across the first time it is needed.
const privateRef = (uid) => db.collection('users').doc(uid).collection('kutzPrivate').doc('fitbit');
const legacyRef  = (uid) => db.collection('users').doc(uid).collection('kutzProfile').doc('fitbit');
async function loadFitbit(uid) {
  const snap = await privateRef(uid).get();
  if (snap.exists) return snap.data();
  const legacy = await legacyRef(uid).get();
  if (!legacy.exists) return null;
  const data = legacy.data();
  await privateRef(uid).set(data);
  await legacyRef(uid).delete();
  return data;
}

function basicAuth() {
  return Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

async function refreshAccessToken(uid, refreshToken) {
  const resp = await fetch('https://api.fitbit.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth()}`,
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const tokens = await resp.json();

  await privateRef(uid)
    .update({
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt:    Date.now() + tokens.expires_in * 1000,
    });

  return tokens.access_token;
}

// ── Initiate OAuth ────────────────────────────────────────────────────────────

async function fitbitAuth(req, res) {
  if (!CLIENT_ID) {
    return res.status(501).json({
      success: false,
      error:   'Fitbit not configured',
      message: 'Add FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET to functions/.env',
    });
  }

  const uid   = req.user.uid;
  const state = signState(uid);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         'activity heartrate profile',
    state,
    expires_in:    '604800', // 1 week token lifetime
  });

  return res.redirect(`https://www.fitbit.com/oauth2/authorize?${params}`);
}

// ── OAuth Callback (no auth middleware — called by Fitbit) ────────────────────

async function fitbitCallback(req, res) {
  const { code, state, error } = req.query;

  if (error || !code || !state) {
    return res.redirect(`${APP_RETURN}?fitbit=error&reason=${encodeURIComponent(error || 'missing_code')}`);
  }

  try {
    const uid = readState(state);
    if (!uid) throw new Error('Invalid state');

    // Exchange authorization code for tokens
    const tokenResp = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth()}`,
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error('[fitbit/callback] token exchange failed:', err);
      return res.redirect(`${APP_RETURN}?fitbit=error&reason=token_exchange`);
    }

    const tokens = await tokenResp.json();

    // Store tokens securely in Firestore
    await privateRef(uid)
      .set({
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token,
        fitbitUserId: tokens.user_id,
        expiresAt:    Date.now() + tokens.expires_in * 1000,
        connectedAt:  Date.now(),
      });

    return res.redirect(`${APP_RETURN}?fitbit=connected`);

  } catch (e) {
    console.error('[fitbit/callback] error:', e.message);
    return res.redirect(`${APP_RETURN}?fitbit=error&reason=server_error`);
  }
}

// ── Sync Today's Data ─────────────────────────────────────────────────────────

async function fitbitSync(req, res) {
  const uid = req.user.uid;

  try {
    const fitbitData = await loadFitbit(uid);

    if (!fitbitData) {
      return res.status(404).json({
        success: false,
        error:   'Fitbit not connected',
        code:    'FITBIT_NOT_CONNECTED',
      });
    }

    let { accessToken, refreshToken, expiresAt } = fitbitData;

    // Auto-refresh if token is within 60 seconds of expiry
    if (Date.now() >= expiresAt - 60_000) {
      try {
        accessToken = await refreshAccessToken(uid, refreshToken);
      } catch {
        return res.status(401).json({
          success: false,
          error:   'Fitbit session expired. Please reconnect.',
          code:    'FITBIT_REAUTH_REQUIRED',
        });
      }
    }

    // Fetch today's activity summary from Fitbit
    const today   = new Date().toISOString().slice(0, 10);
    const actResp = await fetch(
      `https://api.fitbit.com/1/user/-/activities/date/${today}.json`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!actResp.ok) {
      return res.status(502).json({
        success: false,
        error:   'Fitbit API error',
        code:    'FITBIT_API_ERROR',
      });
    }

    const actData = await actResp.json();
    const summary = actData.summary || {};

    const steps         = summary.steps              || 0;
    const fitbitCalories = summary.caloriesOut       || 0;
    const activeMinutes = (summary.fairlyActiveMinutes || 0)
                        + (summary.veryActiveMinutes   || 0);
    const restingHR     = summary.restingHeartRate   || null;

    // Update today's day document
    await db.collection('users').doc(uid)
      .collection('kutzDays').doc(today)
      .set({
        steps,
        fitbitCalories,
        activeMinutes,
        restingHeartRate: restingHR,
        fitbitSyncedAt:   Date.now(),
        updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

    return res.json({
      success: true,
      data:    { steps, fitbitCalories, activeMinutes, restingHR, date: today },
    });

  } catch (e) {
    console.error('[fitbit/sync] error:', e.message);
    return res.status(500).json({
      success: false,
      error:   'Sync failed',
      message: 'Unable to sync Fitbit data. Please try again.',
      code:    'SYNC_ERROR',
    });
  }
}

// ── Connection Status ─────────────────────────────────────────────────────────

async function fitbitStatus(req, res) {
  const uid = req.user.uid;

  try {
    const data = await loadFitbit(uid);

    if (!data) {
      return res.json({ success: true, data: { connected: false } });
    }

    const { expiresAt, connectedAt } = data;
    const tokenExpired = Date.now() >= expiresAt;

    return res.json({
      success: true,
      data:    { connected: true, tokenExpired, connectedAt },
    });

  } catch (e) {
    return res.status(500).json({ success: false, error: 'Status check failed' });
  }
}

// ── Disconnect ────────────────────────────────────────────────────────────────

async function fitbitDisconnect(req, res) {
  const uid = req.user.uid;

  try {
    await Promise.all([privateRef(uid).delete(), legacyRef(uid).delete()]);

    return res.json({ success: true });

  } catch (e) {
    return res.status(500).json({ success: false, error: 'Disconnect failed' });
  }
}

module.exports = { fitbitAuth, fitbitCallback, fitbitSync, fitbitStatus, fitbitDisconnect };

// ── Initiate (returns JSON auth URL for frontend redirect) ────────────────────
async function fitbitInitiate(req, res) {
  if (!CLIENT_ID) {
    return res.status(501).json({
      success: false,
      error:   'Fitbit not configured',
      message: 'Add FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET to functions/.env',
    });
  }

  const uid   = req.user.uid;
  const state = signState(uid);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         'activity heartrate profile',
    state,
    expires_in:    '604800',
  });

  return res.json({
    success: true,
    data:    { authUrl: `https://www.fitbit.com/oauth2/authorize?${params}` },
  });
}

module.exports = { fitbitAuth, fitbitInitiate, fitbitCallback, fitbitSync, fitbitStatus, fitbitDisconnect };
