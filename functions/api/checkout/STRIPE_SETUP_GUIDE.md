# Stripe Integration Setup Guide

## 🎯 Quick Setup (3 Steps)

### 1. Get Your Stripe API Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys)
2. Copy your **Publishable Key** (starts with `pk_test_...`)
3. Copy your **Secret Key** (starts with `sk_test_...`)

### 2. Configure Frontend (Publishable Key)

**File**: `frontend/src/js/kaayko_ui.js`

```javascript
// Line ~342 - Replace with your actual publishable key
const STRIPE_PUBLISHABLE_KEY = 'pk_test_YOUR_ACTUAL_KEY_HERE';
```

### 3. Configure Backend (Secret Key)

**Option A: Firebase Functions Config (Recommended for Production)**

```bash
cd api/functions
firebase functions:config:set stripe.secret_key="sk_test_YOUR_SECRET_KEY_HERE"
firebase deploy --only functions
```

**Option B: Environment Variable (Local Development)**

Create `.env.local` in `api/functions/`:

```bash
STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
```

Then update `api/functions/api/checkout/createPaymentIntent.js`:

```javascript
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
```

---

## 🚀 Deploy & Test

### Install Stripe Package

```bash
cd api/functions
npm install stripe
```

### Deploy to Firebase

```bash
cd api/deployment
./deploy-firebase-functions.sh
```

### Test Payment Flow

1. Open http://localhost:8080/store.html (local) or https://kaaykostore.web.app (prod)
2. Click "Buy" on any product
3. Select a size
4. Use [Stripe test cards](https://docs.stripe.com/testing):
   - **Success**: `4242 4242 4242 4242`
   - **3D Secure**: `4000 0027 6000 3184`
   - **Declined**: `4000 0000 0000 0002`
5. Complete payment and verify in [Stripe Dashboard](https://dashboard.stripe.com/test/payments)

---

## 📋 What's Included

### Frontend (`kaayko_ui.js`)
- ✅ `initializeStripePayment()` - Creates payment intent and mounts Stripe elements
- ✅ `handleStripeSubmit()` - Processes payment with Stripe
- ✅ Loading spinner and error handling
- ✅ Automatic address collection via Stripe Payment Element

### Backend (`api/functions/api/checkout/`)
- ✅ `createPaymentIntent.js` - Creates Stripe payment intent
- ✅ `router.js` - Express router for checkout endpoints
- ✅ Firestore logging (`payment_intents` collection)
- ✅ Metadata tracking (product, size, price)

### API Endpoint
- **URL**: `POST https://us-central1-kaaykostore.cloudfunctions.net/api/createPaymentIntent`
- **Body**: `{ productId, productTitle, size, price }`
- **Response**: `{ clientSecret, paymentIntentId }`

---

## 🔐 Security Best Practices

1. **Never commit API keys** - Use environment variables or Firebase config
2. **Use test keys** in development (`pk_test_...` and `sk_test_...`)
3. **Switch to live keys** only after testing (`pk_live_...` and `sk_live_...`)
4. **Enable webhook** for payment confirmation (future enhancement)
5. **Validate amounts** on backend (never trust client-side price)

---

## 🐛 Troubleshooting

### "Invalid API Key"
- Verify secret key starts with `sk_test_` or `sk_live_`
- Check Firebase Functions config: `firebase functions:config:get`

### "Payment Element not mounting"
- Check browser console for errors
- Verify publishable key is correct
- Ensure `<div id="payment-element">` exists in modal

### "Backend not responding"
- Run `npm install` in `api/functions/`
- Check Firebase Functions logs: `firebase functions:log`
- Test locally: `npm run serve` and use localhost URL

### "CORS errors"
- Ensure API endpoint has `cors: true` in `index.js`
- Check if frontend URL matches origin

---

## 🎨 Customization

### Change Payment Button Text
**File**: `frontend/src/js/kaayko_ui.js`

```javascript
submitButton.querySelector('.button-text').textContent = 'Pay Now'; // Line ~396
```

### Modify Stripe Payment Element Layout
**File**: `frontend/src/js/kaayko_ui.js`

```javascript
const paymentElementInstance = elements.create('payment', {
  layout: 'accordion', // Options: 'tabs', 'accordion', 'auto'
  fields: {
    billingDetails: {
      address: 'never' // Options: 'auto', 'never'
    }
  }
});
```

### Add Shipping Rate Calculation
**File**: `api/functions/api/checkout/createPaymentIntent.js`

```javascript
const shippingRate = 500; // $5.00 shipping
const paymentIntent = await stripe.paymentIntents.create({
  amount: amount + shippingRate,
  currency: 'usd',
  // ... rest of config
});
```

---

## 📊 Order Tracking

Payment intents are logged to Firestore collection `payment_intents`:

```javascript
{
  productId: "product123",
  productTitle: "Product Name",
  size: "M",
  price: "$49.99",
  amount: 4999,
  status: "created",
  createdAt: Timestamp
}
```

Update status via webhook (future enhancement):
- `created` → `processing` → `succeeded` or `failed`

---

## 🔄 Next Steps

1. **Webhook Integration**: Listen for `payment_intent.succeeded` to fulfill orders
2. **Order Confirmation Page**: Create `/order-confirmation.html` for success redirect
3. **Email Notifications**: Send order confirmations via SendGrid/Firebase Extensions
4. **Inventory Management**: Decrement product stock on successful payment
5. **Admin Dashboard**: View orders and payment history

---

## 📚 Resources

- [Stripe Payment Element Docs](https://docs.stripe.com/payments/payment-element)
- [Firebase Functions Config](https://firebase.google.com/docs/functions/config-env)
- [Stripe Test Cards](https://docs.stripe.com/testing)
- [Stripe Dashboard](https://dashboard.stripe.com)
