/**
 * functions/api/kortex/smartLinks.js
 * 
 * Smart Links API v4 - SHORT CODES ONLY!
 * Simple: kaayko.com/l/lkXXXX → anywhere you want
 * 
 * Endpoints (all under /api/smartlinks):
 * - GET    /api/smartlinks/r/:code         → Redirect handler (short codes only)
 * - POST   /api/smartlinks                  → Create short link
 * - GET    /api/smartlinks                  → List all links
 * - GET    /api/smartlinks/:code            → Get link by code
 * - PUT    /api/smartlinks/:code            → Update link
 * - DELETE /api/smartlinks/:code            → Delete link
 * - POST   /api/smartlinks/events/:type     → Track app events
 * - GET    /api/smartlinks/stats            → Link analytics
 * - GET    /api/smartlinks/health           → Health check
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

// Import modular utilities and services
const { handleRedirect } = require('./redirectHandler');
const LinkService = require('./smartLinkService');
const KortexV2 = require('./v2LinkIntents');

// Import authentication middleware
const { requireAuth, requireAdmin, requireVerifiedEmail, requireSuperAdmin, optionalAuth } = require('../../middleware/authMiddleware');

// Trust pass: input allowlists, audit log, self-serve provisioning, safety jobs
const { pickCreateInput, pickUpdateInput } = require('./validation/linkInput');
const { recordAudit, listAudit } = require('./auditLog');
const { provisionSelfServeTenant } = require('./provisioning');
const { userRateLimit } = require('./rateLimitService');
const { LINK_STATUS, effectiveStatus } = require('./safetyPages');
const safetyJobs = require('./safetyJobs');
const { getClientIp } = require('./clientIp');
const { linkEventsCsv, workspaceCsv, sendCsv } = require('./csvExport');
const abuseReports = require('./abuseReports');
const supportRequests = require('./supportRequests');
const { getTenantGate, forgetTenant } = require('./tenantGate');
const guestAccess = require('./guestAccess');
const emailDelivery = require('../../services/emailDelivery');
const { PLAN_LIMITS: PLAN_WINDOWS } = require('../billing/planLimits');

function hashIpForStorage(ip) {
  if (!ip) return null;
  const salt = process.env.KORTEX_IP_SALT || 'kortex-ip-salt';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 16);
}

function linkWriteError(res, error, fallback) {
  if (error.code === 'NOT_FOUND') {
    return res.status(404).json({ success: false, error: 'Link not found', code: 'NOT_FOUND' });
  }
  if (error.code === 'ALREADY_EXISTS') {
    return res.status(409).json({ success: false, error: error.message, code: 'ALREADY_EXISTS', existing: error.existing });
  }
  if (error.code === 'DESTINATION_BLOCKED') {
    return res.status(422).json({ success: false, error: error.message, code: error.code, reasons: error.reasons || [] });
  }
  if (error.code === 'INVALID_URL' || error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_CODE') {
    return res.status(422).json({ success: false, error: error.message, code: error.code });
  }
  if (error.code === 'DOMAIN_NOT_WHITELISTED' || error.code === 'DOMAIN_NOT_ALLOWED' || error.code === 'PLAN_LIMIT_EXCEEDED') {
    return res.status(403).json({ success: false, error: error.message, code: error.code });
  }
  if (error.message?.includes('tenant') || error.message?.includes('Access denied') || error.code?.startsWith('TENANT')) {
    return res.status(403).json({ success: false, error: 'Tenant access denied', message: error.message, code: 'TENANT_ACCESS_DENIED' });
  }
  return null;
}

// Import tenant context
const {
  getTenantFromRequest,
  assertTenantAccess,
  DEFAULT_TENANT_ID
} = require('./tenantContext');

// Import notification service
const { sendLinkCreatedNotification } = require('../../services/emailNotificationService');

// Import webhook service
const {
  triggerWebhooks,
  EVENT_TYPES,
  createWebhookSubscription,
  listWebhookSubscriptions,
  updateWebhookSubscription,
  deleteWebhookSubscription
} = require('./webhookService');

// Import API key + webhook provisioning helpers
const { createApiKey, listApiKeys, revokeApiKey } = require('../../middleware/apiKeyMiddleware');

// Import security middleware
const { rateLimiter, botProtection, secureHeaders, honeypot } = require('../../middleware/securityMiddleware');

const ALLOWED_PUBLIC_EVENT_TYPES = new Set(['install', 'open', 'conversion']);

// Apply security middleware to all routes
router.use(secureHeaders);
router.use(botProtection);

// ============================================================================
// SECURITY: Honeypot trap for bots
// ============================================================================
router.get('/admin/api-key', honeypot);
router.post('/admin/bulk-import', honeypot);
router.get('/export-all-data', honeypot);

// ============================================================================
// GUEST (no-account) TIER — access-code workspaces, mounted before /:code
// ============================================================================
router.use('/guest', require('./guestRouter'));

// Public QR image for any live link: /kortex/qr/<code>.png|svg
router.get('/qr/:file', rateLimiter('publicQr'), (req, res) => require('./qrService').serveLinkQr(req, res).catch(err => {
  console.error('[QR] render failed:', err);
  res.status(500).json({ success: false, error: 'QR render failed' });
}));

async function getTenantConfig(tenantId) {
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
    return {
      id: DEFAULT_TENANT_ID,
      name: 'Kaayko',
      domain: 'kaayko.com',
      pathPrefix: '/l'
    };
  }

  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  if (!tenantDoc.exists) {
    const error = new Error(`Tenant not found: ${tenantId}`);
    error.code = 'TENANT_NOT_FOUND';
    throw error;
  }

  const tenant = tenantDoc.data();
  if (tenant.enabled === false) {
    const error = new Error(`Tenant disabled: ${tenantId}`);
    error.code = 'TENANT_DISABLED';
    throw error;
  }

  return {
    id: tenantDoc.id,
    name: tenant.name || tenantDoc.id,
    domain: tenant.domain || 'kaayko.com',
    pathPrefix: tenant.pathPrefix || '/l'
  };
}

function canReadLink(user, link) {
  if (!user || !user.role) return false;
  if (user.role === 'super-admin') return true;
  try {
    assertTenantAccess(user, link.tenantId || DEFAULT_TENANT_ID);
    return true;
  } catch (_) {
    return false;
  }
}

function tenantAccessError(res, error) {
  return res.status(403).json({
    success: false,
    error: 'Tenant access denied',
    message: error.message,
    code: 'TENANT_ACCESS_DENIED'
  });
}

// ============================================================================
// HEALTH CHECK (Must be BEFORE /:code to avoid being caught by it)
// ============================================================================

router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Smart Links API v4 - Short Codes Only',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// KORTEX V2 TENANT BOOTSTRAP + UNIVERSAL RESOLVE
// ============================================================================

router.get('/tenants/resolve', async (req, res) => {
  try {
    const tenant = await KortexV2.findTenant({
      tenantSlug: req.query.tenantSlug || req.query.slug,
      host: req.query.host || req.headers.host || req.hostname,
      path: req.query.path || ''
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    return res.json({
      success: true,
      tenant: KortexV2.publicTenantView({ id: tenant.id, data: () => tenant })
    });
  } catch (error) {
    console.error('[KortexV2] Tenant resolve error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to resolve tenant',
      message: 'An unexpected error occurred'
    });
  }
});

router.get('/tenants/:tenantSlug/bootstrap', async (req, res) => {
  try {
    const tenant = await KortexV2.findTenant({
      tenantSlug: req.params.tenantSlug,
      host: req.query.host || req.headers.host || req.hostname,
      path: req.query.path || ''
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    return res.json({
      success: true,
      tenant: KortexV2.publicTenantView({ id: tenant.id, data: () => tenant }),
      routes: {
        login: `https://${tenant.alumniDomain || `${tenant.slug || tenant.id}.alumni.kaayko.com`}/login`,
        admin: `/a/${encodeURIComponent(tenant.slug || tenant.id)}/admin`,
        register: `/a/${encodeURIComponent(tenant.slug || tenant.id)}/register`,
        campaigns: `/a/${encodeURIComponent(tenant.slug || tenant.id)}/campaigns`
      }
    });
  } catch (error) {
    console.error('[KortexV2] Tenant bootstrap error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to bootstrap tenant',
      message: 'An unexpected error occurred'
    });
  }
});

router.get('/links/:code/resolve', rateLimiter('resolve'), async (req, res) => {
  try {
    const resolved = await KortexV2.resolveLink({
      code: req.params.code,
      namespace: req.query.namespace || req.query.ns || null,
      host: req.query.host || req.headers.host || req.hostname,
      path: req.query.path || '',
      query: req.query,
      req
    });

    return res.json({ success: true, ...resolved });
  } catch (error) {
    console.error('[KortexV2] Link resolve error:', error);
    const gone = new Set(['LINK_DISABLED', 'LINK_EXPIRED', 'LINK_BLOCKED', 'LINK_CAPPED']);
    const status = error.code === 'NOT_FOUND' || error.code === 'TENANT_NOT_FOUND' ? 404
      : gone.has(error.code) ? 410
      : error.code === 'LINK_HELD' ? 409
      : 500;
    const messages = {
      LINK_DISABLED: 'This link has been disabled.',
      LINK_EXPIRED: 'This link has expired.',
      LINK_CAPPED: 'This link has reached its scan limit.',
      LINK_BLOCKED: 'This link has been disabled for safety reasons.',
      LINK_HELD: 'This link is under review and not yet live.'
    };
    return res.status(status).json({
      success: false,
      error: status === 404 ? 'Link not found' : status === 500 ? 'Failed to resolve link' : (messages[error.code] || 'Link unavailable'),
      code: error.code || 'RESOLVE_FAILED',
      message: messages[error.code] || 'An unexpected error occurred'
    });
  }
});

router.post('/events', rateLimiter('api'), async (req, res) => {
  try {
    const event = await KortexV2.recordEvent(req.body.type, req.body, req);
    return res.status(201).json({
      success: true,
      eventId: event.id
    });
  } catch (error) {
    console.error('[KortexV2] Event tracking error:', error);
    const status = error.code === 'INVALID_EVENT_TYPE' || error.code === 'LINK_CODE_REQUIRED' ? 400
      : error.code === 'NOT_FOUND' ? 404
      : 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to track event',
      code: error.code || 'EVENT_TRACKING_FAILED'
    });
  }
});

router.post('/tenant-links', requireAuth, requireAdmin, requireVerifiedEmail, userRateLimit({ maxRequests: 60, windowSeconds: 3600 }), async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const tenantConfig = await getTenantConfig(tenantContext.tenantId);
    const input = pickCreateInput(req.body);
    const link = await KortexV2.createTenantLink({
      tenant: {
        id: tenantConfig.id,
        name: tenantConfig.name,
        domain: tenantConfig.domain,
        pathPrefix: tenantConfig.pathPrefix,
        slug: input.tenantSlug || tenantConfig.id,
        alumniDomain: input.alumniDomain
      },
      actor: req.user,
      data: { ...input, actorIsSuperAdmin: tenantContext.isSuperAdmin }
    });
    recordAudit({ req, action: 'link.created', code: link.code, tenantId: tenantConfig.id, after: link, extra: { path: 'tenant-links' } });

    return res.status(201).json({
      success: true,
      link,
      status: link.status
    });
  } catch (error) {
    console.error('[KortexV2] Tenant link create error:', error);
    const handled = linkWriteError(res, error);
    if (handled) return handled;
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create tenant link',
      code: error.code || 'TENANT_LINK_CREATE_FAILED'
    });
  }
});

/**
 * GET /kortex/analytics/portfolio
 * Portfolio-wide analytics aggregated from the real click_events stream (not the
 * shallow per-link clickCount counters). Super-admins see all tenants; tenant
 * admins are scoped to their own. Admin only.
 */
router.get('/analytics/portfolio', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    // Super-admin sees everything; a tenant admin is scoped to their tenant.
    const tenantId = tenantContext.isSuperAdmin ? null : (tenantContext.tenantId || 'kaayko-default');

    const { getPortfolioAnalytics } = require('./portfolioAnalytics');
    const analytics = await getPortfolioAnalytics({ tenantId });

    return res.json({ success: true, scope: tenantId || 'all', analytics });
  } catch (error) {
    console.error('[Kortex] Portfolio analytics error:', error);
    if (error.message?.includes('Access denied') || error.code?.startsWith('TENANT')) {
      return tenantAccessError(res, error);
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch portfolio analytics', message: 'An unexpected error occurred' });
  }
});

/**
 * GET /kortex/links/:code/analytics
 * Full per-link drill-down, aggregated from retained click_events.
 * Admin only — click history is visitor-level data.
 */
router.get('/links/:code/analytics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) {
      return res.status(400).json({ success: false, error: 'Link code is required' });
    }

    const doc = await db.collection('short_links').doc(code).get();
    let linkData = doc.exists ? doc.data() : null;
    if (!linkData) {
      const q = await db.collection('short_links').where('code', '==', code).limit(1).get();
      if (!q.empty) linkData = q.docs[0].data();
    }
    if (!linkData) {
      return res.status(404).json({ success: false, error: 'Link not found', code });
    }

    const tenantContext = await getTenantFromRequest(req);
    if (!tenantContext.isSuperAdmin) {
      assertTenantAccess(req.user, linkData.tenantId || 'kaayko-default');
    }

    const { getLinkAnalytics } = require('./linkAnalytics');
    const analytics = await getLinkAnalytics(code, linkData);

    return res.json({
      success: true,
      link: {
        code,
        title: linkData.title || null,
        description: linkData.description || null,
        shortUrl: linkData.shortUrl || null,
        destination: linkData.destinations?.web || linkData.webDestination || null,
        destinations: linkData.destinations || null,
        destinationType: linkData.destinationType || null,
        utm: linkData.utm || null,
        campaignId: linkData.campaignId || null,
        tenantId: linkData.tenantId || null,
        tenantName: linkData.tenantName || null,
        createdBy: linkData.createdBy || null,
        createdAt: linkData.createdAt?.toDate?.()?.toISOString() || null,
        enabled: linkData.enabled !== false,
        expiresAt: linkData.expiresAt?.toDate?.()?.toISOString() || null,
        qrCodeUrl: linkData.qrCodeUrl || null,
      },
      analytics,
    });
  } catch (error) {
    console.error('[Kortex] Link analytics error:', error);
    if (error.message?.includes('Access denied') || error.code?.startsWith('TENANT')) {
      return tenantAccessError(res, error);
    }
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch link analytics',
      message: 'An unexpected error occurred',
    });
  }
});

router.get('/tenants/:tenantId/analytics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const tenantContext = await getTenantFromRequest(req);
    if (!tenantContext.isSuperAdmin) {
      assertTenantAccess(req.user, tenantId);
    }

    const analytics = await KortexV2.getTenantAnalytics(tenantId, req.query.limit);
    return res.json({
      success: true,
      tenant: { id: tenantId },
      analytics
    });
  } catch (error) {
    console.error('[KortexV2] Tenant analytics error:', error);
    if (error.message?.includes('tenant') || error.message?.includes('Access denied') || error.code?.startsWith('TENANT')) {
      return tenantAccessError(res, error);
    }
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch tenant analytics',
      message: 'An unexpected error occurred'
    });
  }
});

// ============================================================================
// MIGRATION ENDPOINT - TEMPORARY (Run once to add tenant fields)
// ============================================================================

router.get('/admin/migrate', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { migrateExistingLinksToDefaultTenant } = require('./tenantContext');
    const result = await migrateExistingLinksToDefaultTenant();
    return res.json({
      success: true,
      message: 'Migration completed successfully',
      result
    });
  } catch (error) {
    console.error('[SmartLinks] Migration error:', error);
    return res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: 'An unexpected error occurred'
    });
  }
});

// ============================================================================
// TENANT REGISTRATION - PUBLIC (No auth required, but rate limited)
// ============================================================================

router.post('/tenant-registration', rateLimiter('tenantRegistration'), async (req, res) => {
  try {
    const registrationData = req.body;
    
    console.log('[TenantReg] New registration request:', registrationData.organization?.name);
    
    // Validate required fields
    if (!registrationData.organization?.name || !registrationData.organization?.domain || !registrationData.contact?.email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: organization name, domain, and contact email are required'
      });
    }
    
    // Check if domain already exists
    const existingTenant = await db.collection('tenants')
      .where('domain', '==', registrationData.organization.domain)
      .limit(1)
      .get();
    
    if (!existingTenant.empty) {
      return res.status(409).json({
        success: false,
        error: 'A tenant with this domain already exists'
      });
    }
    
    // Store registration in pending_tenant_registrations collection
    const registrationRef = await db.collection('pending_tenant_registrations').add({
      ...registrationData,
      status: 'pending',
      submittedAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      tenantId: null
    });
    
    console.log('[TenantReg] ✅ Stored registration:', registrationRef.id);
    
    // TODO: Send email notification to admin team
    // TODO: Send confirmation email to applicant
    
    return res.json({
      success: true,
      message: 'Registration submitted successfully',
      registrationId: registrationRef.id,
      estimatedReviewTime: '24-48 hours'
    });
    
  } catch (error) {
    console.error('[TenantReg] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to submit registration',
      message: 'An unexpected error occurred'
    });
  }
});

// ============================================================================
// SELF-SERVICE REGISTRATION (simplified landing page form)
// ============================================================================

router.post('/tenants/register', rateLimiter('tenantRegistration'), async (req, res) => {
  try {
    const { name, email, organization, useCase } = req.body;

    if (!name || !email || !organization) {
      return res.status(400).json({ success: false, error: 'Name, email, and organization are required' });
    }

    const emailLower = email.toLowerCase().trim();
    const existing = await db.collection('pending_tenant_registrations')
      .where('contact.email', '==', emailLower)
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.json({ success: true, message: 'Registration already submitted' });
    }

    await db.collection('pending_tenant_registrations').add({
      organization: { name: organization.trim(), domain: emailLower.split('@')[1] || '' },
      contact: { name: name.trim(), email: emailLower },
      useCase: useCase || 'Not specified',
      source: 'landing_page',
      plan: 'starter',
      status: 'pending',
      submittedAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
      tenantId: null
    });

    console.log(`[TenantReg] Landing page signup: ${organization.trim()} (${emailLower})`);
    return res.json({ success: true, message: 'Account request submitted' });

  } catch (error) {
    console.error('[TenantReg] Landing register error:', error);
    return res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

// ============================================================================
// SELF-SERVE PROVISIONING — creates the tenant + admin profile for a freshly
// signed-up Firebase user. The browser creates the Auth user, sends its ID
// token here, then sends the verification email; writes stay gated until the
// address is verified (requireVerifiedEmail).
// ============================================================================

router.post('/tenants/provision', rateLimiter('tenantProvision'), requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'super-admin') {
      return res.status(400).json({ success: false, error: 'Super-admin accounts do not self-provision', code: 'NOT_APPLICABLE' });
    }
    const { name, organization, useCase } = req.body || {};
    const result = await provisionSelfServeTenant({
      uid: req.user.uid,
      email: req.user.email,
      emailVerified: req.user.emailVerified === true,
      displayName: name,
      organization,
      useCase,
      req
    });
    return res.status(result.existing ? 200 : 201).json({
      success: true,
      ...result,
      next: { verifyEmail: result.user.requireEmailVerification === true && req.user.emailVerified !== true }
    });
  } catch (error) {
    if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ success: false, error: error.message, code: error.code });
    }
    console.error('[Provision] failed:', error);
    return res.status(500).json({ success: false, error: 'Could not create your workspace. Please try again.', code: 'PROVISION_FAILED' });
  }
});

// ============================================================================
// GET TENANTS FOR MULTI-TENANT LOGIN (Must be BEFORE /:code)
// ============================================================================

router.get('/tenants', requireAuth, rateLimiter('tenants'), async (req, res) => {
  try {
    const user = req.user;
    
    // Get user profile from admin_users collection
    const profileDoc = await db.collection('admin_users').doc(user.uid).get();
    
    if (!profileDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'User profile not found'
      });
    }
    
    const profile = profileDoc.data();
    const role = profile.role;
    
    // Super-admins can see all tenants (always includes kaayko-default first)
    if (role === 'super-admin') {
      const tenantsSnapshot = await db.collection('tenants')
        .where('enabled', '==', true)
        .orderBy('name')
        .get();

      const tenants = [
        { id: 'kaayko-default', name: 'Kaayko (All Links)', domain: 'kaayko.com', pathPrefix: '/l' },
        ...tenantsSnapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name,
          domain: doc.data().domain,
          pathPrefix: doc.data().pathPrefix
        }))
      ];

      return res.json({
        success: true,
        role: 'super-admin',
        profile: { role: 'super-admin', requireEmailVerification: false },
        tenants
      });
    }

    // The login page stores this so the SPA can show the verification banner
    // for self-serve accounts without another round trip.
    const profileView = {
      role: role || 'admin',
      requireEmailVerification: profile.requireEmailVerification === true
    };

    // Regular admins only see their assigned tenant(s)
    const tenantId = profile.tenantId || 'kaayko-default';
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();

    if (!tenantDoc.exists) {
      // Fallback to default tenant
      return res.json({
        success: true,
        profile: profileView,
        tenants: [
          { id: 'kaayko-default', name: 'Kaayko (Default)', domain: 'kaayko.com', pathPrefix: '/l' }
        ]
      });
    }

    const tenant = tenantDoc.data();
    return res.json({
      success: true,
      profile: profileView,
      tenants: [{
        id: tenantDoc.id,
        name: tenant.name,
        domain: tenant.domain,
        pathPrefix: tenant.pathPrefix
      }]
    });
    
  } catch (error) {
    console.error('[SmartLinks] Error fetching tenants:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch tenants',
      message: 'An unexpected error occurred'
    });
  }
});

// ============================================================================
// WEEKLY DIGEST MANUAL TRIGGER (admin only)
// ============================================================================

router.post('/digest/trigger', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { generateTenantDigest } = require('./analyticsAlertService');
    // Derive the tenant from the access-controlled context, NOT the raw
    // `x-tenant-id` header — otherwise any tenant admin could pass another
    // tenant's id and read its digest (drops + top links). getTenantFromRequest
    // gates the x-kaayko-tenant-id override to super-admins / the caller's own
    // tenant list.
    const tenantContext = await getTenantFromRequest(req);
    const tenantId = tenantContext.tenantId || 'kaayko-default';
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    const tenantName = tenantDoc.exists ? tenantDoc.data().name : tenantId;

    const digest = await generateTenantDigest(tenantId, tenantName);
    return res.json({ success: true, drops: digest.drops, topLinks: digest.topLinks });
  } catch (error) {
    console.error('[Digest] Manual trigger error:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate digest' });
  }
});

// ============================================================================
// BRANDED QR CODE GENERATION (Pro+ feature)
// ============================================================================

router.post('/qr/generate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { url, code, format, foreground, background, logoUrl, size } = req.body;
    // Access-controlled tenant, not the spoofable raw header — otherwise the
    // Pro-plan branded-QR gate could be evaluated against another tenant.
    const qrTenantContext = await getTenantFromRequest(req);
    const tenantId = qrTenantContext.tenantId || 'kaayko-default';

    if (!url && !code) {
      return res.status(400).json({ success: false, error: 'url or code is required' });
    }

    const targetUrl = url || `https://kaayko.com/l/${code}`;
    const options = { foreground, background, logoUrl, size: size || 400 };

    // Check if branded options require Pro
    const isBranded = foreground || background || logoUrl;
    if (isBranded) {
      const { canUseBrandedQR } = require('./qrService');
      const allowed = await canUseBrandedQR(tenantId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          error: 'Branded QR codes require a Pro plan or higher',
          code: 'PLAN_UPGRADE_REQUIRED'
        });
      }
    }

    const { generateQR, generateQRSvg } = require('./qrService');

    if (format === 'svg') {
      const svg = await generateQRSvg(targetUrl, options);
      return res.json({ success: true, format: 'svg', data: svg });
    }

    const dataUrl = await generateQR(targetUrl, options);
    return res.json({ success: true, format: 'png', data: dataUrl });

  } catch (error) {
    console.error('[QR] Generation error:', error);
    return res.status(500).json({ success: false, error: 'QR generation failed' });
  }
});

// ============================================================================
// ROOTS SYNC PROXY (keeps KORTEX_SYNC_KEY server-side, never in browser)
// ============================================================================

const ROOTS_API_BASE = 'https://cool-schools-api-420407869747.us-central1.run.app/api/v1/roots';

router.post('/roots-sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const syncKey = process.env.KORTEX_SYNC_KEY;
    if (!syncKey) {
      return res.status(500).json({ success: false, error: 'KORTEX_SYNC_KEY not configured' });
    }

    const response = await fetch(`${ROOTS_API_BASE}/invites/kortex-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kortex-Sync-Key': syncKey,
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('[roots-sync] proxy error:', err.message);
    return res.status(502).json({ success: false, error: 'ROOTS sync proxy failed' });
  }
});

// ============================================================================
// LINK STATISTICS (Must be BEFORE /:code)
// ============================================================================

router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const showAll = tenantContext.isSuperAdmin && (req.query.allTenants === 'true' || tenantContext.tenantId === DEFAULT_TENANT_ID);
    const stats = showAll
      ? await LinkService.getLinkStats()
      : await LinkService.getLinkStatsForTenant(tenantContext.tenantId);
    res.json({
      success: true,
      tenant: showAll ? { id: 'all' } : { id: tenantContext.tenantId, name: tenantContext.tenantName },
      stats
    });
  } catch (error) {
    console.error('[SmartLinks] Error fetching stats:', error);
    if (error.message?.includes('tenant') || error.code?.startsWith('TENANT')) {
      return tenantAccessError(res, error);
    }
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

// ============================================================================
// PER-LINK CLICK ANALYTICS (Must be BEFORE /:code)
// ============================================================================

router.get('/:code/clicks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const tenantContext = await getTenantFromRequest(req);

    const linkDoc = await db.collection('short_links').doc(code).get();
    if (!linkDoc.exists) {
      return res.status(404).json({ success: false, error: 'Link not found' });
    }
    const linkData = linkDoc.data();
    if (!tenantContext.isSuperAdmin) {
      assertTenantAccess(req.user, linkData.tenantId || DEFAULT_TENANT_ID);
    }

    let clickDocs = [];

    // Try click_events first (unified collection), fall back to smartLinkClicks (legacy)
    try {
      const snap = await db.collection('click_events')
        .where('linkCode', '==', code)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
      clickDocs = snap.docs;
    } catch (indexErr) {
      // Index may not exist yet — try without ordering
      try {
        const snap = await db.collection('click_events')
          .where('linkCode', '==', code)
          .limit(limit)
          .get();
        clickDocs = snap.docs;
      } catch (_) {
        // Fall back to legacy smartLinkClicks
        const snap = await db.collection('smartLinkClicks')
          .where('code', '==', code)
          .limit(limit)
          .get();
        clickDocs = snap.docs;
      }
    }

    const clicks = clickDocs.map(doc => {
      const d = doc.data();
      return {
        clickId: d.clickId || doc.id,
        platform: d.platform || 'web',
        deviceInfo: d.deviceInfo || {},
        utm: d.utm || {},
        referrer: d.referrer || d.referer || '',
        redirectedTo: d.redirectedTo || '',
        timestamp: d.timestamp?.toDate?.()?.toISOString() || (d.timestampMs ? new Date(d.timestampMs).toISOString() : null)
      };
    });

    const platforms = { web: 0, ios: 0, android: 0 };
    const browsers = {};
    const devices = {};
    const utmSources = {};
    const referrers = {};
    const daily = {};

    clicks.forEach(c => {
      platforms[c.platform] = (platforms[c.platform] || 0) + 1;
      const browser = c.deviceInfo?.browser || 'Unknown';
      browsers[browser] = (browsers[browser] || 0) + 1;
      const device = c.deviceInfo?.deviceType || 'unknown';
      devices[device] = (devices[device] || 0) + 1;
      const src = c.utm?.utm_source || 'direct';
      utmSources[src] = (utmSources[src] || 0) + 1;
      try {
        const ref = c.referrer ? new URL(c.referrer).hostname : 'direct';
        referrers[ref] = (referrers[ref] || 0) + 1;
      } catch (_) {
        referrers['direct'] = (referrers['direct'] || 0) + 1;
      }
      if (c.timestamp) {
        const day = c.timestamp.substring(0, 10);
        daily[day] = (daily[day] || 0) + 1;
      }
    });

    // Include the link's own clickCount even if click_events is empty
    const reportedTotal = Math.max(clicks.length, linkData.clickCount || 0);

    res.json({
      success: true,
      code,
      totalClicks: reportedTotal,
      clicks: clicks.slice(0, 20),
      breakdown: { platforms, browsers, devices, utmSources, referrers },
      daily
    });
  } catch (error) {
    console.error('[SmartLinks] Click analytics error:', error);
    if (error.message?.includes('tenant') || error.code?.startsWith('TENANT')) {
      return tenantAccessError(res, error);
    }
    res.status(500).json({ success: false, error: 'Failed to fetch click analytics' });
  }
});

// ============================================================================
// REDIRECT ROUTE (Must be BEFORE /:code)
// ============================================================================

/**
 * Redirect handler for short codes (lk1ngp, lk9xrf, etc.)
 */
router.get('/r/:code', rateLimiter('resolve'), async (req, res) => {
  const code = req.params.code;
  await handleRedirect(req, res, code, { trackAnalytics: true });
});

// ============================================================================
// API KEY PROVISIONING (Protected - tenant-scoped admin)
// Registered before /:code so GET /api-keys is not swallowed by the catch-all.
// ============================================================================

const ALLOWED_API_KEY_SCOPES = new Set([
  'read:links', 'create:links', 'update:links', 'delete:links', 'read:stats'
]);

router.post('/api-keys', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const { name, scopes = ['read:links'], rateLimitPerMinute } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'name is required', code: 'VALIDATION_ERROR' });
    }

    // Only super-admins may grant the wildcard scope; others are restricted to the known set.
    const requestedScopes = Array.isArray(scopes) ? scopes : [scopes];
    for (const s of requestedScopes) {
      if (s === '*' && !tenantContext.isSuperAdmin) {
        return res.status(403).json({ success: false, error: 'Wildcard scope requires super-admin', code: 'SCOPE_NOT_ALLOWED' });
      }
      if (s !== '*' && !ALLOWED_API_KEY_SCOPES.has(s)) {
        return res.status(400).json({ success: false, error: `Unknown scope: ${s}`, code: 'INVALID_SCOPE' });
      }
    }

    const created = await createApiKey({
      tenantId: tenantContext.tenantId,
      tenantName: tenantContext.tenantName,
      name: String(name).trim(),
      scopes: requestedScopes,
      rateLimitPerMinute: Number(rateLimitPerMinute) || 60
    });

    // The plaintext key is returned exactly once.
    return res.status(201).json({
      success: true,
      apiKey: created.apiKey,
      keyId: created.keyId,
      scopes: created.scopes,
      message: 'Store this key now — it cannot be retrieved again.'
    });
  } catch (error) {
    console.error('[APIKey] Create route error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create API key' });
  }
});

router.get('/api-keys', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const keys = await listApiKeys(tenantContext.tenantId);
    return res.json({ success: true, keys, total: keys.length });
  } catch (error) {
    console.error('[APIKey] List route error:', error);
    return res.status(500).json({ success: false, error: 'Failed to list API keys' });
  }
});

router.delete('/api-keys/:keyId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const keyDoc = await db.collection('api_keys').doc(req.params.keyId).get();
    if (!keyDoc.exists) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }
    if (!tenantContext.isSuperAdmin && keyDoc.data().tenantId !== tenantContext.tenantId) {
      return res.status(403).json({ success: false, error: 'API key belongs to another tenant', code: 'TENANT_ACCESS_DENIED' });
    }
    await revokeApiKey(req.params.keyId);
    return res.json({ success: true, keyId: req.params.keyId, revoked: true });
  } catch (error) {
    console.error('[APIKey] Revoke route error:', error);
    return res.status(500).json({ success: false, error: 'Failed to revoke API key' });
  }
});

// ============================================================================
// WEBHOOK PROVISIONING (Protected - tenant-scoped admin)
// ============================================================================

const VALID_WEBHOOK_EVENTS = new Set(Object.values(EVENT_TYPES));

router.post('/webhooks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const { targetUrl, events, description = '' } = req.body;

    if (!targetUrl) {
      return res.status(400).json({ success: false, error: 'targetUrl is required', code: 'VALIDATION_ERROR' });
    }
    const eventList = Array.isArray(events) ? events : [];
    if (eventList.length === 0 || !eventList.every(e => VALID_WEBHOOK_EVENTS.has(e))) {
      return res.status(400).json({
        success: false,
        error: `events must be a non-empty subset of: ${[...VALID_WEBHOOK_EVENTS].join(', ')}`,
        code: 'INVALID_EVENTS'
      });
    }

    // Generate the signing secret server-side; returned once.
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    const subscription = await createWebhookSubscription({
      tenantId: tenantContext.tenantId,
      targetUrl,
      secret,
      events: eventList,
      description
    });

    return res.status(201).json({
      success: true,
      subscriptionId: subscription.subscriptionId,
      secret,
      events: eventList,
      message: 'Store this signing secret now — it will be masked in future responses.'
    });
  } catch (error) {
    if (error.code === 'INSECURE_WEBHOOK_URL' || error.code === 'BLOCKED_WEBHOOK_URL' || error.code === 'INVALID_WEBHOOK_URL') {
      return res.status(400).json({ success: false, error: error.message, code: error.code });
    }
    console.error('[Webhook] Create route error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create webhook subscription' });
  }
});

router.get('/webhooks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const subscriptions = await listWebhookSubscriptions(tenantContext.tenantId);
    return res.json({ success: true, subscriptions, total: subscriptions.length });
  } catch (error) {
    console.error('[Webhook] List route error:', error);
    return res.status(500).json({ success: false, error: 'Failed to list webhook subscriptions' });
  }
});

async function assertWebhookOwnership(req, tenantContext) {
  const doc = await db.collection('webhook_subscriptions').doc(req.params.id).get();
  if (!doc.exists) return { notFound: true };
  if (!tenantContext.isSuperAdmin && doc.data().tenantId !== tenantContext.tenantId) {
    return { forbidden: true };
  }
  return { doc };
}

router.patch('/webhooks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const ownership = await assertWebhookOwnership(req, tenantContext);
    if (ownership.notFound) return res.status(404).json({ success: false, error: 'Webhook not found' });
    if (ownership.forbidden) return res.status(403).json({ success: false, error: 'Webhook belongs to another tenant', code: 'TENANT_ACCESS_DENIED' });

    const updates = {};
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled === true;
    if (req.body.targetUrl !== undefined) updates.targetUrl = req.body.targetUrl;
    if (Array.isArray(req.body.events)) {
      if (!req.body.events.every(e => VALID_WEBHOOK_EVENTS.has(e))) {
        return res.status(400).json({ success: false, error: 'events contains an unknown type', code: 'INVALID_EVENTS' });
      }
      updates.events = req.body.events;
    }
    if (req.body.description !== undefined) updates.description = req.body.description;

    const updated = await updateWebhookSubscription(req.params.id, updates);
    return res.json({ success: true, subscription: { ...updated, secret: '***' } });
  } catch (error) {
    if (error.code === 'INSECURE_WEBHOOK_URL' || error.code === 'BLOCKED_WEBHOOK_URL' || error.code === 'INVALID_WEBHOOK_URL') {
      return res.status(400).json({ success: false, error: error.message, code: error.code });
    }
    console.error('[Webhook] Update route error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update webhook subscription' });
  }
});

router.delete('/webhooks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const ownership = await assertWebhookOwnership(req, tenantContext);
    if (ownership.notFound) return res.status(404).json({ success: false, error: 'Webhook not found' });
    if (ownership.forbidden) return res.status(403).json({ success: false, error: 'Webhook belongs to another tenant', code: 'TENANT_ACCESS_DENIED' });

    await deleteWebhookSubscription(req.params.id);
    return res.json({ success: true, subscriptionId: req.params.id, deleted: true });
  } catch (error) {
    console.error('[Webhook] Delete route error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete webhook subscription' });
  }
});

// ============================================================================
// REVIEW QUEUE, APPEALS, SAFETY JOBS (Must be BEFORE /:code)
// ============================================================================

/**
 * GET /kortex/:code/clicks.csv — one link's click events as CSV, inside the
 * tenant's plan window. Tenant-scoped like every other read; audited.
 */
router.get('/:code/clicks.csv', requireAuth, requireAdmin, rateLimiter('exportCsv'), async (req, res) => {
  try {
    const { code } = req.params;
    const tenantContext = await getTenantFromRequest(req);
    const linkDoc = await db.collection('short_links').doc(code).get();
    if (!linkDoc.exists) return res.status(404).json({ success: false, error: 'Link not found' });
    const linkData = linkDoc.data();
    const tenantId = linkData.tenantId || DEFAULT_TENANT_ID;
    if (!tenantContext.isSuperAdmin) {
      try { assertTenantAccess(req.user, tenantId); } catch (_) { return res.status(403).json({ success: false, error: 'Access denied' }); }
    }
    const gate = await getTenantGate(tenantId);
    const planWindow = (PLAN_WINDOWS[gate.plan] || PLAN_WINDOWS.starter || {}).analytics_range_days || 30;
    const windowDays = tenantContext.isSuperAdmin ? 30 : Math.min(30, planWindow);
    const { csv, rows } = await linkEventsCsv(code, { windowDays });
    recordAudit({ req, action: 'analytics.exported', code, tenantId, extra: { rows, windowDays, format: 'csv' } });
    return sendCsv(res, `kortex-${code}-clicks.csv`, csv);
  } catch (error) {
    console.error('[Kortex] CSV export failed:', error);
    return res.status(500).json({ success: false, error: 'Export failed' });
  }
});

/**
 * GET /kortex/export/links.csv — every link in the caller's tenant as CSV
 * (the portfolio "Export CSV" button). Super-admins may pass ?allTenants=true.
 */
router.get('/export/links.csv', requireAuth, requireAdmin, rateLimiter('exportCsv'), async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const all = tenantContext.isSuperAdmin && req.query.allTenants === 'true';
    const { links } = await LinkService.listLinks(all ? { limit: 5000 } : { tenantId: tenantContext.tenantId, limit: 5000 });
    const { csv, rows } = workspaceCsv(links);
    recordAudit({ req, action: 'links.exported', tenantId: all ? null : tenantContext.tenantId, extra: { rows, allTenants: all } });
    return sendCsv(res, all ? 'kortex-all-links.csv' : `kortex-${tenantContext.tenantId}-links.csv`, csv);
  } catch (error) {
    console.error('[Kortex] links export failed:', error);
    return res.status(500).json({ success: false, error: 'Export failed' });
  }
});

/**
 * POST /kortex/report — anyone can report a link. Always answers 202 with the
 * same body, so the endpoint reveals nothing about whether a code exists.
 * Two different reporters flagging a guest link for phishing, malware or a
 * scam inside a day hold it for review on the spot.
 */
router.post('/report', rateLimiter('report'), async (req, res) => {
  try {
    const body = req.body || {};
    if (body.website) return res.status(400).json({ success: false, error: 'Invalid request' });
    const result = await abuseReports.fileReport({
      body,
      ip: getClientIp(req),
      userAgent: req.get('user-agent'),
      setLinkStatus: LinkService.setLinkStatus,
      recordAudit,
      req
    });
    if (!result.accepted) return res.status(400).json({ success: false, error: result.error });
    return res.status(202).json({ success: true, message: 'Thanks. A reviewer will look at this link.' });
  } catch (error) {
    console.error('[Kortex] abuse report failed:', error);
    return res.status(500).json({ success: false, error: 'Could not file the report right now' });
  }
});

router.get('/reports', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const reports = await abuseReports.listReports({ status: String(req.query.status || 'open'), limit: Number(req.query.limit) || 100 });
    return res.json({ success: true, reports });
  } catch (error) {
    console.error('[Kortex] list reports failed:', error);
    return res.status(500).json({ success: false, error: 'Could not list reports' });
  }
});

router.post('/reports/:id/resolve', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await abuseReports.resolveReport(req.params.id, { resolution: req.body?.resolution, actor: req.user?.email || req.user?.uid || null });
    recordAudit({ req, action: 'report.resolved', extra: { reportId: req.params.id } });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error.code === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Report not found' });
    console.error('[Kortex] resolve report failed:', error);
    return res.status(500).json({ success: false, error: 'Could not resolve the report' });
  }
});

/**
 * POST /kortex/support — a support request with a plan-aware response target.
 * Signed in: the tenant's plan. Guest session: free. Anonymous: free.
 */
router.post('/support', rateLimiter('support'), optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.website) return res.status(400).json({ success: false, error: 'Invalid request' });
    let requester = { plan: 'free', tenantId: null, via: 'public' };
    if (req.user) {
      const tenantContext = await getTenantFromRequest(req);
      const gate = await getTenantGate(tenantContext.tenantId);
      requester = { plan: tenantContext.isSuperAdmin ? 'business' : gate.plan, tenantId: tenantContext.tenantId, via: 'admin' };
    } else {
      const workspace = await guestAccess.resolveGuestSession(req).catch(() => null);
      if (workspace && workspace.tenantId) requester = { plan: 'free', tenantId: workspace.tenantId, via: 'guest' };
    }
    const result = await supportRequests.createRequest({
      body, requester, ip: getClientIp(req), userAgent: req.get('user-agent'), email: emailDelivery, recordAudit, req
    });
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    return res.status(201).json({ success: true, id: result.id, plan: result.plan, target: result.target, targetBy: result.targetBy });
  } catch (error) {
    console.error('[Kortex] support request failed:', error);
    return res.status(500).json({ success: false, error: 'Could not send the request right now' });
  }
});

router.get('/support', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const requests = await supportRequests.listRequests({ status: String(req.query.status || 'open'), limit: Number(req.query.limit) || 100 });
    return res.json({ success: true, requests });
  } catch (error) {
    console.error('[Kortex] list support failed:', error);
    return res.status(500).json({ success: false, error: 'Could not list requests' });
  }
});

router.post('/support/:id/resolve', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await supportRequests.resolveRequest(req.params.id, { note: req.body?.note, actor: req.user?.email || req.user?.uid || null });
    recordAudit({ req, action: 'support.resolved', extra: { requestId: req.params.id } });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error.code === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Request not found' });
    console.error('[Kortex] resolve support failed:', error);
    return res.status(500).json({ success: false, error: 'Could not resolve the request' });
  }
});

/**
 * POST /kortex/tenants/:tenantId/kill | /restore — the tenant-wide kill switch.
 * Every link of a switched-off workspace answers 410 on the next request.
 */
async function setTenantEnabled(req, res, enabled) {
  try {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId || tenantId === DEFAULT_TENANT_ID) return res.status(400).json({ success: false, error: 'This workspace cannot be switched off' });
    const ref = db.collection('tenants').doc(tenantId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const reason = String(req.body?.reason || '').trim().slice(0, 500) || null;
    const actor = req.user?.email || req.user?.uid || null;
    await ref.update(enabled
      ? { enabled: true, killedAt: null, killedBy: null, killedReason: null, restoredAt: FieldValue.serverTimestamp(), restoredBy: actor, updatedAt: FieldValue.serverTimestamp() }
      : { enabled: false, killedAt: FieldValue.serverTimestamp(), killedBy: actor, killedReason: reason, updatedAt: FieldValue.serverTimestamp() });
    forgetTenant(tenantId);
    recordAudit({ req, action: enabled ? 'tenant.restored' : 'tenant.killed', tenantId, extra: { reason } });
    return res.json({ success: true, tenantId, enabled });
  } catch (error) {
    console.error('[Kortex] tenant switch failed:', error);
    return res.status(500).json({ success: false, error: 'Could not update the workspace' });
  }
}
router.post('/tenants/:tenantId/kill', requireAuth, requireSuperAdmin, (req, res) => setTenantEnabled(req, res, false));
router.post('/tenants/:tenantId/restore', requireAuth, requireSuperAdmin, (req, res) => setTenantEnabled(req, res, true));

/**
 * GET /kortex/review — links that are held for review or blocked.
 * Tenant admins see their own; super-admins see everything (or one tenant via header).
 */
router.get('/review', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const scopeAll = tenantContext.isSuperAdmin && (req.query.allTenants === 'true' || tenantContext.tenantId === DEFAULT_TENANT_ID);
    const requested = String(req.query.status || '').trim();
    const statuses = requested && [LINK_STATUS.HELD, LINK_STATUS.BLOCKED].includes(requested)
      ? [requested]
      : [LINK_STATUS.HELD, LINK_STATUS.BLOCKED];
    const links = await LinkService.listLinksByStatus(statuses, {
      tenantId: scopeAll ? null : tenantContext.tenantId,
      limit: req.query.limit
    });
    return res.json({ success: true, links, total: links.length, statuses });
  } catch (error) {
    console.error('[Review] list error:', error);
    return linkWriteError(res, error) || res.status(500).json({ success: false, error: 'Failed to load review queue' });
  }
});

async function applyReviewDecision(req, res, status, action, options = {}) {
  try {
    const { code } = req.params;
    const reason = String(req.body?.reason || '').trim().slice(0, 500) || null;
    const { before, link } = await LinkService.setLinkStatus(code, status, {
      reason,
      actor: req.user.email || req.user.uid,
      blockedBy: options.blockedBy || null
    });
    await recordAudit({ req, action, code, tenantId: link.tenantId, before, after: link, reason });
    if (status === LINK_STATUS.BLOCKED) {
      db.collection('security_alerts').add({
        type: 'destination_blocked',
        severity: 'high',
        code,
        tenantId: link.tenantId || null,
        reason,
        by: req.user.email || req.user.uid,
        timestamp: FieldValue.serverTimestamp()
      }).catch(() => {});
    }
    return res.json({ success: true, link, previousStatus: effectiveStatus(before) });
  } catch (error) {
    console.error(`[Review] ${action} error:`, error);
    return linkWriteError(res, error) || res.status(500).json({ success: false, error: `Failed to ${action}` });
  }
}

router.post('/review/:code/approve', requireAuth, requireSuperAdmin, (req, res) =>
  applyReviewDecision(req, res, LINK_STATUS.ACTIVE, 'link.approved'));
router.post('/review/:code/block', requireAuth, requireSuperAdmin, (req, res) =>
  applyReviewDecision(req, res, LINK_STATUS.BLOCKED, 'link.blocked', { blockedBy: 'operator' }));
router.post('/review/:code/hold', requireAuth, requireSuperAdmin, (req, res) =>
  applyReviewDecision(req, res, LINK_STATUS.HELD, 'link.held'));

/**
 * POST /kortex/appeals — public form behind held/blocked pages.
 * Always answers 202 so it cannot be used to enumerate codes.
 */
router.post('/appeals', rateLimiter('appeal'), async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
    const message = String(req.body?.message || '').trim().slice(0, 2000);

    if (!/^[a-zA-Z0-9_-]{3,80}$/.test(code)) {
      return res.status(400).json({ success: false, error: 'A valid link code is required', code: 'VALIDATION_ERROR' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email address is required', code: 'VALIDATION_ERROR' });
    }
    if (message.length < 10) {
      return res.status(400).json({ success: false, error: 'Tell us a little more (at least 10 characters)', code: 'VALIDATION_ERROR' });
    }

    const linkDoc = await db.collection('short_links').doc(code).get();
    if (linkDoc.exists) {
      const link = linkDoc.data() || {};
      await db.collection('kortex_appeals').add({
        code,
        tenantId: link.tenantId || DEFAULT_TENANT_ID,
        linkStatus: effectiveStatus(link),
        email,
        message,
        status: 'open',
        ipHash: hashIpForStorage(getClientIp(req)),
        userAgent: String(req.get('user-agent') || '').slice(0, 300),
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: Date.now()
      });
      recordAudit({ req, action: 'link.appealed', code, tenantId: link.tenantId || DEFAULT_TENANT_ID, extra: { email } });
    }
    return res.status(202).json({ success: true, message: 'Thanks. A reviewer will look at this link and reply by email.' });
  } catch (error) {
    console.error('[Appeals] submit error:', error);
    return res.status(500).json({ success: false, error: 'Could not submit the appeal right now' });
  }
});

router.get('/appeals', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || 'open');
    const snapshot = await db.collection('kortex_appeals').where('status', '==', status).limit(200).get();
    const appeals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    return res.json({ success: true, appeals, total: appeals.length });
  } catch (error) {
    console.error('[Appeals] list error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load appeals' });
  }
});

router.post('/appeals/:id/resolve', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const ref = db.collection('kortex_appeals').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, error: 'Appeal not found' });
    const resolution = String(req.body?.resolution || '').trim().slice(0, 1000) || null;
    await ref.update({
      status: 'resolved',
      resolution,
      resolvedBy: req.user.email || req.user.uid,
      resolvedAt: FieldValue.serverTimestamp()
    });
    recordAudit({ req, action: 'appeal.resolved', code: doc.data().code, tenantId: doc.data().tenantId, reason: resolution });
    return res.json({ success: true });
  } catch (error) {
    console.error('[Appeals] resolve error:', error);
    return res.status(500).json({ success: false, error: 'Failed to resolve appeal' });
  }
});

/** Manual triggers for the scheduled safety jobs (super-admin). */
router.post('/security/feeds/sync', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const summary = await safetyJobs.syncThreatFeeds();
    recordAudit({ req, action: 'safety.feeds_synced', extra: summary });
    return res.json({ success: true, summary });
  } catch (error) {
    console.error('[Safety] feed sync error:', error);
    return res.status(500).json({ success: false, error: 'Feed sync failed' });
  }
});

router.post('/security/rescan', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await safetyJobs.rescanActiveLinks({
      limit: req.body?.limit,
      tenantId: req.body?.tenantId ? String(req.body.tenantId) : null
    });
    recordAudit({ req, action: 'safety.rescan', extra: { scanned: result.scanned, blocked: result.blocked.length, errors: result.errors } });
    return res.json({ success: true, result });
  } catch (error) {
    console.error('[Safety] rescan error:', error);
    return res.status(500).json({ success: false, error: 'Re-scan failed' });
  }
});

/** Audit trail for one link (tenant-scoped). */
router.get('/:code/audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const link = await LinkService.getShortLink(code);
    const tenantContext = await getTenantFromRequest(req);
    if (!tenantContext.isSuperAdmin) {
      assertTenantAccess(req.user, link.tenantId || DEFAULT_TENANT_ID);
    }
    const entries = await listAudit({ code, limit: req.query.limit });
    return res.json({ success: true, code, entries, total: entries.length });
  } catch (error) {
    console.error('[Audit] list error:', error);
    return linkWriteError(res, error) || res.status(500).json({ success: false, error: 'Failed to load audit trail' });
  }
});

// ============================================================================
// CREATE SHORT LINK (Protected - Requires Authentication)
// ============================================================================

router.post('/', rateLimiter('linkCreate'), requireAuth, requireAdmin, requireVerifiedEmail, userRateLimit({ maxRequests: 60, windowSeconds: 3600 }), async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const tenantConfig = await getTenantConfig(tenantContext.tenantId);

    // Only allowlisted fields come from the client; tenant, creator, safety
    // verdict and status are always derived server-side.
    const input = pickCreateInput(req.body);

    // Domain policy + plan quota + destination safety are enforced in the
    // service layer so every creation path shares one rule. Super-admins may
    // bypass the Kaayko domain whitelist with destinationCategory==='custom'.
    const isCustomBypass = tenantContext.isSuperAdmin && input.destinationCategory === 'custom';

    const linkData = {
      ...input,
      bypassDomainCheck: isCustomBypass,
      actorIsSuperAdmin: tenantContext.isSuperAdmin,
      createdBy: req.user.email || req.user.uid,
      tenantId: tenantConfig.id,
      tenantName: tenantConfig.name,
      domain: tenantConfig.domain,
      pathPrefix: tenantConfig.pathPrefix
    };

    const link = await LinkService.createShortLink(linkData);
    recordAudit({ req, action: 'link.created', code: link.code, tenantId: tenantConfig.id, after: link });
    
    // Send email notification to admin (async, don't block response)
    sendLinkCreatedNotification(link, req.user).then(result => {
      if (result.success) {
        console.log('✅ Email notification sent:', result.messageId);
      } else {
        console.error('⚠️ Email notification failed:', result.error);
      }
    }).catch(err => {
      console.error('⚠️ Email notification error:', err);
    });

    // Trigger webhooks (async, don't block response)
    triggerWebhooks({
      tenantId: tenantConfig.id,
      eventType: EVENT_TYPES.LINK_CREATED,
      payload: {
        event: 'link.created',
        link: {
          code: link.code,
          shortUrl: link.shortUrl,
          title: link.title,
          destinations: link.destinations,
          createdBy: link.createdBy,
          createdAt: link.createdAt
        },
        timestamp: new Date().toISOString()
      }
    }).catch(err => {
      console.error('⚠️ Webhook trigger error:', err);
    });
    
    res.json({
      success: true,
      link,
      status: link.status,
      message: link.status === LINK_STATUS.HELD
        ? `Short link created and held for a quick review: ${link.shortUrl}`
        : `Short link created: ${link.shortUrl}`
    });
  } catch (error) {
    console.error('[SmartLinks] Error creating short link:', error);
    const handled = linkWriteError(res, error);
    if (handled) return handled;
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create link'
    });
  }
});

// ============================================================================
// LIST ALL LINKS (Protected - Requires Admin Role)
// ============================================================================

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, limit } = req.query;
    const tenantContext = await getTenantFromRequest(req);
    
    const filters = {
      tenantId: tenantContext.isSuperAdmin && (req.query.allTenants === 'true' || tenantContext.tenantId === DEFAULT_TENANT_ID)
        ? undefined
        : tenantContext.tenantId
    };
    if (enabled !== undefined) filters.enabled = enabled === 'true';
    if (limit) filters.limit = parseInt(limit, 10);
    
    const result = await LinkService.listLinks(filters);
    res.json({ 
      success: true, 
      tenant: filters.tenantId
        ? { id: tenantContext.tenantId, name: tenantContext.tenantName }
        : { id: 'all' },
      ...result
    });
  } catch (error) {
    console.error('[SmartLinks] Error listing links:', error);
    if (error.message?.includes('tenant') || error.code?.startsWith('TENANT')) {
      return tenantAccessError(res, error);
    }
    res.status(500).json({
      success: false,
      error: 'Failed to fetch links',
      message: 'An unexpected error occurred'
    });
  }
});

// ============================================================================
// GET LINK BY CODE (Must be AFTER specific routes like /health, /stats, /r/:code)
// ============================================================================

router.get('/:code', requireAuth, async (req, res) => {
  try {
    const { code } = req.params;
    const link = await LinkService.getShortLink(code);
    // Other tenants get the same 404 as a missing code: no metadata oracle.
    if (!canReadLink(req.user, link)) {
      return res.status(404).json({ success: false, error: 'Short code not found' });
    }
    res.json({ success: true, link });
  } catch (error) {
    console.error('[SmartLinks] Error fetching link:', error);
    
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Short code not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch link'
    });
  }
});

// ============================================================================
// UPDATE LINK (Protected - Requires Admin Role)
// ============================================================================

router.put('/:code', requireAuth, requireAdmin, requireVerifiedEmail, async (req, res) => {
  try {
    const { code } = req.params;
    const updates = pickUpdateInput(req.body);
    const existingLink = await LinkService.getShortLink(code);
    const tenantContext = await getTenantFromRequest(req);
    if (!tenantContext.isSuperAdmin) {
      assertTenantAccess(req.user, existingLink.tenantId || DEFAULT_TENANT_ID);
    }

    // Domain policy + safety are enforced in the service layer. Super-admins may
    // bypass the Kaayko whitelist with destinationCategory==='custom'.
    const isCustomBypass = tenantContext.isSuperAdmin && updates.destinationCategory === 'custom';

    const link = await LinkService.updateShortLink(code, {
      ...updates,
      bypassDomainCheck: isCustomBypass,
      actorIsSuperAdmin: tenantContext.isSuperAdmin,
      updatedBy: req.user.email || req.user.uid
    });
    recordAudit({ req, action: 'link.updated', code, tenantId: existingLink.tenantId || DEFAULT_TENANT_ID, before: existingLink, after: link });

    // Fire link.updated webhook (async, non-blocking).
    triggerWebhooks({
      tenantId: existingLink.tenantId || DEFAULT_TENANT_ID,
      eventType: EVENT_TYPES.LINK_UPDATED,
      payload: {
        event: 'link.updated',
        link: { code: link.code, shortUrl: link.shortUrl, title: link.title, destinations: link.destinations },
        timestamp: new Date().toISOString()
      }
    }).catch(err => console.error('⚠️ Webhook trigger error (update):', err));

    res.json({ success: true, link, status: link.status });
  } catch (error) {
    console.error('[SmartLinks] Error updating link:', error);
    const handled = linkWriteError(res, error);
    if (handled) return handled;
    res.status(500).json({
      success: false,
      error: 'Failed to update link'
    });
  }
});

// ============================================================================
// DELETE LINK (Protected - Requires Admin)
// ============================================================================

router.delete('/:code', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const existingLink = await LinkService.getShortLink(code);
    const tenantContext = await getTenantFromRequest(req);
    if (!tenantContext.isSuperAdmin) {
      assertTenantAccess(req.user, existingLink.tenantId || DEFAULT_TENANT_ID);
    }

    const result = await LinkService.deleteShortLink(code);
    recordAudit({ req, action: 'link.deleted', code, tenantId: existingLink.tenantId || DEFAULT_TENANT_ID, before: existingLink });

    // Fire link.deleted webhook (async, non-blocking).
    triggerWebhooks({
      tenantId: existingLink.tenantId || DEFAULT_TENANT_ID,
      eventType: EVENT_TYPES.LINK_DELETED,
      payload: {
        event: 'link.deleted',
        link: { code, shortUrl: existingLink.shortUrl, title: existingLink.title },
        timestamp: new Date().toISOString()
      }
    }).catch(err => console.error('⚠️ Webhook trigger error (delete):', err));

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[SmartLinks] Error deleting link:', error);
    
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Link not found'
      });
    }

    if (error.message?.includes('tenant') || error.message?.includes('Access denied') || error.code?.startsWith('TENANT')) {
      return tenantAccessError(res, error);
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete link'
    });
  }
});

// ============================================================================
// TRACK EVENTS (Install, Open, etc.)
// ============================================================================

router.post('/events/:type', rateLimiter('api'), async (req, res) => {
  try {
    const { type } = req.params;
    const { linkId, userId, platform, metadata = {}, clickId } = req.body;

    if (!ALLOWED_PUBLIC_EVENT_TYPES.has(type)) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported event type',
        code: 'INVALID_EVENT_TYPE'
      });
    }

    if (!linkId) {
      return res.status(400).json({
        success: false,
        error: 'linkId is required'
      });
    }

    const link = await LinkService.getShortLink(linkId);
    if (link.enabled === false) {
      return res.status(410).json({
        success: false,
        error: 'Link disabled',
        code: 'LINK_DISABLED'
      });
    }

    // Unauthenticated callers must present the clickId Kortex appended to the
    // destination; without it anyone could inflate any tenant's counters.
    if (!clickId || typeof clickId !== 'string' || clickId.length > 64) {
      return res.status(400).json({
        success: false,
        error: 'clickId is required (Kortex appends it to the destination URL)',
        code: 'CLICK_ID_REQUIRED'
      });
    }

    const clickRef = db.collection('click_events').doc(clickId);
    const clickDoc = await clickRef.get();
    if (!clickDoc.exists || clickDoc.data().linkCode !== linkId) {
      return res.status(404).json({
        success: false,
        error: 'No click matches this clickId for the given link',
        code: 'CLICK_NOT_FOUND'
      });
    }

    // Track event in analytics collection
    const eventData = {
      type,
      linkId,
      clickId,
      tenantId: link.tenantId || DEFAULT_TENANT_ID,
      userId: userId ? String(userId).slice(0, 200) : null,
      platform: platform ? String(platform).slice(0, 40) : 'unknown',
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      timestamp: FieldValue.serverTimestamp()
    };

    await db.collection('link_analytics').add(eventData);

    // Update link stats if it's an install event (once per click)
    let attributed = false;
    if (type === 'install' && clickDoc.data().installAttributed !== true) {
      await Promise.all([
        db.collection('short_links').doc(linkId).update({ installCount: FieldValue.increment(1) }),
        clickRef.update({ installAttributed: true, installTimestamp: FieldValue.serverTimestamp() })
      ]);
      attributed = true;
    }

    res.json({
      success: true,
      attributed,
      message: `${type} event tracked`
    });

  } catch (error) {
    console.error('[SmartLinks] Error tracking event:', error);
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Link not found'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to track event'
    });
  }
});

// ============================================================================
// SECURITY: Canary/Honeypot Link Management (Super-admin only)
// ============================================================================

router.post('/security/canary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    if (!tenantContext.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'Super-admin only' });
    }

    const { tenantId, tenantSlug } = req.body;
    if (!tenantId || !tenantSlug) {
      return res.status(400).json({ success: false, error: 'tenantId and tenantSlug required' });
    }

    const { createCanaryLink } = require('./linkSecurityService');
    const canary = await createCanaryLink(tenantId, tenantSlug);
    return res.status(201).json({ success: true, canary });
  } catch (error) {
    console.error('[Security] Canary creation error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create canary link' });
  }
});

router.get('/security/alerts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    let query = db.collection('security_alerts').orderBy('timestamp', 'desc').limit(50);

    if (!tenantContext.isSuperAdmin) {
      query = query.where('tenantId', '==', tenantContext.tenantId);
    }

    const snapshot = await query.get();
    const alerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ success: true, alerts, total: alerts.length });
  } catch (error) {
    console.error('[Security] Alerts fetch error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch security alerts' });
  }
});

module.exports = router;
