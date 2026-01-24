/**
 * Billing API Router
 * Handles subscription management and payment operations for Kortex Smart Links
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const db = admin.firestore();
const { requireAuth } = require('../../middleware/authMiddleware');

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

// Plan limits
const PLAN_LIMITS = {
  starter: { links: 25, api_calls: 0 },
  pro: { links: 500, api_calls: 5000 },
  business: { links: 2500, api_calls: 25000 },
  enterprise: { links: Infinity, api_calls: Infinity }
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
    const tenantId = req.user.tenantId || 'kaayko';
    
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
    const tenantId = req.user.tenantId || 'kaayko';
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
    const tenantId = req.user.tenantId || 'kaayko';
    
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

/**
 * POST /billing/webhook
 * Handle Stripe webhook events for subscription lifecycle
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }
  
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    return res.status(503).json({ error: 'Webhook secret not configured' });
  }
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { tenantId, planId } = session.metadata;
      
      // Update tenant with subscription details
      await db.collection('tenants').doc(tenantId).update({
        plan: planId,
        stripeSubscriptionId: session.subscription,
        subscriptionStatus: 'active',
        currentPeriodEnd: new Date(session.expires_at * 1000),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`✅ Subscription activated: ${tenantId} → ${planId}`);
      break;
    }
    
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      
      // Find tenant by customer ID
      const tenantsSnapshot = await db.collection('tenants')
        .where('stripeCustomerId', '==', customerId)
        .limit(1)
        .get();
      
      if (!tenantsSnapshot.empty) {
        const tenantDoc = tenantsSnapshot.docs[0];
        await tenantDoc.ref.update({
          subscriptionStatus: subscription.status,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      break;
    }
    
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const scheduledPlan = subscription.metadata?.scheduledPlan || 'starter';
      
      // Find tenant and downgrade
      const tenantsSnapshot = await db.collection('tenants')
        .where('stripeCustomerId', '==', customerId)
        .limit(1)
        .get();
      
      if (!tenantsSnapshot.empty) {
        const tenantDoc = tenantsSnapshot.docs[0];
        await tenantDoc.ref.update({
          plan: scheduledPlan,
          subscriptionStatus: 'cancelled',
          stripeSubscriptionId: null,
          scheduledDowngrade: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`📉 Subscription cancelled: ${tenantDoc.id} → ${scheduledPlan}`);
      }
      break;
    }
    
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      
      // Mark subscription as past_due
      const tenantsSnapshot = await db.collection('tenants')
        .where('stripeCustomerId', '==', customerId)
        .limit(1)
        .get();
      
      if (!tenantsSnapshot.empty) {
        const tenantDoc = tenantsSnapshot.docs[0];
        await tenantDoc.ref.update({
          subscriptionStatus: 'past_due',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`⚠️ Payment failed: ${tenantDoc.id}`);
      }
      break;
    }
    
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
  
  res.json({ received: true });
});

/**
 * GET /billing/usage
 * Get detailed usage metrics for the current billing period
 */
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId || 'kaayko';
    
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
