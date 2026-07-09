/**
 * Billing API Router
 * Handles subscription management and payment operations for Kortex Smart Links
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const db = admin.firestore();
const { requireAuth } = require('../../middleware/authMiddleware');
const { getTenantFromRequest } = require('../kortex/tenantContext');

// Stripe configuration - only initialize if key is available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Price IDs - Configure these in Stripe Dashboard
const PRICE_IDS = {
  pro: process.env.STRIPE_PRICE_PRO || 'price_pro_monthly',
  business: process.env.STRIPE_PRICE_BUSINESS || 'price_business_monthly'
};

// Plan limits — enforced across the platform
const PLAN_LIMITS = {
  starter: { links: 25, api_calls: 0, campaigns: 3, analytics_range_days: 7 },
  pro: { links: 500, api_calls: 5000, campaigns: 25, analytics_range_days: 90 },
  business: { links: 2500, api_calls: 25000, campaigns: Infinity, analytics_range_days: Infinity },
  enterprise: { links: Infinity, api_calls: Infinity, campaigns: Infinity, analytics_range_days: Infinity }
};

/**
 * Helper to check if Stripe is configured
 */
function requireStripe(req, res, next) {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      error: 'Payment system not configured',
      message: 'Please contact support to enable payments'
    });
  }
  next();
}

/**
 * GET /billing/config
 * Get Stripe publishable key
 */
router.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    configured: !!stripe
  });
});

/**
 * GET /billing/subscription
 * Get current subscription for authenticated user/tenant
 */
router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const { tenantId } = await getTenantFromRequest(req);
    
    // Get tenant subscription from Firestore
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    
    if (!tenantDoc.exists) {
      return res.json({
        success: true,
        subscription: {
          plan: 'starter',
          status: 'active',
          linksUsed: 0,
          clicksUsed: 0
        }
      });
    }
    
    const tenantData = tenantDoc.data();
    
    // Get usage stats
    const linksSnapshot = await db.collection('short_links')
      .where('tenantId', '==', tenantId)
      .get();
    
    const linksUsed = linksSnapshot.size;
    const clicksUsed = linksSnapshot.docs.reduce((sum, doc) => {
      return sum + (doc.data().clickCount || 0);
    }, 0);
    
    res.json({
      success: true,
      subscription: {
        plan: tenantData.plan || 'starter',
        status: tenantData.subscriptionStatus || 'active',
        stripeCustomerId: tenantData.stripeCustomerId,
        stripeSubscriptionId: tenantData.stripeSubscriptionId,
        currentPeriodEnd: tenantData.currentPeriodEnd,
        linksUsed,
        clicksUsed,
        limits: PLAN_LIMITS[tenantData.plan || 'starter']
      }
    });
    
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /billing/create-checkout
 * Create Stripe Checkout session for subscription upgrade
 */
router.post('/create-checkout', requireAuth, requireStripe, async (req, res) => {
  try {
    const { planId } = req.body;
    const { tenantId } = await getTenantFromRequest(req);
    const userEmail = req.user.email;
    
    if (!planId || !PRICE_IDS[planId]) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid plan selected' 
      });
    }
    
    // Get or create Stripe customer
    let customerId;
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    
    if (tenantDoc.exists && tenantDoc.data().stripeCustomerId) {
      customerId = tenantDoc.data().stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          tenantId,
          userId: req.user.uid
        }
      });
      customerId = customer.id;
      
      // Save customer ID to tenant
      await db.collection('tenants').doc(tenantId).set({
        stripeCustomerId: customerId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: PRICE_IDS[planId],
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'https://kaayko.com'}/admin/smartlinks.html?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://kaayko.com'}/admin/smartlinks.html?billing=cancelled`,
      metadata: {
        tenantId,
        userId: req.user.uid,
        planId
      }
    });
    
    res.json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
    
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /billing/downgrade
 * Schedule downgrade to a lower plan
 */
router.post('/downgrade', requireAuth, async (req, res) => {
  try {
    const { planId } = req.body;
    const { tenantId } = await getTenantFromRequest(req);
    
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    
    if (!tenantDoc.exists || !tenantDoc.data().stripeSubscriptionId) {
      // No active subscription, just update plan
      await db.collection('tenants').doc(tenantId).set({
        plan: planId,
        scheduledDowngrade: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      return res.json({
        success: true,
        message: 'Plan updated immediately'
      });
    }
    
    // Need Stripe for subscription management
    if (!stripe) {
      return res.status(503).json({
        success: false,
        error: 'Payment system not configured'
      });
    }
    
    // Schedule downgrade at end of billing period
    const subscriptionId = tenantDoc.data().stripeSubscriptionId;
    
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
      metadata: {
        scheduledPlan: planId
      }
    });
    
    await db.collection('tenants').doc(tenantId).update({
      scheduledDowngrade: planId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      message: 'Downgrade scheduled for end of billing period'
    });
    
  } catch (error) {
    console.error('Downgrade error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NOTE: POST /billing/webhook is intentionally NOT defined here.
// It requires the raw (unparsed) request body for Stripe signature verification,
// so it is mounted before the global express.json() in functions/index.js via
// ./stripeWebhook.js. Defining it here would never receive a verifiable body.

/**
 * GET /billing/usage
 * Get detailed usage metrics for the current billing period
 */
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const { tenantId } = await getTenantFromRequest(req);
    
    // Get tenant info
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    const plan = tenantDoc.exists ? (tenantDoc.data().plan || 'starter') : 'starter';
    const limits = PLAN_LIMITS[plan];
    
    // Get links count
    const linksSnapshot = await db.collection('short_links')
      .where('tenantId', '==', tenantId)
      .get();
    
    const linksUsed = linksSnapshot.size;
    const totalClicks = linksSnapshot.docs.reduce((sum, doc) => {
      return sum + (doc.data().clickCount || 0);
    }, 0);
    
    // Get this month's API calls (if tracked)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    let apiCallsUsed = 0;
    try {
      const apiCallsSnapshot = await db.collection('api_usage')
        .where('tenantId', '==', tenantId)
        .where('timestamp', '>=', startOfMonth)
        .get();
      apiCallsUsed = apiCallsSnapshot.size;
    } catch (e) {
      // api_usage collection may not exist
    }
    
    res.json({
      success: true,
      usage: {
        links: {
          used: linksUsed,
          limit: limits.links,
          percentage: limits.links === Infinity ? 0 : Math.round((linksUsed / limits.links) * 100)
        },
        clicks: {
          total: totalClicks,
          limit: Infinity,
          percentage: 0
        },
        apiCalls: {
          used: apiCallsUsed,
          limit: limits.api_calls,
          percentage: limits.api_calls === Infinity ? 0 : Math.round((apiCallsUsed / limits.api_calls) * 100)
        },
        plan,
        billingPeriod: {
          start: startOfMonth.toISOString(),
          end: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 0).toISOString()
        }
      }
    });
    
  } catch (error) {
    console.error('Get usage error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.PLAN_LIMITS = PLAN_LIMITS;
