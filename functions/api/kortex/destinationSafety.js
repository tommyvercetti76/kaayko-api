/**
 * Destination safety — one assessment every link-creation and edit path shares.
 *
 * Verdicts:
 *   allow → link goes live (status 'active')
 *   hold  → link is created but served a "under review" page (status 'held')
 *   block → creation/edit is refused, or a live link is switched off (status 'blocked')
 *
 * Checks run cheapest-first and short-circuit on a block:
 *   1. URL shape: http(s) only, no embedded credentials, length cap
 *   2. Private / loopback / link-local / cloud-metadata hosts → block
 *   3. Host blocklist: manual entries in `kortex_blocked_hosts` plus the threat
 *      feed snapshot (URLhaus + OpenPhish) that safetyJobs.js writes to Storage
 *   4. Google Safe Browsing Lookup API v4 when GOOGLE_SAFE_BROWSING_API_KEY is set
 *   5. Domain reputation: a destination on a domain the platform has never seen
 *      is HELD when the creating tenant is new (< KORTEX_SAFETY_HOLD_HOURS old)
 *      or has opted in to review. Established tenants, super-admins and the
 *      default Kaayko tenant (which already has a hard whitelist) are never held.
 *
 * Failure policy: a lookup error never blocks by itself. With
 * KORTEX_SAFETY_FAIL_CLOSED=true an error turns into a hold instead of an allow,
 * so the link can be reviewed rather than silently going live.
 *
 * Everything here is read-only against the request; the only writes are the
 * `kortex_known_domains` learning entries, which are best-effort.
 *
 * @module api/kortex/destinationSafety
 */

'use strict';

const admin = require('firebase-admin');
const { DEFAULT_TENANT_ID } = require('./tenantContext');
const { KAAYKO_DOMAIN_WHITELIST } = require('./domainPolicy');

const db = admin.firestore();

const VERDICT = Object.freeze({ ALLOW: 'allow', HOLD: 'hold', BLOCK: 'block' });
const VERDICT_RANK = { allow: 0, hold: 1, block: 2 };

const MAX_URL_LENGTH = 2048;
const SAFE_BROWSING_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
const SAFE_BROWSING_THREATS = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'];
const SAFE_BROWSING_TIMEOUT_MS = 4000;
const SAFE_BROWSING_CACHE_TTL_MS = 30 * 60 * 1000;
const SAFE_BROWSING_CACHE_MAX = 5000;
const MANUAL_BLOCKLIST_TTL_MS = 5 * 60 * 1000;
const FEED_TTL_MS = 6 * 60 * 60 * 1000;
const KNOWN_DOMAIN_CACHE_TTL_MS = 10 * 60 * 1000;

const FEED_OBJECT_PATH = process.env.KORTEX_SAFETY_FEED_PATH || 'kortex-safety/blocked-hosts.txt';

// Second-level public suffixes where the registrable domain is three labels
// deep (school.ac.in, shop.co.uk). Hosting platforms whose sub-domains belong to
// different owners are listed too so `alice.github.io` and `bob.github.io` are
// judged separately.
const MULTI_PART_SUFFIXES = new Set([
  'co.in', 'ac.in', 'edu.in', 'gov.in', 'net.in', 'org.in', 'res.in', 'nic.in',
  'co.uk', 'ac.uk', 'org.uk', 'gov.uk', 'me.uk', 'ltd.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'ac.nz', 'co.za', 'org.za', 'ac.za',
  'com.br', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.cl',
  'co.jp', 'ac.jp', 'ne.jp', 'or.jp', 'co.kr', 'ac.kr',
  'com.sg', 'edu.sg', 'com.my', 'edu.my', 'com.hk', 'edu.hk', 'com.tw', 'edu.tw',
  'com.tr', 'edu.tr', 'co.id', 'ac.id', 'com.ph', 'edu.ph', 'com.pk', 'edu.pk',
  'com.bd', 'edu.bd', 'com.np', 'edu.np', 'com.lk', 'ac.lk', 'com.sa', 'edu.sa', 'ac.ae',
  'com.eg', 'edu.eg', 'com.ng', 'edu.ng', 'co.ke', 'ac.ke', 'com.gh', 'edu.gh',
  'github.io', 'gitlab.io', 'web.app', 'firebaseapp.com', 'pages.dev', 'vercel.app',
  'netlify.app', 'herokuapp.com', 'blogspot.com', 'wordpress.com', 'wixsite.com',
  'squarespace.com', 'myshopify.com', 'notion.site', 'carrd.co', 'webflow.io',
  'glitch.me', 'repl.co', 'appspot.com', 'cloudfront.net', 'amazonaws.com',
  'azurewebsites.net', 'onrender.com', 'fly.dev', 'surge.sh', 'weebly.com', 'strikingly.com'
]);

// Domains every tenant may link to without a reputation hold. These are the
// destinations event, alumni and school customers use in practice.
const SEED_KNOWN_DOMAINS = new Set([
  ...KAAYKO_DOMAIN_WHITELIST,
  'google.com', 'youtube.com', 'youtu.be', 'goo.gl', 'forms.gle', 'g.page',
  'facebook.com', 'fb.com', 'instagram.com', 'threads.net', 'whatsapp.com', 'wa.me',
  'linkedin.com', 'lnkd.in', 'twitter.com', 'x.com', 'pinterest.com', 'reddit.com',
  'apple.com', 'play.google.com', 'microsoft.com', 'office.com', 'zoom.us', 'teams.microsoft.com',
  'eventbrite.com', 'bookmyshow.com', 'in.bookmyshow.com', 'insider.in', 'townscript.com',
  'meetup.com', 'lu.ma', 'ticketmaster.com', 'ticketmaster.in', 'hopin.com', 'airmeet.com',
  'razorpay.com', 'rzp.io', 'paytm.com', 'phonepe.com', 'stripe.com', 'buy.stripe.com', 'paypal.com', 'paypal.me',
  'github.com', 'notion.so', 'canva.com', 'figma.com', 'typeform.com', 'jotform.com', 'tally.so',
  'calendly.com', 'cal.com', 'hubspot.com', 'mailchimp.com', 'substack.com', 'medium.com',
  'spotify.com', 'open.spotify.com', 'soundcloud.com', 'vimeo.com',
  'amazon.in', 'amazon.com', 'flipkart.com', 'myntra.com', 'shopify.com',
  'wikipedia.org', 'gov.in', 'nic.in', 'india.gov.in', 'digilocker.gov.in',
  'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org',
  'maps.app.goo.gl', 'maps.google.com', 'drive.google.com', 'docs.google.com', 'sites.google.com'
]);

const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me', 'aol.com', 'rediffmail.com', 'zoho.com', 'zohomail.in',
  'yandex.com', 'mail.com', 'gmx.com', 'gmx.de', 'fastmail.com', 'hey.com', 'tutanota.com'
]);

// ─── URL shape ────────────────────────────────────────────────────────────────

function parseDestination(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return { ok: false, code: 'EMPTY_URL', detail: 'Destination is empty' };
  if (value.length > MAX_URL_LENGTH) {
    return { ok: false, code: 'URL_TOO_LONG', detail: `Destination exceeds ${MAX_URL_LENGTH} characters` };
  }

  let url;
  try {
    url = new URL(value);
  } catch (_) {
    return { ok: false, code: 'INVALID_URL', detail: 'Destination is not a valid URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'INVALID_SCHEME', detail: 'Destination must start with http:// or https://' };
  }
  if (url.username || url.password) {
    return { ok: false, code: 'CREDENTIALS_IN_URL', detail: 'Destinations may not embed a username or password' };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, code: 'INVALID_URL', detail: 'Destination has no host' };

  return { ok: true, url, host, normalized: url.toString() };
}

// ─── Private / internal hosts ─────────────────────────────────────────────────

function parseIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some(p => p > 255)) return null;
  return parts;
}

function isPrivateIpv4(parts) {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIpv6(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('::ffff:')) {
    const v4 = parseIpv4(h.slice(7));
    return v4 ? isPrivateIpv4(v4) : true;
  }
  return false;
}

function isInternalHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa') || h.endsWith('.lan')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata') return true;
  if (!h.includes('.') && !h.includes(':')) return true; // bare hostnames never resolve publicly
  const v4 = parseIpv4(h);
  if (v4) return isPrivateIpv4(v4);
  if (h.includes(':')) return isPrivateIpv6(h);
  return false;
}

function isIpLiteral(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  return !!parseIpv4(h) || h.includes(':');
}

// ─── Registrable domain ───────────────────────────────────────────────────────

function getRegistrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || isIpLiteral(h)) return h;
  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

function hostSuffixes(host) {
  const labels = String(host || '').toLowerCase().split('.').filter(Boolean);
  const out = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join('.'));
  if (labels.length === 1) out.push(labels[0]);
  return out;
}

// ─── Blocklists ───────────────────────────────────────────────────────────────

const cache = {
  manual: { hosts: new Set(), loadedAt: 0 },
  feed: { hosts: new Set(), loadedAt: 0, meta: null },
  safeBrowsing: new Map(),
  knownDomains: new Map()
};

async function loadManualBlocklist() {
  const now = Date.now();
  if (now - cache.manual.loadedAt < MANUAL_BLOCKLIST_TTL_MS) return cache.manual.hosts;
  try {
    const snap = await db.collection('kortex_blocked_hosts').get();
    const hosts = new Set();
    snap.forEach(doc => {
      const data = doc.data() || {};
      if (data.active === false) return;
      hosts.add(String(data.host || doc.id).toLowerCase());
    });
    cache.manual = { hosts, loadedAt: now };
  } catch (error) {
    console.error('[Safety] manual blocklist load failed:', error.message);
    cache.manual.loadedAt = now - MANUAL_BLOCKLIST_TTL_MS + 30 * 1000; // retry in 30s
  }
  return cache.manual.hosts;
}

function parseFeedText(text) {
  const hosts = new Set();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    hosts.add(line.toLowerCase());
  }
  return hosts;
}

async function loadFeedBlocklist() {
  const now = Date.now();
  if (now - cache.feed.loadedAt < FEED_TTL_MS) return cache.feed.hosts;
  try {
    const file = admin.storage().bucket().file(FEED_OBJECT_PATH);
    const [exists] = await file.exists();
    if (exists) {
      const [contents] = await file.download();
      cache.feed = { hosts: parseFeedText(contents.toString('utf8')), loadedAt: now, meta: { path: FEED_OBJECT_PATH } };
    } else {
      cache.feed = { hosts: new Set(), loadedAt: now, meta: { path: FEED_OBJECT_PATH, missing: true } };
    }
  } catch (error) {
    console.error('[Safety] feed blocklist load failed:', error.message);
    cache.feed.loadedAt = now - FEED_TTL_MS + 5 * 60 * 1000; // retry in 5 minutes
  }
  return cache.feed.hosts;
}

async function checkBlocklists(host) {
  const [manual, feed] = await Promise.all([loadManualBlocklist(), loadFeedBlocklist()]);
  for (const candidate of hostSuffixes(host)) {
    if (manual.has(candidate)) return { hit: true, source: 'manual', match: candidate };
  }
  // Feeds list exact hosts; also match the registrable domain so a listed
  // apex covers its sub-domains.
  if (feed.has(host)) return { hit: true, source: 'feed', match: host };
  const registrable = getRegistrableDomain(host);
  if (registrable !== host && feed.has(registrable)) return { hit: true, source: 'feed', match: registrable };
  return { hit: false };
}

// ─── Google Safe Browsing ─────────────────────────────────────────────────────

function safeBrowsingKey() {
  return process.env.GOOGLE_SAFE_BROWSING_API_KEY || null;
}

function rememberSafeBrowsing(url, result) {
  if (cache.safeBrowsing.size >= SAFE_BROWSING_CACHE_MAX) {
    const oldest = cache.safeBrowsing.keys().next().value;
    cache.safeBrowsing.delete(oldest);
  }
  cache.safeBrowsing.set(url, { result, at: Date.now() });
}

/**
 * Look up URLs against Safe Browsing. Returns a Map url → { matched, threatType }.
 * Never throws; a transport error yields { error: true } for every URL.
 */
async function checkSafeBrowsing(urls, { fetchImpl } = {}) {
  const results = new Map();
  const key = safeBrowsingKey();
  const unique = [...new Set(urls.filter(Boolean))];
  if (!key || unique.length === 0) {
    unique.forEach(u => results.set(u, { skipped: true }));
    return results;
  }

  const pending = [];
  for (const url of unique) {
    const cached = cache.safeBrowsing.get(url);
    if (cached && Date.now() - cached.at < SAFE_BROWSING_CACHE_TTL_MS) results.set(url, cached.result);
    else pending.push(url);
  }
  if (!pending.length) return results;

  const doFetch = fetchImpl || global.fetch;
  try {
    const response = await doFetch(`${SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(SAFE_BROWSING_TIMEOUT_MS) : undefined,
      body: JSON.stringify({
        client: { clientId: 'kortex', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: SAFE_BROWSING_THREATS,
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: pending.map(url => ({ url }))
        }
      })
    });
    if (!response.ok) throw new Error(`Safe Browsing HTTP ${response.status}`);
    const body = await response.json().catch(() => ({}));
    const matched = new Map();
    for (const match of body.matches || []) {
      const url = match?.threat?.url;
      if (url && !matched.has(url)) matched.set(url, match.threatType || 'UNKNOWN');
    }
    for (const url of pending) {
      const result = matched.has(url) ? { matched: true, threatType: matched.get(url) } : { matched: false };
      rememberSafeBrowsing(url, result);
      results.set(url, result);
    }
  } catch (error) {
    console.error('[Safety] Safe Browsing lookup failed:', error.message);
    pending.forEach(url => results.set(url, { error: true, detail: error.message }));
  }
  return results;
}

// ─── Domain reputation ────────────────────────────────────────────────────────

async function isKnownDomain(registrable) {
  if (!registrable) return false;
  if (SEED_KNOWN_DOMAINS.has(registrable)) return true;
  const cached = cache.knownDomains.get(registrable);
  if (cached && Date.now() - cached.at < KNOWN_DOMAIN_CACHE_TTL_MS) return cached.known;
  try {
    const doc = await db.collection('kortex_known_domains').doc(registrable).get();
    const known = doc.exists && doc.data()?.active !== false;
    cache.knownDomains.set(registrable, { known, at: Date.now() });
    return known;
  } catch (error) {
    console.error('[Safety] known-domain lookup failed:', error.message);
    return false;
  }
}

async function markDomainKnown(registrable, meta = {}) {
  if (!registrable || SEED_KNOWN_DOMAINS.has(registrable) || isIpLiteral(registrable)) return;
  try {
    const ref = db.collection('kortex_known_domains').doc(registrable);
    const existing = await ref.get();
    if (existing.exists) return;
    await ref.set({
      domain: registrable,
      active: true,
      source: meta.source || 'link',
      tenantId: meta.tenantId || null,
      firstSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      firstSeenAtMs: Date.now()
    });
    cache.knownDomains.set(registrable, { known: true, at: Date.now() });
  } catch (error) {
    console.error('[Safety] markDomainKnown failed:', error.message);
  }
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value._seconds) return value._seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function holdWindowMs() {
  const hours = Number(process.env.KORTEX_SAFETY_HOLD_HOURS);
  return (Number.isFinite(hours) && hours >= 0 ? hours : 24) * 60 * 60 * 1000;
}

function tenantTrustsDomain(tenant, host, registrable) {
  const lists = [tenant?.trustedDomains, tenant?.settings?.allowedDomains];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const d = String(raw || '').toLowerCase().replace(/^www\./, '');
      if (!d) continue;
      if (host === d || host.endsWith('.' + d) || registrable === d) return true;
    }
  }
  return false;
}

/**
 * Decide whether an unknown domain should be held for this tenant.
 */
function shouldHoldUnknownDomain({ tenantId, tenant, actorIsSuperAdmin, purpose }) {
  if (actorIsSuperAdmin) return false;
  if (purpose === 'rescan') return false; // re-scans only ever block, never hold
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) return false;
  // Guest (no-account) workspaces are never held: a held QR with nobody to
  // notify is a broken promise. Their protection is the block checks, the
  // nightly re-scan and the abuse limits instead.
  if (tenant?.kind === 'guest') return false;
  const pref = tenant?.settings?.reviewUnknownDomains;
  if (pref === true) return true;
  if (pref === false) return false;
  const createdAtMs = tenant?.createdAtMs || toMillis(tenant?.createdAt);
  if (!createdAtMs) return false; // legacy tenant without a creation stamp: established
  return Date.now() - createdAtMs < holdWindowMs();
}

// ─── Assessment ───────────────────────────────────────────────────────────────

function worst(a, b) {
  return VERDICT_RANK[b] > VERDICT_RANK[a] ? b : a;
}

function failClosed() {
  return String(process.env.KORTEX_SAFETY_FAIL_CLOSED || '').toLowerCase() === 'true';
}

/**
 * Assess one destination URL.
 * @param {string} rawUrl
 * @param {Object} ctx
 * @param {string} ctx.tenantId
 * @param {Object|null} ctx.tenant - tenant document (for trust + age)
 * @param {boolean} ctx.actorIsSuperAdmin
 * @param {'create'|'update'|'rescan'|'review'} ctx.purpose
 * @param {Map} [ctx.safeBrowsingResults] - pre-fetched results (batch re-scan)
 */
async function assessDestination(rawUrl, ctx = {}) {
  const checkedAt = new Date().toISOString();
  const reasons = [];
  const checks = { shape: 'ok', privateNetwork: 'ok', blocklist: 'skipped', safeBrowsing: 'skipped', knownDomain: null };
  let verdict = VERDICT.ALLOW;

  const parsed = parseDestination(rawUrl);
  if (!parsed.ok) {
    checks.shape = parsed.code;
    reasons.push({ code: parsed.code, detail: parsed.detail });
    return { url: String(rawUrl || ''), host: null, registrable: null, verdict: VERDICT.BLOCK, reasons, checks, checkedAt };
  }

  const { host, normalized } = parsed;
  const registrable = getRegistrableDomain(host);

  if (isInternalHost(host)) {
    checks.privateNetwork = 'hit';
    reasons.push({ code: 'PRIVATE_NETWORK', detail: 'Destination points at a private or internal address' });
    return { url: normalized, host, registrable, verdict: VERDICT.BLOCK, reasons, checks, checkedAt };
  }

  const blocklist = await checkBlocklists(host);
  checks.blocklist = blocklist.hit ? 'hit' : 'ok';
  if (blocklist.hit) {
    reasons.push({ code: 'BLOCKLISTED_HOST', detail: `Host is on the ${blocklist.source} blocklist (${blocklist.match})` });
    return { url: normalized, host, registrable, verdict: VERDICT.BLOCK, reasons, checks, checkedAt };
  }

  let sb = ctx.safeBrowsingResults?.get(normalized) || null;
  if (!sb) {
    const results = await checkSafeBrowsing([normalized], { fetchImpl: ctx.fetchImpl });
    sb = results.get(normalized) || { skipped: true };
  }
  if (sb.matched) {
    checks.safeBrowsing = 'hit';
    reasons.push({ code: 'SAFE_BROWSING', detail: `Google Safe Browsing flagged this destination (${sb.threatType})` });
    return { url: normalized, host, registrable, verdict: VERDICT.BLOCK, reasons, checks, checkedAt };
  }
  if (sb.error) {
    checks.safeBrowsing = 'error';
    if (failClosed() && ctx.purpose !== 'rescan') {
      verdict = worst(verdict, VERDICT.HOLD);
      reasons.push({ code: 'SAFETY_CHECK_UNAVAILABLE', detail: 'The malicious-URL check could not run; held for review' });
    }
  } else if (!sb.skipped) {
    checks.safeBrowsing = 'ok';
  }

  if (isIpLiteral(host)) {
    checks.knownDomain = false;
    if (ctx.purpose !== 'rescan' && !ctx.actorIsSuperAdmin) {
      verdict = worst(verdict, VERDICT.HOLD);
      reasons.push({ code: 'IP_LITERAL_DESTINATION', detail: 'Destination uses a raw IP address instead of a domain' });
    }
    return { url: normalized, host, registrable, verdict, reasons, checks, checkedAt };
  }

  const trusted = tenantTrustsDomain(ctx.tenant, host, registrable);
  const known = trusted || await isKnownDomain(registrable);
  checks.knownDomain = known;
  if (!known && shouldHoldUnknownDomain(ctx)) {
    verdict = worst(verdict, VERDICT.HOLD);
    reasons.push({ code: 'UNKNOWN_DOMAIN', detail: `${registrable} has not been seen on Kortex before; held for a quick review` });
  }

  return { url: normalized, host, registrable, verdict, reasons, checks, checkedAt };
}

/**
 * Assess every destination of a link. Returns the worst verdict plus per-platform detail.
 * @param {{web?: string, ios?: string, android?: string}} destinations
 * @param {Object} ctx - see assessDestination
 */
async function assessDestinations(destinations = {}, ctx = {}) {
  const entries = Object.entries(destinations || {}).filter(([, url]) => !!url);
  const results = {};
  let verdict = VERDICT.ALLOW;
  const reasons = [];

  for (const [platform, url] of entries) {
    // A/B variant arrays: assess every variant URL.
    const urls = Array.isArray(url) ? url.map(v => (typeof v === 'string' ? v : v?.url)).filter(Boolean) : [url];
    const perPlatform = [];
    for (const candidate of urls) {
      const assessment = await assessDestination(candidate, ctx);
      perPlatform.push(assessment);
      verdict = worst(verdict, assessment.verdict);
      for (const reason of assessment.reasons) {
        reasons.push({ ...reason, platform });
      }
    }
    results[platform] = perPlatform.length === 1 ? perPlatform[0] : perPlatform;
  }

  return { verdict, reasons, results, checkedAt: new Date().toISOString() };
}

/**
 * Compact record stored on the link document.
 */
function buildSafetyRecord(assessment, { purpose = 'create', actor = null } = {}) {
  const domains = [];
  for (const result of Object.values(assessment.results || {})) {
    for (const r of Array.isArray(result) ? result : [result]) {
      if (r?.registrable && !domains.includes(r.registrable)) domains.push(r.registrable);
    }
  }
  return {
    verdict: assessment.verdict,
    reasons: (assessment.reasons || []).map(r => ({ code: r.code, platform: r.platform || 'web', detail: r.detail })),
    domains,
    checkedAt: assessment.checkedAt || new Date().toISOString(),
    checkedAtMs: Date.now(),
    checkedBy: purpose,
    actor: actor || null
  };
}

function statusForVerdict(verdict) {
  if (verdict === VERDICT.BLOCK) return 'blocked';
  if (verdict === VERDICT.HOLD) return 'held';
  return 'active';
}

function isFreemailDomain(domain) {
  return FREEMAIL_DOMAINS.has(String(domain || '').toLowerCase());
}

/** Test/ops hook: forget every in-memory cache. */
function resetCaches() {
  cache.manual = { hosts: new Set(), loadedAt: 0 };
  cache.feed = { hosts: new Set(), loadedAt: 0, meta: null };
  cache.safeBrowsing.clear();
  cache.knownDomains.clear();
}

module.exports = {
  VERDICT,
  FEED_OBJECT_PATH,
  SEED_KNOWN_DOMAINS,
  parseDestination,
  isInternalHost,
  isIpLiteral,
  getRegistrableDomain,
  parseFeedText,
  checkBlocklists,
  checkSafeBrowsing,
  isKnownDomain,
  markDomainKnown,
  shouldHoldUnknownDomain,
  assessDestination,
  assessDestinations,
  buildSafetyRecord,
  statusForVerdict,
  isFreemailDomain,
  resetCaches
};
