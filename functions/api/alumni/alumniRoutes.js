/**
 * Alumni Routes — Anonymous Interest / Vote Collection
 *
 * Mounted at /alumni in index.js.
 *
 * IMPORTANT: Campaign links are ONLY created through the KORTEX UI
 * (create-kortex-link.html). This router only handles vote submissions and admin reads.
 *
 * Public endpoints:
 *   GET  /alumni/vote-count             Fuzzed live count (no auth, 10-min cache)
 *   POST /alumni/interest               Submit anonymous vote (visit token required)
 *   GET  /alumni/interest/:editToken    Get own submission (for thank-you page)
 *   PUT  /alumni/interest/:editToken    Update own submission
 *   POST /alumni/interest/verify-email  Send OTP to optional email
 *   POST /alumni/interest/verify-otp    Verify OTP → upgrades trust score
 *
 * Admin endpoints (require Firebase auth + admin role):
 *   GET  /alumni/admin/leads           Paginated lead list with bucket filter
 *   GET  /alumni/admin/stats           Aggregated counts
 */

'use strict';

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');

const { verifyVisitToken, consumeVisitToken } = require('./visitTokenService');
const {
  createLead,
  updateLead,
  sendEmailOtp,
  verifyEmailOtp,
  getLeadByEditToken,
  adminListLeads,
  adminStats,
} = require('./alumniService');

const { requireAuth, requireAdmin } = require('../../middleware/authMiddleware');
const { secureHeaders, rateLimiter } = require('../../middleware/securityMiddleware');
const { generateReportKey, validateReportKey } = require('./reportKeyService');

router.use(secureHeaders);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function hashIp(ip) {
  const crypto = require('crypto');
  const secret = process.env.ALUMNI_TOKEN_SECRET || process.env.KORTEX_SYNC_KEY || '';
  return crypto.createHash('sha256').update(ip + secret).digest('hex').slice(0, 16);
}

/** Simple input sanitiser — strips control chars, trims */
function sanitize(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

const ALLOWED_INTEREST = ['join', 'volunteer', 'donate_later', 'mentor', 'advisory', 'stay_updated'];
const ALLOWED_RELATIONSHIP = ['alumnus', 'parent', 'teacher', 'friend'];

/**
 * Validate anonymous vote payload.
 * Only interestType is required. Everything else is optional enrichment.
 * Returns { data, errors }.
 */
function validateVoteForm(body) {
  const errors = [];

  // Honeypot: must be absent / empty
  if (body._hp) errors.push('bot_detected');

  const rawInterest = Array.isArray(body.interestType)
    ? body.interestType
    : (body.interestType ? [body.interestType] : []);
  const interestType = rawInterest.filter(t => ALLOWED_INTEREST.includes(t));
  if (!interestType.length) errors.push('at least one interest required');

  const name    = sanitize(body.name    || '').slice(0, 100);
  const email   = sanitize(body.email   || '').slice(0, 200);
  const phone   = sanitize(body.phone   || '').slice(0, 30);
  const batch   = sanitize(String(body.batch || '')).slice(0, 10);
  const city    = sanitize(body.city    || '').slice(0, 100);
  const country = sanitize(body.country || '').slice(0, 100);
  const comment = sanitize(body.comment || '').slice(0, 2000);
  const fpHash  = sanitize(body.fpHash  || '').slice(0, 64);

  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.push('email format invalid');
  }

  const relationship = ALLOWED_RELATIONSHIP.includes(body.relationship)
    ? body.relationship : 'alumnus';

  return {
    data: { name, email, phone, batch, city, country, relationship, interestType, comment, fpHash },
    errors,
  };
}

// ── GET /alumni/vote-count ────────────────────────────────────────────────────
// Public, cached 10 minutes. Returns fuzzed counts for anti-gaming.

const VOTE_COUNT_CACHE = { data: null, ts: 0 };
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const db = admin.firestore();

router.get('/vote-count', async (req, res) => {
  try {
    const now = Date.now();

    if (VOTE_COUNT_CACHE.data && (now - VOTE_COUNT_CACHE.ts) < CACHE_TTL_MS) {
      return res.json(VOTE_COUNT_CACHE.data);
    }

    const INTEREST_TYPES = ['join', 'volunteer', 'donate_later', 'mentor', 'advisory', 'stay_updated'];

    const [totalSnap, ...breakdownSnaps] = await Promise.all([
      db.collection('alumni_leads').count().get(),
      ...INTEREST_TYPES.map(t =>
        db.collection('alumni_leads')
          .where('interestType', 'array-contains', t)
          .count()
          .get()
      ),
    ]);

    const total = totalSnap.data().count;
    const breakdown = {};
    INTEREST_TYPES.forEach((t, i) => {
      breakdown[t] = breakdownSnaps[i].data().count;
    });

    const batchSnap = await db.collection('alumni_leads').select('batch').limit(500).get();
    const batches   = new Set(batchSnap.docs.map(d => d.data().batch).filter(Boolean)).size;

    function fuzz(n) {
      if (n < 5)  return null;
      if (n < 20) return n;
      return Math.round(n / 5) * 5;
    }

    // Look up voting deadline from the src link (best-effort)
    let deadline = null;
    const srcCode = sanitize(req.query.src || '');
    if (srcCode && /^[a-zA-Z0-9_-]{3,20}$/.test(srcCode)) {
      try {
        const linkDoc = await db.collection('short_links').doc(srcCode).get();
        if (linkDoc.exists) {
          const ld = linkDoc.data();
          deadline = ld.metadata?.votingDeadline || null;
          if (!deadline && ld.expiresAt) {
            deadline = (ld.expiresAt.toDate ? ld.expiresAt.toDate() : new Date(ld.expiresAt)).toISOString();
          }
        }
      } catch (_) { /* non-blocking */ }
    }

    const payload = {
      success:   true,
      total:     fuzz(total),
      fuzzy:     total < 5,
      breakdown: Object.fromEntries(
        Object.entries(breakdown).map(([k, v]) => [k, fuzz(v)])
      ),
      batches:   batches || null,
      deadline,
      updatedAt: new Date(now).toISOString(),
    };

    VOTE_COUNT_CACHE.data = payload;
    VOTE_COUNT_CACHE.ts   = now;

    return res.json(payload);

  } catch (err) {
    console.error('[Alumni] vote-count error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── POST /alumni/interest ────────────────────────────────────────────────────

router.post('/interest', async (req, res) => {
  try {
    // 1. Verify visit token
    const rawToken = req.body.vtok || req.headers['x-alumni-vtok'];
    const tokenResult = verifyVisitToken(rawToken);
    if (!tokenResult.valid) {
      return res.status(403).json({
        success: false,
        error: 'invalid_visit_token',
        message: 'Your link has expired or is invalid. Please use the original link.',
      });
    }

    // 2. Consume the token (single-use)
    try {
      await consumeVisitToken(tokenResult.vid);
    } catch (consumeErr) {
      if (consumeErr.code === 'ALREADY_USED') {
        return res.status(409).json({
          success: false,
          error: 'token_already_used',
          message: 'This link has already been used. Each link can only be used once.',
        });
      }
      throw consumeErr;
    }

    // 3. Validate (anonymous — only interestType is required)
    const { data, errors } = validateVoteForm(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, errors });
    }

    // 4. Create lead
    const ip_hash = hashIp(getClientIp(req));
    const result  = await createLead(data, tokenResult.data, ip_hash);

    // Bust vote cache so next poll reflects this submission
    VOTE_COUNT_CACHE.ts = 0;

    return res.status(result.duplicate ? 200 : 201).json({
      success:   true,
      editToken: result.editToken,
      score:     result.score,
      bucket:    result.bucket,
      duplicate: result.duplicate,
    });

  } catch (err) {
    console.error('[Alumni] POST /interest error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── POST /alumni/interest/verify-email ──────────────────────────────────────

router.post('/interest/verify-email', async (req, res) => {
  try {
    const editToken = sanitize(req.body.editToken || '');
    if (!editToken) return res.status(400).json({ success: false, error: 'editToken required' });

    await sendEmailOtp(editToken);
    return res.json({ success: true, message: 'OTP sent' });

  } catch (err) {
    if (['BAD_TOKEN', 'TOKEN_EXPIRED', 'NOT_FOUND', 'NO_EMAIL'].includes(err.code)) {
      return res.status(err.code === 'NO_EMAIL' ? 400 : 403).json({ success: false, error: err.code });
    }
    console.error('[Alumni] verify-email error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── POST /alumni/interest/verify-otp ────────────────────────────────────────

router.post('/interest/verify-otp', async (req, res) => {
  try {
    const editToken = sanitize(req.body.editToken || '');
    const code      = sanitize(String(req.body.code || ''));

    if (!editToken || !code) {
      return res.status(400).json({ success: false, error: 'editToken and code required' });
    }

    const result = await verifyEmailOtp(editToken, code);
    return res.json({ success: true, ...result });

  } catch (err) {
    if (['BAD_TOKEN', 'TOKEN_EXPIRED', 'INVALID_OTP', 'OTP_EXPIRED'].includes(err.code)) {
      return res.status(403).json({ success: false, error: err.code });
    }
    console.error('[Alumni] verify-otp error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── GET /alumni/interest/:editToken ─────────────────────────────────────────

router.get('/interest/:editToken', async (req, res) => {
  try {
    const lead = await getLeadByEditToken(sanitize(req.params.editToken));
    return res.json({ success: true, lead });
  } catch (err) {
    if (['BAD_TOKEN', 'TOKEN_EXPIRED', 'NOT_FOUND'].includes(err.code)) {
      return res.status(404).json({ success: false, error: err.code });
    }
    console.error('[Alumni] GET /interest/:editToken error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── PUT /alumni/interest/:editToken ─────────────────────────────────────────

router.put('/interest/:editToken', async (req, res) => {
  try {
    const result = await updateLead(sanitize(req.params.editToken), req.body);
    return res.json({ success: true, ...result });
  } catch (err) {
    if (['BAD_TOKEN', 'TOKEN_EXPIRED', 'NOT_FOUND', 'NO_OP'].includes(err.code)) {
      return res.status(err.code === 'NO_OP' ? 400 : 404).json({ success: false, error: err.code });
    }
    console.error('[Alumni] PUT /interest/:editToken error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── GET /alumni/report  (report key — no login needed) ──────────────────────
// Validates the rk= param, returns scoped stats + paginated lead list.
// Sensitive fields (ip_hash, fraudFlags, editToken) are stripped.

router.get('/report', rateLimiter(), async (req, res) => {
  try {
    const rk = sanitize(req.query.rk || '');
    let keyData;
    try {
      keyData = await validateReportKey(rk);
    } catch (kErr) {
      const status = kErr.code === 'KEY_EXPIRED' ? 410 : 403;
      return res.status(status).json({ success: false, error: kErr.code || 'bad_key' });
    }

    // Admin links (isAdmin metadata) should show all leads — no scope filter.
    // Detect this by checking the originating link.
    let sourceGroup = keyData.sourceGroup;
    let sourceBatch = keyData.sourceBatch;
    let isAdminView = false;
    if (keyData.linkCode) {
      try {
        const linkDoc = await db.collection('short_links').doc(keyData.linkCode).get();
        if (linkDoc.exists && linkDoc.data().metadata?.isAdmin) {
          sourceGroup = null;
          sourceBatch = null;
          isAdminView = true;
        }
      } catch (_) { /* non-blocking — worst case keeps the scoped view */ }
    }

    const INTEREST_TYPES = ['join', 'volunteer', 'donate_later', 'mentor', 'advisory', 'stay_updated'];
    const STRIP = ['ip_hash', 'fpHash', 'fraudFlags', 'fraudPenalty', 'editToken', 'visitId'];

    // Fetch all leads (up to 500) + all alumni campaign links in parallel.
    // All filtering and stats are computed in-memory to avoid composite index requirements.
    const [leadsSnap, linksSnap] = await Promise.all([
      db.collection('alumni_leads').limit(500).get(),
      db.collection('short_links').limit(200).get(),
    ]);

    const enabledAlumniLinkDocs = linksSnap.docs
      .filter(d => d.data().metadata?.campaign === 'alumni')
      .filter(d => d.data().enabled !== false);

    const enabledAlumniLinkCodes = new Set(enabledAlumniLinkDocs.map(d => d.id));

    const allDocs = leadsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(doc => {
        if (sourceGroup && doc.sourceGroup !== sourceGroup) return false;
        if (sourceBatch && doc.sourceBatch !== String(sourceBatch)) return false;
        if (doc.linkCode && !enabledAlumniLinkCodes.has(doc.linkCode)) return false;
        return true;
      })
      .sort((a, b) => {
        const aMs = a.createdAt?.toMillis?.() ?? (a.createdAt?._seconds * 1000) ?? 0;
        const bMs = b.createdAt?.toMillis?.() ?? (b.createdAt?._seconds * 1000) ?? 0;
        return bMs - aMs;
      });

    // Per-link stats (enabled alumni campaign links only)
    const alumniLinks = enabledAlumniLinkDocs
      .map(d => {
        const ld = d.data();
        const linkLeads = allDocs.filter(lead => lead.linkCode === d.id);
        const linkInterests = Object.fromEntries(INTEREST_TYPES.map(t => [t, 0]));
        for (const lead of linkLeads) {
          const ints = Array.isArray(lead.interestType) ? lead.interestType : [];
          for (const t of ints) { if (linkInterests[t] !== undefined) linkInterests[t]++; }
        }
        const submissions = linkLeads.length;
        const consumedClicks = Number(ld.uniqueVisitCount ?? 0);
        return {
          code:          d.id,
          title:         ld.title || d.id,
          consumedClicks,
          submissions,
          // Backward-compatible aliases for any older clients
          clicks: consumedClicks,
          votes: submissions,
          interests:     linkInterests,
          conversionPct: consumedClicks > 0 ? Math.round((submissions / consumedClicks) * 100) : 0,
          maxUses:       ld.metadata?.maxUses ?? null,
          enabled:       ld.enabled !== false,
          createdAt:     ld.createdAt?.toMillis?.() ?? null,
        };
      })
      .sort((a, b) => b.submissions - a.submissions || b.consumedClicks - a.consumedClicks);

    // Overall stats computed in-memory
    const total      = allDocs.length;
    const breakdown  = Object.fromEntries(INTEREST_TYPES.map(t => [t, 0]));
    const buckets    = { verified: 0, medium: 0, low: 0, flagged: 0 };
    const batchDist  = {};

    for (const doc of allDocs) {
      const interests = Array.isArray(doc.interestType) ? doc.interestType : [];
      for (const t of interests) {
        if (breakdown[t] !== undefined) breakdown[t]++;
      }
      if (doc.bucket === 'verified')               buckets.verified++;
      else if (doc.bucket === 'medium_confidence') buckets.medium++;
      else if (doc.bucket === 'low_confidence')    buckets.low++;
      if (doc.fraudPenalty > 0)                    buckets.flagged++;
      const b = (doc.batch || '').trim();
      if (b) batchDist[b] = (batchDist[b] || 0) + 1;
    }

    // Paginate the visible leads list
    const PAGE_SIZE = Math.min(parseInt(req.query.limit || '50', 10), 100);
    let startIdx = 0;
    if (req.query.startAfter) {
      const idx = allDocs.findIndex(d => d.id === req.query.startAfter);
      if (idx !== -1) startIdx = idx + 1;
    }
    const pageDocs = allDocs.slice(startIdx, startIdx + PAGE_SIZE);
    const leads = pageDocs.map(doc => {
      const data = { ...doc };
      STRIP.forEach(k => delete data[k]);
      return data;
    });

    return res.json({
      success:  true,
      isAdminView,
      key: {
        label:       keyData.label,
        sourceGroup,
        sourceBatch,
        expiresAt:   keyData.expiresAt,
        viewCount:   keyData.viewCount,
      },
      stats: { total, breakdown, buckets, batchDist },
      links: alumniLinks,
      leads,
      hasMore: startIdx + PAGE_SIZE < total,
      lastId:  leads.length ? leads[leads.length - 1].id : null,
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[Alumni] GET /report error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── POST /alumni/report-key  (link-scoped, no login) ───────────────────────────
// Creates a report key scoped to the given alumni campaign link.
// Requires only the linkCode — the person who just created the link has it.
// This is a capability-token pattern: possessing the linkCode proves creation.
// Report keys are read-only; no write access is granted.

router.post('/report-key', rateLimiter(), async (req, res) => {
  try {
    const linkCode = sanitize(req.body.linkCode || '');
    if (!linkCode || !/^[a-zA-Z0-9_-]{3,20}$/.test(linkCode)) {
      return res.status(400).json({ success: false, error: 'linkCode required' });
    }

    // Verify the link exists and is an alumni campaign
    const linkDoc = await db.collection('short_links').doc(linkCode).get();
    if (!linkDoc.exists) {
      return res.status(404).json({ success: false, error: 'link_not_found' });
    }
    const linkData = linkDoc.data();
    if (linkData.metadata?.campaign !== 'alumni') {
      return res.status(403).json({ success: false, error: 'not_alumni_link' });
    }

    // Idempotent: if a report key already exists for this link, return it
    const existing = await db.collection('alumni_report_keys')
      .where('linkCode', '==', linkCode)
      .limit(1)
      .get();
    if (!existing.empty) {
      const existingData = existing.docs[0].data();
      const reportUrl = `https://kaayko.com/alumni-report?rk=${encodeURIComponent(existingData.key)}`;
      return res.json({ success: true, key: existingData.key, reportUrl, existing: true });
    }

    const sourceGroup = sanitize(linkData.metadata?.sourceGroup || '');
    const sourceBatch = sanitize(String(linkData.metadata?.sourceBatch || ''));
    const label       = sanitize(req.body.label || linkData.title || `Alumni Campaign`);
    const expiresAt   = linkData.expiresAt
      ? (linkData.expiresAt.toDate ? linkData.expiresAt.toDate() : new Date(linkData.expiresAt))
      : null;

    const { key } = await generateReportKey({
      linkCode:    linkCode,
      sourceGroup: sourceGroup || null,
      sourceBatch: sourceBatch || null,
      label:       label.slice(0, 120),
      expiresAt,
    });

    const reportUrl = `https://kaayko.com/alumni-report?rk=${encodeURIComponent(key)}`;
    return res.status(201).json({ success: true, key, reportUrl });

  } catch (err) {
    console.error('[Alumni] POST /report-key error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── Admin: POST /alumni/admin/report-key ─────────────────────────────────────
// Creates a scoped read-only report key. Typically called right after creating
// an alumni campaign link in the KORTEX UI.

router.post('/admin/report-key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sourceGroup  = sanitize(req.body.sourceGroup || '');
    const sourceBatch  = sanitize(String(req.body.sourceBatch || ''));
    const label        = sanitize(req.body.label || sourceGroup || 'Alumni Campaign').slice(0, 120);
    const linkCode     = sanitize(req.body.linkCode || '');
    const expiresInDays = parseInt(req.body.expiresInDays || '0', 10);
    const expiresAt    = expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;

    const { key } = await generateReportKey({
      linkCode:    linkCode    || null,
      sourceGroup: sourceGroup || null,
      sourceBatch: sourceBatch || null,
      label,
      expiresAt,
    });

    const reportUrl = `https://kaayko.com/alumni-report?rk=${encodeURIComponent(key)}`;
    return res.status(201).json({ success: true, key, reportUrl });

  } catch (err) {
    console.error('[Alumni] admin/report-key error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── Admin: GET /alumni/admin/leads ───────────────────────────────────────────

router.get('/admin/leads', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { bucket, limit, startAfter } = req.query;
    const result = await adminListLeads({
      bucket:     bucket || undefined,
      limit:      limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
      startAfter: startAfter || undefined,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Alumni] admin/leads error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// ── Admin: GET /alumni/admin/stats ───────────────────────────────────────────

router.get('/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await adminStats();
    return res.json({ success: true, stats });
  } catch (err) {
    console.error('[Alumni] admin/stats error:', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

module.exports = router;
