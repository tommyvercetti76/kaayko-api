/**
 * functions/src/api/smartLinks.js
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
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

// Import modular utilities and services
const { handleRedirect } = require('./redirectHandler');
const LinkService = require('./smartLinkService');

// Import authentication middleware
const { requireAuth, requireAdmin, optionalAuth } = require('../../middleware/authMiddleware');

// Import tenant context
const {
  getTenantFromRequest,
  assertTenantAccess,
  DEFAULT_TENANT_ID
} = require('./tenantContext');

// Import notification service
const { sendLinkCreatedNotification } = require('../../services/emailNotificationService');

// Import webhook service
const { triggerWebhooks, EVENT_TYPES } = require('./webhookService');

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

function publicLinkView(link) {
  return {
    code: link.code,
    shortUrl: link.shortUrl,
    title: link.title || '',
    description: link.description || '',
    enabled: link.enabled !== false,
    expiresAt: link.expiresAt || null
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
// MIGRATION ENDPOINT - TEMPORARY (Run once to add tenant fields)
// ============================================================================

router.get('/admin/migrate', requireAuth, requireAdmin, async (req, res) => {
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
      message: error.message
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
      message: error.message
    });
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
    
    // Super-admins can see all tenants
    if (role === 'super-admin') {
      const tenantsSnapshot = await db.collection('tenants')
        .where('enabled', '==', true)
        .orderBy('name')
        .get();
      
      const tenants = tenantsSnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        domain: doc.data().domain,
        pathPrefix: doc.data().pathPrefix
      }));
      
      return res.json({
        success: true,
        tenants: tenants.length > 0 ? tenants : [
          { id: 'kaayko-default', name: 'Kaayko (Default)', domain: 'kaayko.com', pathPrefix: '/l' }
        ]
      });
    }
    
    // Regular admins only see their assigned tenant(s)
    const tenantId = profile.tenantId || 'kaayko-default';
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    
    if (!tenantDoc.exists) {
      // Fallback to default tenant
      return res.json({
        success: true,
        tenants: [
          { id: 'kaayko-default', name: 'Kaayko (Default)', domain: 'kaayko.com', pathPrefix: '/l' }
        ]
      });
    }
    
    const tenant = tenantDoc.data();
    return res.json({
      success: true,
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
      message: error.message
    });
  }
});

// ============================================================================
// LINK STATISTICS (Must be BEFORE /:code)
// ============================================================================

router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const stats = tenantContext.isSuperAdmin && req.query.allTenants === 'true'
      ? await LinkService.getLinkStats()
      : await LinkService.getLinkStatsForTenant(tenantContext.tenantId);
    res.json({
      success: true,
      tenant: tenantContext.isSuperAdmin && req.query.allTenants === 'true'
        ? { id: 'all' }
        : { id: tenantContext.tenantId, name: tenantContext.tenantName },
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
// REDIRECT ROUTE (Must be BEFORE /:code)
// ============================================================================

/**
 * Redirect handler for short codes (lk1ngp, lk9xrf, etc.)
 */
router.get('/r/:code', async (req, res) => {
  const code = req.params.code;
  await handleRedirect(req, res, code, { trackAnalytics: false });
});

// ============================================================================
// CREATE SHORT LINK (Protected - Requires Authentication)
// ============================================================================

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    const tenantConfig = await getTenantConfig(tenantContext.tenantId);

    // Add creator info and tenant-owned domain settings.
    // Client-supplied domain/pathPrefix are ignored for non-super-admin tenant safety.
    const linkData = {
      ...req.body,
      createdBy: req.user.email || req.user.uid,
      tenantId: tenantConfig.id,
      tenantName: tenantConfig.name,
      domain: tenantConfig.domain,
      pathPrefix: tenantConfig.pathPrefix
    };
    
    const link = await LinkService.createShortLink(linkData);
    
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
      message: `Short link created: ${link.shortUrl}`
    });
  } catch (error) {
    console.error('[SmartLinks] Error creating short link:', error);
    
    if (error.code === 'ALREADY_EXISTS') {
      return res.status(409).json({
        success: false,
        error: error.message,
        existing: error.existing
      });
    }
    
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
      tenantId: tenantContext.isSuperAdmin && req.query.allTenants === 'true'
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
      message: error.message
    });
  }
});

// ============================================================================
// GET LINK BY CODE (Must be AFTER specific routes like /health, /stats, /r/:code)
// ============================================================================

router.get('/:code', optionalAuth, async (req, res) => {
  try {
    const { code } = req.params;
    const link = await LinkService.getShortLink(code);
    const safeLink = canReadLink(req.user, link) ? link : publicLinkView(link);
    res.json({ success: true, link: safeLink });
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

router.put('/:code', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const updates = req.body;
    const existingLink = await LinkService.getShortLink(code);
    const tenantContext = await getTenantFromRequest(req);
    if (!tenantContext.isSuperAdmin) {
      assertTenantAccess(req.user, existingLink.tenantId || DEFAULT_TENANT_ID);
    }
    
    const link = await LinkService.updateShortLink(code, updates);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[SmartLinks] Error updating link:', error);
    
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

router.post('/events/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { linkId, userId, platform, metadata = {} } = req.body;

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

    // Track event in analytics collection
    const eventData = {
      type,
      linkId,
      tenantId: link.tenantId || DEFAULT_TENANT_ID,
      userId: userId || null,
      platform: platform || 'unknown',
      metadata,
      timestamp: FieldValue.serverTimestamp()
    };

    await db.collection('link_analytics').add(eventData);

    // Update link stats if it's an install event
    if (type === 'install') {
      await db.collection('short_links').doc(linkId).update({
        installCount: FieldValue.increment(1)
      });
    }

    res.json({ 
      success: true, 
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

module.exports = router;
