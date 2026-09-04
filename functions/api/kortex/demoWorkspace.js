/**
 * The sample workspace: eight real Kortex links, made on the ordinary link
 * service, each pointing at a Kaayko product and each showing one delivered
 * variation (plain link, night/day routing, device routing, scan cap with a
 * fallback, end date, campaign tags, QR-first table tent, safety review).
 *
 * The links are real: scanning one goes through the real redirect to the
 * real product page. Only the click events are synthetic, generated with
 * per-link daily and hourly profiles so the dashboards have something honest
 * to say. The workspace is opened through a read-only session issued by
 * GET /kortex/guest/demo; there is no access code for it.
 *
 * Re-seeding is idempotent: existing demo events are removed and regenerated
 * so the "last 7 days" window is always full. A weekly schedule does this.
 *
 * @module api/kortex/demoWorkspace
 */

'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const LinkService = require('./smartLinkService');
const guest = require('./guestAccess');
const { recordAudit } = require('./auditLog');
const { referrerHostOf, normalizeDestination, destinationKeyOf } = require('./clickTracking');

const DEMO_TENANT_ID = 'g_demo00';
const DAY = 86400000;
const IST_OFFSET_MS = 5.5 * 3600000;

function hashVisitor(seed) {
  return crypto.createHash('sha256').update(`demo-visitor:${seed}`).digest('hex').slice(0, 16);
}

function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function pick(rnd, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}
function hourWeights(peaks) {
  // peaks: [{ h, w, spread }] → 24 weights with a floor
  const out = new Array(24).fill(0.15);
  for (let h = 0; h < 24; h++) {
    for (const p of peaks) {
      const d = Math.min(Math.abs(h - p.h), 24 - Math.abs(h - p.h));
      out[h] += p.w * Math.exp(-(d * d) / (2 * p.spread * p.spread));
    }
  }
  return out;
}

/** The eight reports. Destinations are Kaayko's own products. */
const DEMO_LINKS = [
  {
    code: 'kx-paddle', title: 'Paddling Out · lake poster',
    web: 'https://kaayko.com/paddlingout',
    profile: { total: 640, lifetimeFactor: 1.9, weekend: 1.5, hours: hourWeights([{ h: 8, w: 1, spread: 2 }, { h: 16, w: 1.2, spread: 2.5 }]),
      platform: { ios: 52, android: 40, web: 8 }, country: { IN: 62, US: 22, GB: 5, AU: 4, AE: 3, SG: 2, CA: 2 }, qr: 0.94, repeat: 0.22 }
  },
  {
    code: 'kx-store', title: 'Kaayko Store · shelf tag',
    web: 'https://kaayko.com/store',
    schedule: { timezone: 'Asia/Kolkata', windows: [{ label: 'night', start: '20:00', end: '08:00', url: 'https://kaayko.com/store?after=hours' }] },
    profile: { total: 480, lifetimeFactor: 1.6, weekend: 1.2, hours: hourWeights([{ h: 12, w: 0.8, spread: 2 }, { h: 21, w: 1.4, spread: 2.2 }]),
      platform: { ios: 48, android: 44, web: 8 }, country: { IN: 78, US: 10, AE: 6, GB: 3, SG: 3 }, qr: 0.9, repeat: 0.3 }
  },
  {
    code: 'kx-kutz', title: 'Kutz · app card',
    web: 'https://kaayko.com/kutz', ios: 'https://kaayko.com/kutz?from=iphone', android: 'https://kaayko.com/kutz?from=android',
    profile: { total: 520, lifetimeFactor: 1.7, weekend: 0.9, hours: hourWeights([{ h: 7, w: 1.1, spread: 1.6 }, { h: 19, w: 1, spread: 2.4 }]),
      platform: { ios: 50, android: 36, web: 14 }, country: { IN: 55, US: 30, GB: 6, CA: 4, DE: 3, SG: 2 }, qr: 0.7, repeat: 0.45 }
  },
  {
    code: 'kx-ambazari', title: 'Ambazari Lake · trail sign',
    web: 'https://kaayko.com/paddlingout/ambazari-lake-nagpur',
    limits: { maxClicks: 500, fallbackUrl: 'https://kaayko.com/paddlingout' },
    profile: { total: 300, lifetimeFactor: 1.37, weekend: 1.7, hours: hourWeights([{ h: 6, w: 1.3, spread: 1.5 }, { h: 17, w: 1, spread: 2 }]),
      platform: { ios: 38, android: 56, web: 6 }, country: { IN: 92, US: 4, GB: 2, AE: 2 }, qr: 0.97, repeat: 0.18 }
  },
  {
    code: 'kx-monsoon', title: 'Monsoon paddle flyer',
    web: 'https://kaayko.com/paddlingout/forecast',
    limits: { fallbackUrl: 'https://kaayko.com/paddlingout' }, expiresInDays: 12,
    profile: { total: 360, lifetimeFactor: 1.1, weekend: 1.3, hours: hourWeights([{ h: 9, w: 1, spread: 2.5 }, { h: 20, w: 0.8, spread: 2 }]),
      platform: { ios: 44, android: 46, web: 10 }, country: { IN: 84, US: 8, GB: 4, SG: 2, AE: 2 }, qr: 0.88, repeat: 0.25, burstStart: true }
  },
  {
    code: 'kx-reads', title: 'Newsletter · September reads',
    web: 'https://kaayko.com/reads',
    utm: { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'september-reads' },
    profile: { total: 420, lifetimeFactor: 1.3, weekend: 0.7, hours: hourWeights([{ h: 8, w: 1.6, spread: 1.2 }, { h: 13, w: 0.6, spread: 2 }, { h: 21, w: 0.7, spread: 2 }]),
      platform: { ios: 34, android: 22, web: 44 }, country: { IN: 50, US: 28, GB: 8, CA: 5, AU: 4, DE: 3, SG: 2 }, qr: 0.06, repeat: 0.35,
      referrers: { 'https://mail.google.com/': 55, 'https://outlook.live.com/': 20, null: 25 } }
  },
  {
    code: 'kx-tent', title: 'Table tent · café menu',
    web: 'https://kaayko.com/store',
    profile: { total: 880, lifetimeFactor: 2.4, weekend: 1.35, hours: hourWeights([{ h: 12.5, w: 1.6, spread: 1.3 }, { h: 19.5, w: 1.4, spread: 1.6 }]),
      platform: { ios: 55, android: 41, web: 4 }, country: { IN: 90, US: 5, GB: 2, AE: 2, SG: 1 }, qr: 0.985, repeat: 0.48 }
  },
  {
    code: 'kx-forge', title: 'Forge gallery · print',
    web: 'https://kaayko.com/forge-gallery',
    reviewed: true,
    profile: { total: 260, lifetimeFactor: 1.5, weekend: 1.1, hours: hourWeights([{ h: 11, w: 0.9, spread: 3 }, { h: 22, w: 1, spread: 2.5 }]),
      platform: { ios: 30, android: 18, web: 52 }, country: { US: 38, IN: 28, GB: 12, DE: 7, SG: 5, AU: 4, FR: 3, JP: 3 }, qr: 0.42, repeat: 0.3,
      referrers: { 'https://www.instagram.com/': 30, 'https://t.co/': 15, 'https://www.pinterest.com/': 10, null: 45 } }
  }
];

function db() { return admin.firestore(); }

async function ensureDemoTenant(nowMs) {
  const ref = db().collection('tenants').doc(DEMO_TENANT_ID);
  const snap = await ref.get();
  const unusableSecret = crypto.randomBytes(16).toString('hex'); // never revealed: no code opens this workspace
  const base = {
    id: DEMO_TENANT_ID,
    slug: DEMO_TENANT_ID,
    kind: guest.GUEST_KIND,
    name: 'Sample workspace',
    domain: 'kaayko.com',
    pathPrefix: '/l',
    linkNamespace: 'kaayko',
    plan: 'starter',
    enabled: true,
    demo: true,
    provisionedVia: 'demo-seed',
    settings: { reviewUnknownDomains: false },
    trustedDomains: [],
    updatedAt: FieldValue.serverTimestamp()
  };
  if (!snap.exists) {
    await ref.set({
      ...base,
      guest: {
        accessCodeHash: crypto.createHash('sha256').update(unusableSecret).digest('hex'),
        codeVersion: 1,
        createdAtMs: nowMs,
        lastAccessAtMs: nowMs,
        expiresAtMs: nowMs + 100 * 365 * DAY,
        expired: false,
        failedAttempts: 0,
        lockedUntilMs: 0,
        email: null,
        emailHash: null
      },
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs
    });
  } else {
    await ref.update({ ...base, 'guest.expiresAtMs': nowMs + 100 * 365 * DAY, 'guest.expired': false, 'guest.lastAccessAtMs': nowMs });
  }
  const fresh = await ref.get();
  return { id: fresh.id, ...fresh.data() };
}

async function ensureLink(spec, nowMs) {
  const existing = await db().collection('short_links').doc(spec.code).get();
  const fields = {
    title: spec.title,
    webDestination: spec.web,
    iosDestination: spec.ios || null,
    androidDestination: spec.android || null,
    schedule: spec.schedule || null,
    limits: spec.limits || null,
    utm: spec.utm || {},
    expiresAt: spec.expiresInDays ? new Date(nowMs + spec.expiresInDays * DAY).toISOString() : null
  };
  if (!existing.exists) {
    await LinkService.createShortLink({
      ...fields,
      code: spec.code,
      createdBy: 'demo-seed',
      tenantId: DEMO_TENANT_ID,
      tenantName: 'Sample workspace',
      domain: 'kaayko.com',
      pathPrefix: '/l',
      source: 'qr',
      metadata: { createdVia: 'demo', demo: true }
    });
  } else {
    await LinkService.updateShortLink(spec.code, {
      title: fields.title,
      destinations: { web: fields.webDestination, ios: fields.iosDestination, android: fields.androidDestination },
      schedule: fields.schedule,
      limits: fields.limits,
      utm: fields.utm,
      expiresAt: fields.expiresAt,
      enabled: true
    });
  }
  if (spec.reviewed) {
    // A destination that was held on first sight and approved by a person.
    const heldAt = nowMs - 19 * DAY, approvedAt = nowMs - 18 * DAY + 3 * 3600000;
    await db().collection('short_links').doc(spec.code).update({
      status: 'active',
      'safety.review': { heldAtMs: heldAt, approvedAtMs: approvedAt, reason: 'unknown_domain', approvedBy: 'reviewer' }
    });
    recordAudit({ actor: { name: 'demo-seed' }, action: 'link.held', code: spec.code, tenantId: DEMO_TENANT_ID, extra: { reason: 'unknown_domain', demo: true, atMs: heldAt } });
    recordAudit({ actor: { name: 'demo-seed' }, action: 'link.approved', code: spec.code, tenantId: DEMO_TENANT_ID, extra: { by: 'reviewer', demo: true, atMs: approvedAt } });
  }
  const snap = await db().collection('short_links').doc(spec.code).get();
  return { code: spec.code, ...snap.data() };
}

async function deleteEvents(code) {
  const snap = await db().collection('click_events').where('linkCode', '==', code).get();
  let removed = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db().batch();
    docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
    removed += Math.min(400, docs.length - i);
  }
  return removed;
}

function generateEvents(spec, link, nowMs) {
  const p = spec.profile;
  const rnd = mulberry32(parseInt(crypto.createHash('md5').update(spec.code).digest('hex').slice(0, 8), 16));
  const days = 30;
  // Daily weights: weekday/weekend, a recency lift so the 7-day window is full,
  // and for a flyer a burst when it went up.
  const dayWeights = [];
  for (let d = 0; d < days; d++) {
    const dayMs = nowMs - d * DAY;
    const dow = new Date(dayMs + IST_OFFSET_MS).getUTCDay();
    let w = (dow === 0 || dow === 6) ? p.weekend : 1;
    if (d < 7) w *= 1.55;
    if (p.burstStart && d > 20) w *= 2.2;
    dayWeights.push(w);
  }
  const dayTotal = dayWeights.reduce((s, w) => s + w, 0);
  const visitors = Math.max(20, Math.round(p.total * (1 - p.repeat)));
  const referrerWeights = p.referrers || { null: 100 };
  const nightWin = spec.schedule && spec.schedule.windows && spec.schedule.windows[0];
  const events = [];
  for (let d = 0; d < days; d++) {
    const n = Math.round(p.total * dayWeights[d] / dayTotal);
    for (let i = 0; i < n; i++) {
      const hour = Number(pick(rnd, Object.fromEntries(p.hours.map((w, h) => [h, w]))));
      const minute = Math.floor(rnd() * 60);
      // IST clock → UTC instant
      const dayStartIst = Math.floor((nowMs + IST_OFFSET_MS) / DAY) * DAY - d * DAY;
      const ms = dayStartIst + hour * 3600000 + minute * 60000 + Math.floor(rnd() * 60000) - IST_OFFSET_MS;
      if (ms > nowMs) continue;
      const platform = pick(rnd, p.platform);
      const scanned = rnd() < p.qr;
      const country = pick(rnd, p.country);
      const visitor = hashVisitor(`${spec.code}:${Math.floor(rnd() * visitors)}`);
      const deviceType = platform === 'web' ? (rnd() < 0.82 ? 'desktop' : 'tablet') : 'mobile';
      const os = platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : (rnd() < 0.55 ? 'macOS' : 'Windows');
      const browser = platform === 'ios' ? 'Safari' : platform === 'android' ? 'Chrome' : (rnd() < 0.7 ? 'Chrome' : 'Safari');
      const isNight = nightWin && (hour >= 20 || hour < 8);
      let redirectedTo = (link.destinations && link.destinations.web) || spec.web;
      if (platform === 'ios' && spec.ios) redirectedTo = spec.ios;
      if (platform === 'android' && spec.android) redirectedTo = spec.android;
      if (isNight) redirectedTo = nightWin.url;
      const refKey = scanned ? 'null' : pick(rnd, referrerWeights);
      const referrer = refKey === 'null' ? null : refKey;
      events.push({
        clickId: `demo_${spec.code}_${d}_${i}_${Math.floor(rnd() * 1e6).toString(36)}`,
        linkCode: spec.code,
        tenantId: DEMO_TENANT_ID,
        timestamp: admin.firestore.Timestamp.fromMillis(ms),
        timestampMs: ms,
        schemaVersion: 2,
        delivered: true,
        outcome: 'delivered',
        fallbackReason: null,
        platform,
        deviceInfo: { deviceType, os, browser, parserVersion: 1 },
        geo: { country },
        visitorKey: visitor,
        visitorKeyVersion: 1,
        referrerHost: referrerHostOf(referrer),
        destinationKey: destinationKeyOf({ platform, destinations: { ios: spec.ios, android: spec.android }, scheduleWindow: isNight ? 'night' : null }),
        redirectedTo: normalizeDestination(redirectedTo),
        utm: spec.utm || {},
        installAttributed: false,
        metadata: { source: scanned ? 'qr' : 'link', scheduleWindow: isNight ? 'night' : null },
        expiresAt: admin.firestore.Timestamp.fromMillis(ms + 30 * DAY)
      });
    }
  }
  events.sort((a, b) => a.timestampMs - b.timestampMs);
  return { events, visitors };
}

async function writeEvents(events) {
  for (let i = 0; i < events.length; i += 400) {
    const batch = db().batch();
    events.slice(i, i + 400).forEach(e => batch.set(db().collection('click_events').doc(e.clickId), e));
    await batch.commit();
  }
}

/**
 * Create or refresh the sample workspace. Idempotent.
 */
async function seedDemo({ nowMs = Date.now() } = {}) {
  const tenant = await ensureDemoTenant(nowMs);
  const summary = { tenantId: DEMO_TENANT_ID, links: [], events: 0, ranAt: new Date(nowMs).toISOString() };
  for (const spec of DEMO_LINKS) {
    const link = await ensureLink(spec, nowMs);
    const removed = await deleteEvents(spec.code);
    const { events, visitors } = generateEvents(spec, link, nowMs);
    await writeEvents(events);
    const lifetime = Math.round(events.length * spec.profile.lifetimeFactor);
    const last = events.length ? events[events.length - 1].timestampMs : nowMs;
    await db().collection('short_links').doc(spec.code).update({
      clickCount: lifetime,
      uniqueVisitCount: visitors,
      lastClickedAt: admin.firestore.Timestamp.fromMillis(last),
      updatedAt: FieldValue.serverTimestamp()
    });
    summary.links.push({ code: spec.code, title: spec.title, events: events.length, removed, lifetime });
    summary.events += events.length;
  }
  resetSamplesCache();
  recordAudit({ actor: { name: 'demo-seed' }, action: 'demo.seeded', tenantId: DEMO_TENANT_ID, extra: { events: summary.events, links: summary.links.length } });
  return { ...summary, tenant: { id: tenant.id, name: tenant.name } };
}

async function getDemoTenant() {
  const snap = await db().collection('tenants').doc(DEMO_TENANT_ID).get();
  if (!snap.exists) return null;
  const tenant = { id: snap.id, ...snap.data() };
  return tenant.demo === true && tenant.enabled !== false ? tenant : null;
}

/** A read-only session for the sample workspace (two hours; no code exists). */
async function issueDemoSession() {
  const tenant = await getDemoTenant();
  if (!tenant) return null;
  const { links } = await LinkService.listLinks({ tenantId: DEMO_TENANT_ID, limit: 50 });
  return {
    session: guest.issueSession(tenant, { ttlMs: 2 * 3600000, readOnly: true }),
    workspace: { ...guest.workspaceSummary(tenant, { linkCount: links.length }), demo: true, readOnly: true }
  };
}

/** One-line name for the variation a link shows, read off its own settings. */
function variationName(link) {
  const d = link.destinations || {};
  if (link.safety && link.safety.review) return 'Safety review';
  if (link.schedule && link.schedule.windows && link.schedule.windows.length) return 'Night and day routing';
  if (d.ios || d.android) return 'Device routing';
  if (link.limits && link.limits.maxClicks) return 'Scan cap with a fallback';
  if (link.expiresAt) return 'End date with a fallback';
  if (link.utm && Object.keys(link.utm).length) return 'Campaign tags';
  return 'Plain dynamic link';
}

let samplesCache = { light: { at: 0, value: null }, full: { at: 0, value: null } };
const SAMPLES_TTL_MS = 5 * 60 * 1000;

/**
 * Sample reports, public and cached. The light form carries three summaries
 * (lightest, median, heaviest by seven-day scans) for the landing page
 * footer; the full form adds every report with its compact points and the
 * link settings the samples page needs to explain each variation.
 */
async function sampleSummaries({ windowDays = 7, nowMs = Date.now(), full = false } = {}) {
  const slot = full ? 'full' : 'light';
  if (samplesCache[slot].value && nowMs - samplesCache[slot].at < SAMPLES_TTL_MS) return samplesCache[slot].value;
  const tenant = await getDemoTenant();
  if (!tenant) return null;
  const { getLinkAnalytics } = require('./linkAnalytics');
  const { expiryDate } = require('./linkRules');
  const { links } = await LinkService.listLinks({ tenantId: DEMO_TENANT_ID, limit: 50 });
  const rows = [];
  for (const link of links) {
    const a = await getLinkAnalytics(link.code, link, { windowDays, timeZone: 'Asia/Kolkata' });
    const src = Object.fromEntries((a.breakdowns.source || []).map(r => [r.value, r.clicks]));
    const row = {
      code: link.code,
      title: link.title || link.code,
      variation: variationName(link),
      shortUrl: link.shortUrl,
      qrUrl: `https://kaayko.com/qr/${link.code}.png`,
      destination: (link.destinations && link.destinations.web) || null,
      events: a.totals.events,
      lifetime: link.clickCount || 0,
      people: a.unique ? a.unique.distinctVisitors : 0,
      qrShare: a.totals.events ? Math.round(((src.qr || 0) / a.totals.events) * 100) : 0,
      timeline: a.timeline.slice(-windowDays).map(d => d.clicks)
    };
    if (full) {
      row.points = (a.points || []).slice(-600);
      row.insights = a.insights;
      row.timeZone = 'Asia/Kolkata';
      row.outcomes = a.outcomes;
      const exp = expiryDate(link);
      row.link = {
        destinations: link.destinations || {},
        schedule: link.schedule || null,
        limits: link.limits || null,
        expiresAt: exp ? exp.toISOString() : null,
        utm: link.utm || {},
        safety: link.safety && link.safety.review ? { review: link.safety.review } : null,
        clickCount: link.clickCount || 0
      };
    }
    rows.push(row);
  }
  if (!rows.length) return null;
  const byEvents = [...rows].sort((x, y) => x.events - y.events);
  const pick = [byEvents[0], byEvents[Math.floor(byEvents.length / 2)], byEvents[byEvents.length - 1]];
  const summary = r => ({ code: r.code, title: r.title, variation: r.variation, shortUrl: r.shortUrl, qrUrl: r.qrUrl, destination: r.destination, events: r.events, lifetime: r.lifetime, people: r.people, qrShare: r.qrShare, timeline: r.timeline });
  const value = { windowDays, samples: [
    { tier: 'light', ...summary(pick[0]) }, { tier: 'medium', ...summary(pick[1]) }, { tier: 'heavy', ...summary(pick[2]) }
  ] };
  if (full) {
    const order = DEMO_LINKS.map(d => d.code);
    value.reports = [...rows].sort((x, y) => order.indexOf(x.code) - order.indexOf(y.code));
  }
  samplesCache[slot] = { at: nowMs, value };
  return value;
}

function resetSamplesCache() { samplesCache = { light: { at: 0, value: null }, full: { at: 0, value: null } }; }

module.exports = { DEMO_TENANT_ID, DEMO_LINKS, seedDemo, issueDemoSession, getDemoTenant, generateEvents, hourWeights, sampleSummaries, resetSamplesCache, variationName };
