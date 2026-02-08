// Billing Handlers – request handler logic for billing routes
// Extracted from billing/router.js for primer compliance

const express = require('express');
const admin = require('firebase-admin');
const { stripe, db, PRICE_IDS, PLAN_LIMITS } = require('./billingConfig');

/**
 * GET /billing/subscription – current subscription for authenticated user/tenant
 */
async function handleGetSubscription(req, res) {
  try {
    const tenantId = req.user.tenantId || 'kaayko';
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();

    if (!tenantDoc.exists) {
      return res.json({
        success: true,
        subscription: { plan: 'starter', status: 'active', linksUsed: 0, clicksUsed: 0 }
      });
    }

    const tenantData = tenantDoc.data();
    const linksSnapshot = await db.collection('short_links')
      .where('tenantId', '==', tenantId).get();
    const linksUsed = linksSnapshot.size;
    const clicksUsed = linksSnapshot.docs.reduce((sum, doc) => sum + (doc.data().clickCount || 0), 0);

    res.json({
      success: true,
      subscription: {
        plan: tenantData.plan || 'starter',
        status: tenantData.subscriptionStatus || 'active',
        stripeCustomerId: tenantData.stripeCustomerId,
        stripeSubscriptionId: tenantData.stripeSubscriptionId,
        currentPeriodEnd: tenantData.currentPeriodEnd,
        linksUsed, clicksUsed,
        limits: PLAN_LIMITS[tenantData.plan || 'starter']
      }
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /billing/create-checkout – Stripe Checkout session for subscription upgrade
 */
async function handleCreateCheckout(req, res) {
  try {
    const { planId } = req.body;
    const tenantId = req.user.tenantId || 'kaayko';
    const userEmail = req.user.email;

    if (!planId || !PRICE_IDS[planId]) {
      return res.status(400).json({ success: false, error: 'Invalid plan selected' });
    }

    // Get or create Stripe customer
    let customerId;
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();

    if (tenantDoc.exists && tenantDoc.data().stripeCustomerId) {
      customerId = tenantDoc.data().stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { tenantId, userId: req.user.uid }
      });
      customerId = customer.id;
      await db.collection('tenants').doc(tenantId).set({
        stripeCustomerId: customerId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[planId], quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'https://kaayko.com'}/admin/kortex.html?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://kaayko.com'}/admin/kortex.html?billing=cancelled`,
      metadata: { tenantId, userId: req.user.uid, planId }
    });

    res.json({ success: true, sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /billing/downgrade – schedule downgrade to a lower plan
 */
async function handleDowngrade(req, res) {
  try {
    const { planId } = req.body;
    const tenantId = req.user.tenantId || 'kaayko';
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();

    if (!tenantDoc.exists || !tenantDoc.data().stripeSubscriptionId) {
      await db.collection('tenants').doc(tenantId).set({
        plan: planId, scheduledDowngrade: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return res.json({ success: true, message: 'Plan updated immediately' });
    }

    if (!stripe) {
      return res.status(503).json({ success: false, error: 'Payment system not configured' });
    }

    const subscriptionId = tenantDoc.data().stripeSubscriptionId;
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
      metadata: { scheduledPlan: planId }
    });

    await db.collection('tenants').doc(tenantId).update({
      scheduledDowngrade: planId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: 'Downgrade scheduled for end of billing period' });
  } catch (error) {
    console.error('Downgrade error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /billing/webhook – Stripe webhook events for subscription lifecycle
 */
async function handleWebhook(req, res) {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(503).json({ error: 'Webhook secret not configured' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { tenantId, planId } = session.metadata;
      await db.collection('tenants').doc(tenantId).update({
        plan: planId, stripeSubscriptionId: session.subscription,
        subscriptionStatus: 'active',
        currentPeriodEnd: new Date(session.expires_at * 1000),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`✅ Subscription activated: ${tenantId} → ${planId}`);
      break;
    }
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const snap = await db.collection('tenants')
        .where('stripeCustomerId', '==', subscription.customer).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({
          subscriptionStatus: subscription.status,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const scheduledPlan = subscription.metadata?.scheduledPlan || 'starter';
      const snap = await db.collection('tenants')
        .where('stripeCustomerId', '==', subscription.customer).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({
          plan: scheduledPlan, subscriptionStatus: 'cancelled',
          stripeSubscriptionId: null, scheduledDowngrade: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`📉 Subscription cancelled: ${snap.docs[0].id} → ${scheduledPlan}`);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const snap = await db.collection('tenants')
        .where('stripeCustomerId', '==', invoice.customer).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({
          subscriptionStatus: 'past_due',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`⚠️ Payment failed: ${snap.docs[0].id}`);
      }
      break;
    }
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}

/**
 * GET /billing/usage – detailed usage metrics for current billing period
 */
async function handleGetUsage(req, res) {
  try {
    const tenantId = req.user.tenantId || 'kaayko';
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    const plan = tenantDoc.exists ? (tenantDoc.data().plan || 'starter') : 'starter';
    const limits = PLAN_LIMITS[plan];

    const linksSnapshot = await db.collection('short_links')
      .where('tenantId', '==', tenantId).get();
    const linksUsed = linksSnapshot.size;
    const totalClicks = linksSnapshot.docs.reduce((sum, doc) => sum + (doc.data().clickCount || 0), 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let apiCallsUsed = 0;
    try {
      const apiCallsSnapshot = await db.collection('api_usage')
        .where('tenantId', '==', tenantId)
        .where('timestamp', '>=', startOfMonth).get();
      apiCallsUsed = apiCallsSnapshot.size;
    } catch (e) { /* api_usage collection may not exist */ }

    res.json({
      success: true,
      usage: {
        links: {
          used: linksUsed, limit: limits.links,
          percentage: limits.links === Infinity ? 0 : Math.round((linksUsed / limits.links) * 100)
        },
        clicks: { total: totalClicks, limit: Infinity, percentage: 0 },
        apiCalls: {
          used: apiCallsUsed, limit: limits.api_calls,
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
}

module.exports = {
  handleGetSubscription,
  handleCreateCheckout,
  handleDowngrade,
  handleWebhook,
  handleGetUsage
};
