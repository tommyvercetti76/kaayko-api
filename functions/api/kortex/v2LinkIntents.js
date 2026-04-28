'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const LinkService = require('./smartLinkService');
const { DEFAULT_TENANT_ID } = require('./tenantContext');

const db = admin.firestore();

const DESTINATION_TYPES = new Set([
  'tenant_admin_login',
  'tenant_alumni_login',
  'tenant_registration',
  'tenant_public_page',
  'tenant_dashboard',
  'campaign_landing',
  'campaign_member_view',
  'philanthropy_campaign',
  'donation_checkout',
  'campaign_report',
  'external_url'
]);

const AUDIENCES = new Set(['admin', 'alumni', 'donor', 'public', 'invited']);
const INTENTS = new Set(['login', 'register', 'view', 'donate', 'report', 'share']);
const SOURCES = new Set(['qr', 'email', 'sms', 'social', 'manual', 'print']);

const EVENT_TYPES = new Set([
  'link_clicked',
  'redirect_completed',
  'login_started',
  'login_completed',
  'registration_started',
  'registration_submitted',
  'campaign_viewed',
  'campaign_cta_clicked',
  'donation_started',
  'donation_completed',
  'report_opened',
  'qr_scanned'
]);

const ROUTE_CODE_PATTERN = /^[a-zA-Z0-9_-]{3,80}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function cleanString(value, max = 500) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function normalizeSlug(value) {
  return cleanString(value, 64).toLowerCase();
}

function normalizeHost(rawHost = '') {
  return String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function isKaaykoHost(host) {
  return !host || host === 'kaayko.com' || host === 'www.kaayko.com' || host.endsWith('.kaayko.com');
}

function tenantSubdomainFromHost(host) {
  const normalized = normalizeHost(host);
  const suffix = '.alumni.kaayko.com';
  if (!normalized.endsWith(suffix)) return '';
  return normalized.slice(0, -suffix.length);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeV2Fields(data = {}) {
  const destinationType = cleanString(data.destinationType || data.metadata?.destinationType || 'external_url', 64);
  const audience = cleanString(data.audience || data.metadata?.audience || 'public', 32);
  const intent = cleanString(data.intent || data.metadata?.intent || 'view', 32);
  const source = cleanString(data.source || data.metadata?.source || data.utm?.source || data.utm?.utm_source || 'manual', 32);

  const normalized = {
    destinationType: DESTINATION_TYPES.has(destinationType) ? destinationType : 'external_url',
    campaignId: cleanString(data.campaignId || data.metadata?.campaignId, 120) || null,
    requiresAuth: normalizeBoolean(data.requiresAuth ?? data.metadata?.requiresAuth, false),
    audience: AUDIENCES.has(audience) ? audience : 'public',
    source: SOURCES.has(source) ? source : 'manual',
    intent: INTENTS.has(intent) ? intent : 'view',
    returnTo: cleanString(data.returnTo || data.metadata?.returnTo, 2000) || null,
    conversionGoal: cleanString(data.conversionGoal || data.metadata?.conversionGoal, 120) || null
  };

  return normalized;
}

function publicTenantView(doc) {
  const data = doc?.data ? doc.data() : doc || {};
  return {
    id: doc?.id || data.id || DEFAULT_TENANT_ID,
    slug: data.slug || doc?.id || DEFAULT_TENANT_ID,
    name: data.name || data.tenantName || doc?.id || 'Kaayko',
    domain: data.domain || 'kaayko.com',
    alumniDomain: data.alumniDomain || `${data.slug || doc?.id || 'kaayko'}.alumni.kaayko.com`,
    pathPrefix: data.pathPrefix || '/l',
    enabled: data.enabled !== false,
    branding: data.branding || {},
    settings: {
      allowRegistration: data.settings?.allowRegistration !== false,
      allowAlumniLogin: data.settings?.allowAlumniLogin !== false,
      allowPhilanthropy: data.settings?.allowPhilanthropy !== false
    }
  };
}

async function findTenant({ tenantId, tenantSlug, host, path }) {
  const slug = normalizeSlug(tenantSlug);
  const normalizedHost = normalizeHost(host);
  const hostSlug = tenantSubdomainFromHost(normalizedHost);
  const pathSlug = extractTenantSlugFromPath(path);

  if (tenantId) {
    const doc = await db.collection('tenants').doc(tenantId).get();
    if (doc.exists && doc.data().enabled !== false) return { id: doc.id, ...doc.data() };
  }

  const candidates = [slug, hostSlug, pathSlug].filter(Boolean);
  for (const candidate of candidates) {
    const byId = await db.collection('tenants').doc(candidate).get();
    if (byId.exists && byId.data().enabled !== false) return { id: byId.id, ...byId.data() };

    const bySlug = await db.collection('tenants').where('slug', '==', candidate).limit(1).get();
    if (!bySlug.empty) {
      const doc = bySlug.docs[0];
      if (doc.data().enabled !== false) return { id: doc.id, ...doc.data() };
    }
  }

  if (normalizedHost && !isKaaykoHost(normalizedHost)) {
    const byDomain = await db.collection('tenants').where('domain', '==', normalizedHost).limit(1).get();
    if (!byDomain.empty) {
      const doc = byDomain.docs[0];
      if (doc.data().enabled !== false) return { id: doc.id, ...doc.data() };
    }

    const byAlumniDomain = await db.collection('tenants').where('alumniDomain', '==', normalizedHost).limit(1).get();
    if (!byAlumniDomain.empty) {
      const doc = byAlumniDomain.docs[0];
      if (doc.data().enabled !== false) return { id: doc.id, ...doc.data() };
    }
  }

  if (!normalizedHost || isKaaykoHost(normalizedHost)) {
    return {
      id: DEFAULT_TENANT_ID,
      slug: 'kaayko',
      name: 'Kaayko',
      domain: 'kaayko.com',
      alumniDomain: 'alumni.kaayko.com',
      pathPrefix: '/l',
      enabled: true
    };
  }

  return null;
}

function extractTenantSlugFromPath(path = '') {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts[0] === 'a' && parts[1] && !isTenantAliasCode(parts[1])) {
    return normalizeSlug(parts[1]);
  }
  return '';
}

function isTenantAliasCode(value = '') {
  return ROUTE_CODE_PATTERN.test(String(value || '')) && !String(value || '').includes('-');
}

function tenantLoginUrl(tenant, path = '/login', params = {}) {
  const domain = tenant?.alumniDomain || `${tenant?.slug || tenant?.id || 'kaayko'}.alumni.kaayko.com`;
  const url = new URL(`https://${domain}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function tenantPathUrl(tenant, path = '/', params = {}) {
  const slug = tenant?.slug || tenant?.id || 'kaayko';
  const url = new URL(`https://kaayko.com/a/${encodeURIComponent(slug)}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildDestinationForIntent({ link, tenant, clickId }) {
  const metadata = link.metadata || {};
  const destinationType = link.destinationType || metadata.destinationType || 'external_url';
  const returnTo = link.returnTo || metadata.returnTo || null;
  const baseParams = {
    kt_link: link.code,
    kt_tenant: tenant?.id || link.tenantId || DEFAULT_TENANT_ID,
    kt_click: clickId || null,
    returnTo
  };

  if (link.requiresAuth || metadata.requiresAuth) {
    const authReturnTo = returnTo || link.destinations?.web || tenantPathUrl(tenant, '/dashboard');
    return tenantLoginUrl(tenant, '/login', { ...baseParams, returnTo: authReturnTo });
  }

  switch (destinationType) {
    case 'tenant_admin_login':
      return tenantLoginUrl(tenant, '/login', { ...baseParams, role: 'admin' });
    case 'tenant_alumni_login':
      return tenantLoginUrl(tenant, '/login', { ...baseParams, role: 'alumni' });
    case 'tenant_registration':
      return tenantPathUrl(tenant, '/register', baseParams);
    case 'tenant_dashboard':
      return tenantPathUrl(tenant, '/admin', baseParams);
    case 'campaign_landing':
    case 'campaign_member_view':
    case 'philanthropy_campaign':
      if (metadata.campaignSlug) {
        return tenantPathUrl(tenant, `/campaigns/${encodeURIComponent(metadata.campaignSlug)}`, baseParams);
      }
      return link.destinations?.web || tenantPathUrl(tenant, '/campaigns', baseParams);
    case 'campaign_report':
      return link.destinations?.web || tenantPathUrl(tenant, '/admin/reports', baseParams);
    case 'donation_checkout':
      return link.destinations?.web || tenantPathUrl(tenant, '/donate', baseParams);
    default:
      return link.destinations?.web || tenantPathUrl(tenant, '/', baseParams);
  }
}

async function recordEvent(type, payload = {}, req = null) {
  if (!EVENT_TYPES.has(type)) {
    const error = new Error('Unsupported KORTEX event type');
    error.code = 'INVALID_EVENT_TYPE';
    throw error;
  }

  const event = {
    type,
    tenantId: payload.tenantId || DEFAULT_TENANT_ID,
    linkCode: payload.linkCode || payload.code || null,
    campaignId: payload.campaignId || null,
    clickId: payload.clickId || null,
    source: payload.source || null,
    audience: payload.audience || null,
    intent: payload.intent || null,
    metadata: payload.metadata || {},
    userId: payload.userId || null,
    userAgent: req?.get ? req.get('user-agent') || null : null,
    referrer: req?.get ? req.get('referer') || null : null,
    ip: req?.ip || req?.connection?.remoteAddress || null,
    createdAt: FieldValue.serverTimestamp()
  };

  const ref = await db.collection('kortex_events').add(event);
  return { id: ref.id, ...event };
}

async function createTenantLink({ tenant, actor, data }) {
  const v2 = normalizeV2Fields(data);
  const code = cleanString(data.code || data.shortCode, 80);
  const namespace = normalizeSlug(data.namespace || data.pathNamespace || '');
  const publicCode = code;
  const storedCode = namespace ? `${namespace}_${code.toLowerCase()}` : code;

  if (code && !ROUTE_CODE_PATTERN.test(code)) {
    const error = new Error('Invalid link code: use 3-80 letters, numbers, hyphens, or underscores');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const defaultDestination = buildDestinationForIntent({
    link: {
      code: storedCode || code,
      destinations: { web: null },
      metadata: {},
      ...v2
    },
    tenant,
    clickId: null
  });
  const webDestination = cleanString(data.webDestination || data.destinations?.web || data.destination || defaultDestination, 2000);
  const destinations = data.destinations || {
    web: webDestination || null,
    ios: cleanString(data.iosDestination, 2000) || null,
    android: cleanString(data.androidDestination, 2000) || null
  };

  const link = await LinkService.createShortLink({
    ...data,
    code: storedCode || undefined,
    publicCode: publicCode || undefined,
    webDestination: destinations.web,
    iosDestination: destinations.ios,
    androidDestination: destinations.android,
    tenantId: tenant.id,
    tenantName: tenant.name,
    domain: data.domain || tenant.domain || 'kaayko.com',
    pathPrefix: data.pathPrefix || (namespace ? `/${namespace}` : '/l'),
    createdBy: actor?.email || actor?.uid || 'system',
    metadata: {
      ...(data.metadata || {}),
      ...(namespace ? { namespace, publicCode } : {}),
      ...v2
    },
    ...v2
  });

  return link;
}

async function resolveLink({ code, namespace, host, path, query = {}, req = null }) {
  const normalizedCode = cleanString(code, 80);
  const shortCode = namespace && namespace !== 'l'
    ? `${normalizeSlug(namespace)}_${normalizedCode.toLowerCase()}`
    : normalizedCode;

  const link = await LinkService.getShortLink(shortCode);
  const tenant = await findTenant({
    tenantId: link.tenantId || DEFAULT_TENANT_ID,
    host,
    path
  });

  if (!tenant) {
    const error = new Error('Tenant not found for this link');
    error.code = 'TENANT_NOT_FOUND';
    throw error;
  }

  const clickId = `kt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const v2 = normalizeV2Fields({ ...link, metadata: link.metadata || {} });
  await recordEvent('link_clicked', {
    tenantId: tenant.id,
    linkCode: link.code || shortCode,
    campaignId: v2.campaignId || link.campaignId || null,
    clickId,
    source: query.utm_source || query.src || v2.source,
    audience: v2.audience,
    intent: v2.intent,
    metadata: {
      namespace: namespace || null,
      destinationType: v2.destinationType,
      path: path || null
    }
  }, req);

  db.collection('short_links').doc(link.code || shortCode).update({
    clickCount: FieldValue.increment(1),
    lastClickedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }).catch(err => console.error('[KortexV2] click count update failed:', err));

  const destination = buildDestinationForIntent({
    link: { ...link, ...v2 },
    tenant,
    clickId
  });

  return {
    link: {
      code: link.code || shortCode,
      shortUrl: link.shortUrl,
      title: link.title || '',
      description: link.description || '',
      destinationType: v2.destinationType,
      requiresAuth: v2.requiresAuth,
      audience: v2.audience,
      intent: v2.intent,
      source: v2.source,
      conversionGoal: v2.conversionGoal
    },
    tenant: publicTenantView({ id: tenant.id, data: () => tenant }),
    campaignId: v2.campaignId || link.campaignId || null,
    clickId,
    destination
  };
}

async function getTenantAnalytics(tenantId, limit = 500) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
  const [linksSnap, eventsSnap] = await Promise.all([
    db.collection('short_links').where('tenantId', '==', tenantId).limit(safeLimit).get(),
    db.collection('kortex_events').where('tenantId', '==', tenantId).limit(safeLimit).get()
  ]);

  const links = linksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const events = eventsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const eventCounts = {};
  const sourceCounts = {};
  const campaignCounts = {};

  for (const event of events) {
    eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    if (event.source) sourceCounts[event.source] = (sourceCounts[event.source] || 0) + 1;
    if (event.campaignId) campaignCounts[event.campaignId] = (campaignCounts[event.campaignId] || 0) + 1;
  }

  return {
    totals: {
      links: links.length,
      clicks: events.filter(e => e.type === 'link_clicked').length,
      conversions: events.filter(e => String(e.type || '').endsWith('_completed') || e.type === 'registration_submitted').length
    },
    eventCounts,
    sourceCounts,
    campaignCounts,
    topLinks: links
      .map(link => ({
        code: link.code || link.id,
        title: link.title || '',
        destinationType: link.destinationType || link.metadata?.destinationType || 'external_url',
        clickCount: link.clickCount || 0,
        campaignId: link.campaignId || link.metadata?.campaignId || null
      }))
      .sort((a, b) => b.clickCount - a.clickCount)
      .slice(0, 25)
  };
}

module.exports = {
  DESTINATION_TYPES,
  EVENT_TYPES,
  normalizeV2Fields,
  findTenant,
  publicTenantView,
  createTenantLink,
  resolveLink,
  recordEvent,
  getTenantAnalytics,
  extractTenantSlugFromPath
};
