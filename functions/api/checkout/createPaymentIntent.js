/**
 * Create Payment Intent for Stripe Checkout
 * Handles product purchases with Stripe integration
 */

const admin = require('firebase-admin');

// Lazy-load Stripe to avoid timeout during function initialization
let stripe = null;
function getStripe() {
  if (!stripe) {
    // Load dotenv only when needed
    require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = require('stripe')(apiKey);
  }
  return stripe;
}

/**
 * Create a Stripe Payment Intent for a product purchase
 * @route POST /api/createPaymentIntent
 * @body {productId, productTitle, size, price}
 * @returns {clientSecret, paymentIntentId}
 */
async function createPaymentIntent(req, res) {
  try {
    const { items, dataRetentionConsent, customerEmail, customerPhone, productId, productTitle, size, gender, price } = req.body;

    let validatedItems = [];
    let totalAmount = 0;

    // NEW FORMAT: items array
    if (items && Array.isArray(items) && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const priceString = String(item.price).replace(/[$,]/g, '').trim();
        const priceInCents = Math.round(parseFloat(priceString) * 100);
        
        if (isNaN(priceInCents) || priceInCents <= 0) {
          return res.status(400).json({
            success: false,
            error: `Item ${i + 1} has invalid price: "${item.price}"`
          });
        }
        
        totalAmount += priceInCents;
        validatedItems.push({
          productId: item.productId,
          productTitle: item.productTitle || 'Unknown Product',
          size: item.size,
          gender: item.gender || 'Unisex',
          price: item.price,
          priceInCents: priceInCents
        });
      }
    }
    // OLD FORMAT: comma-separated strings (BACKWARDS COMPATIBILITY)
    else if (productId && size && price) {
      const productIds = String(productId).split(',').map(s => s.trim());
      const productTitles = String(productTitle || 'Product').split(',').map(s => s.trim());
      const sizes = String(size).split(',').map(s => s.trim());
      const genders = String(gender || 'Unisex').split(',').map(s => s.trim());
      
      // Parse total price
      const priceString = String(price).replace(/[$,]/g, '').trim();
      totalAmount = Math.round(parseFloat(priceString) * 100);
      
      if (isNaN(totalAmount) || totalAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid price: "${price}"`
        });
      }
      
      // Create items from comma-separated data
      validatedItems = productIds.map((id, idx) => ({
        productId: id,
        productTitle: productTitles[idx] || 'Unknown Product',
        size: sizes[idx] || 'Unknown',
        gender: genders[idx] || 'Unisex',
        price: price,
        priceInCents: Math.round(totalAmount / productIds.length) // Split price evenly
      }));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: either items array OR productId, size, price'
      });
    }
    
    console.log(`💰 Creating payment for ${validatedItems.length} items, total: $${(totalAmount/100).toFixed(2)} (${totalAmount} cents)`);

    // Create payment intent with Stripe (lazy-loaded)
    const stripeClient = getStripe();
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: totalAmount,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
      // Don't set receipt_email - it will be collected via Payment Element
      metadata: {
        // Store items as JSON string (Stripe metadata has size limits)
        items: JSON.stringify(validatedItems),
        itemCount: String(validatedItems.length),
        timestamp: new Date().toISOString(),
        notifyEmail: 'rohan@kaayko.com', // Admin notification email
        dataRetentionConsent: String(dataRetentionConsent === true) // User's privacy consent
      }
    });

    // Log the transaction attempt
    const itemsSummary = validatedItems.map(i => `${i.productTitle} (${i.gender} ${i.size})`).join(', ');
    console.log(`💳 Payment intent created: ${paymentIntent.id} for ${itemsSummary}`);

    // Store payment intent in Firestore with PROPER structure
    const db = admin.firestore();
    await db.collection('payment_intents').doc(paymentIntent.id).set({
      // Payment summary
      paymentIntentId: paymentIntent.id,
      totalAmount: totalAmount,
      totalAmountFormatted: `$${(totalAmount / 100).toFixed(2)}`,
      currency: 'usd',
      itemCount: validatedItems.length,
      
      // Order lifecycle tracking
      status: 'created', // created → pending → succeeded → fulfilled → cancelled
      paymentStatus: 'pending', // pending → succeeded → failed → refunded
      fulfillmentStatus: 'awaiting_payment', // awaiting_payment → processing → fulfilled → cancelled
      
      // Timestamps
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      paidAt: null,
      fulfilledAt: null,
      cancelledAt: null,
      
      // Items array - each item is a complete object
      items: validatedItems.map(item => ({
        productId: item.productId,
        productTitle: item.productTitle,
        size: item.size,
        gender: item.gender,
        price: item.price,
        priceInCents: item.priceInCents
      })),
      
      // Customer contact info
      customerEmail: customerEmail || null,
      customerPhone: customerPhone || null,
      
      // Privacy
      dataRetentionConsent: dataRetentionConsent || false,
      
      // Tracking history (audit trail)
      statusHistory: [{
        status: 'created',
        timestamp: new Date().toISOString(),
        note: 'Payment intent created'
      }]
    });
    
    console.log(`✅ Stored payment intent ${paymentIntent.id} with ${validatedItems.length} items in Firestore`);

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('❌ Error creating payment intent:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment intent',
      details: error.message
    });
  }
}

module.exports = createPaymentIntent;
