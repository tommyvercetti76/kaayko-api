/**
 * Kortex Billing — Stripe Webhook Handler
 *
 * Processes subscription lifecycle events (checkout completed, subscription
 * updated/deleted, payment failed) and syncs the tenant's plan in Firestore.
 *
 * IMPORTANT: This handler must be mounted with express.raw() BEFORE the global
 * express.json() middleware in functions/index.js, otherwise the request body is
 * consumed as JSON and stripe.webhooks.constructEvent() fails signature
 * verification on the parsed object. See functions/index.js for the mount.
 */

const admin = require('firebase-admin');

// Lazy-load Stripe so the module can be required even when Stripe is unconfigured.
let stripe = null;
function getStripe() {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * Handle Stripe subscription webhooks for Kortex billing.
 * @route POST /billing/webhook  (external: POST /api/billing/webhook)
 */
async function billingWebhook(req, res) {
  const stripeClient = getStripe();
  if (!stripeClient) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];
  // Firebase-managed secrets arrive with a trailing newline.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!webhookSecret) {
    return res.status(503).json({ error: 'Webhook secret not configured' });
  }

  const db = admin.firestore();
  let event;

  // Same trap as the checkout webhook: Firebase Functions parses the body
  // before Express sees it and exposes the signed bytes on req.rawBody.
  const payload = Buffer.isBuffer(req.rawBody) ? req.rawBody
                : Buffer.isBuffer(req.body)    ? req.body
                : typeof req.body === 'string' ? req.body
                : null;

  if (!payload) {
    console.error('Webhook body is not raw — cannot verify signature');
    return res.status(400).send('Webhook Error: raw body unavailable');
  }

  try {
    event = stripeClient.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { tenantId, planId } = session.metadata;

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
        const tenantsSnapshot = await db.collection('tenants')
          .where('stripeCustomerId', '==', subscription.customer)
          .limit(1)
          .get();

        if (!tenantsSnapshot.empty) {
          await tenantsSnapshot.docs[0].ref.update({
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
        const tenantsSnapshot = await db.collection('tenants')
          .where('stripeCustomerId', '==', subscription.customer)
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
        const tenantsSnapshot = await db.collection('tenants')
          .where('stripeCustomerId', '==', invoice.customer)
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
  } catch (err) {
    // Never leak internals; Stripe will retry on non-2xx.
    console.error('Billing webhook processing error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = billingWebhook;
