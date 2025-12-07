# Kaayko Checkout System

Complete email notification system for Stripe payments with customer confirmations and admin alerts.

---

## 🎯 Overview

The checkout system handles:
- ✅ Email collection during Stripe checkout (mandatory)
- ✅ Order confirmation page with email display
- ✅ Webhook processing for payment events
- ✅ Dual email notifications (customer + admin)
- ✅ Order storage in Firestore
- ✅ Payment intent tracking

---

## 📁 File Structure

```
api/functions/api/
├── checkout/
│   ├── router.js                    # Routes: payment intent + webhook
│   ├── createPaymentIntent.js       # Creates Stripe payment intents
│   └── stripeWebhook.js             # Handles payment_intent.* events
├── email/
│   └── templates/
│       ├── orderConfirmation.html   # Customer email template
│       └── newOrderNotification.html # Admin email template
└── index.js                         # Main router with webhook raw body

frontend/src/
├── order-confirmation.html          # Customer-facing confirmation page
└── js/
    └── kaayko_ui.js                 # Stripe checkout integration
```

---

## 🔄 Payment Flow

### 1. Customer Initiates Checkout
```
Store Page → Add to Cart → "Proceed to Checkout" button
  ↓
Modal opens with Stripe Payment Element
  ↓
Customer enters:
  - Card details (required)
  - Email address (required) ← COLLECTED HERE
  - Name (required)
  - Billing address (required)
```

### 2. Payment Intent Creation
```javascript
// POST /api/createPaymentIntent
{
  "productId": "kaayko-hoodie",
  "size": "M"
}

Response:
{
  "clientSecret": "pi_xxx_secret_xxx"
}
```

### 3. Payment Confirmation
```javascript
// Frontend: kaayko_ui.js
const result = await stripe.confirmPayment({
  elements,
  confirmParams: {
    return_url: `${window.location.origin}/order-confirmation.html`
  }
});
// Redirects to: /order-confirmation.html?payment_intent=pi_xxx&payment_intent_client_secret=xxx
```

### 4. Order Confirmation Page
```javascript
// order-confirmation.html
stripe.retrievePaymentIntent(clientSecret)
  ↓
Displays:
  - Order ID: pi_xxx
  - Email: customer@email.com
  - Product: Kaayko Hoodie
  - Size: M
  - Amount: $65.00
  - Status: Succeeded
  - Notice: "📧 A confirmation email has been sent to customer@email.com"
```

### 5. Webhook Processing (Backend)
```
Stripe → POST /api/createPaymentIntent/webhook
  ↓
Verify signature with STRIPE_WEBHOOK_SECRET
  ↓
Event: payment_intent.succeeded
  ↓
stripeWebhook.js → handlePaymentSuccess()
  ├─ Update Firestore: orders/{paymentIntentId}
  ├─ Queue customer email → mail collection
  └─ Queue admin email → mail collection
```

### 6. Email Delivery
```
Firestore mail collection
  ├─ Document 1: Customer email
  │   ├─ to: customer@email.com
  │   ├─ subject: "🛶 Order Confirmation - Kaayko"
  │   └─ html: [orderConfirmation.html rendered]
  │
  └─ Document 2: Admin email
      ├─ to: rohan@kaayko.com
      ├─ subject: "🔔 New Order - Kaayko Store"
      └─ html: [newOrderNotification.html rendered]

  ↓
Firebase Email Extension or SendGrid
  ↓
Emails delivered 📧
```

---

## ⚙️ Configuration

### Environment Variables

**File**: `api/functions/.env.local`

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_51Sb3SRGhBi2rBXlYcIMi4jURfuOSLbK6gFjftZyl39maAeRfP3h9YuCnWP6qjRgwt1fkCtqh0ZW91kxFa1tCOLeL00Fg2w06f7
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE

# Email Configuration (if using SendGrid directly)
SENDGRID_API_KEY=SG.xxx
```

### Webhook Setup

#### Local Testing (Stripe CLI)
```bash
# Terminal 1: Start Firebase emulator
cd api/functions
npm run serve

# Terminal 2: Forward webhooks
stripe listen --forward-to http://localhost:5001/kaaykostore/us-central1/api/createPaymentIntent/webhook

# Copy webhook secret from output (whsec_...)
# Add to .env.local
```

#### Production (Stripe Dashboard)
1. Go to: https://dashboard.stripe.com/test/webhooks
2. Click "+ Add endpoint"
3. URL: `https://us-central1-kaaykostore.cloudfunctions.net/api/createPaymentIntent/webhook`
4. Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
5. Copy signing secret → Add to `.env.local` and production config

---

## 📧 Email Templates

### Customer Email (`orderConfirmation.html`)

**Subject**: 🛶 Order Confirmation - Kaayko

**Variables**:
- `{{orderId}}` - Payment Intent ID
- `{{productName}}` - Product title
- `{{size}}` - Product size
- `{{amount}}` - Total amount (formatted)

**Example**:
```
🛶 Kaayko
Order Confirmed!

Thank you for your order! We're excited to get your gear ready.

Order Details
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order ID      pi_3abc123def456
Product       Kaayko Hoodie - Black
Size          M
Amount        $65.00

📦 What's Next?
Your order is being processed and will ship shortly...
```

### Admin Email (`newOrderNotification.html`)

**Subject**: 🔔 New Order - Kaayko Store

**Variables**:
- `{{orderId}}` - Payment Intent ID
- `{{customerEmail}}` - Customer's email
- `{{productName}}` - Product title
- `{{size}}` - Product size
- `{{amount}}` - Total amount
- `{{status}}` - Payment status
- `{{paymentIntentId}}` - Payment Intent ID (for links)
- `{{timestamp}}` - Order timestamp

**Example**:
```
🔔 New Order Received

⚡ Action Required
A new order has been placed and payment has been confirmed.

Order Information
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Customer Email   test@example.com
Product          Kaayko Hoodie - Black
Size             M
Amount           $65.00
Payment Status   SUCCEEDED

[View in Stripe Dashboard →]
```

---

## 🧪 Testing

### Test Script

Run comprehensive test:
```bash
cd local-dev/scripts
./test-stripe-emails.sh
```

### Manual Testing

1. **Start local environment**:
```bash
cd api/functions
npm run serve
```

2. **Forward webhooks** (separate terminal):
```bash
stripe listen --forward-to http://localhost:5001/kaaykostore/us-central1/api/createPaymentIntent/webhook
```

3. **Open store**:
```
http://localhost:5001/kaaykostore/us-central1/api/store.html
```

4. **Complete checkout**:
   - Card: `4242 4242 4242 4242`
   - Expiry: Any future date
   - CVC: Any 3 digits
   - Email: `test@example.com`
   - Name: `Test User`
   - Address: Any valid address

5. **Verify**:
   - ✅ Redirects to order confirmation
   - ✅ Shows email: "test@example.com"
   - ✅ Webhook fires (check Stripe CLI output)
   - ✅ Firestore `orders` collection updated
   - ✅ Firestore `mail` collection has 2 documents

### Test Cards

| Card Number | Result | Use Case |
|------------|--------|----------|
| `4242 4242 4242 4242` | Success | Standard success |
| `4000 0000 0000 0002` | Decline | Test decline handling |
| `4000 0027 6000 3184` | 3D Secure | Test 3DS flow |
| `4000 0000 0000 9995` | Insufficient funds | Test error |

---

## 🗄️ Database Schema

### Firestore Collections

#### `orders` Collection
```javascript
orders/{paymentIntentId}
{
  orderId: "pi_3abc123def456",
  status: "succeeded",
  amount: 6500,  // cents
  currency: "usd",
  customerEmail: "customer@email.com",
  productId: "kaayko-hoodie",
  productTitle: "Kaayko Hoodie - Black",
  size: "M",
  createdAt: Timestamp,
  updatedAt: Timestamp,
  metadata: {
    notifyEmail: "rohan@kaayko.com"
  }
}
```

#### `mail` Collection
```javascript
mail/{autoId}
{
  to: "customer@email.com",
  message: {
    subject: "🛶 Order Confirmation - Kaayko",
    html: "<html>...</html>"
  },
  createdAt: Timestamp,
  delivery: {
    state: "PENDING",  // Changes to SUCCESS/ERROR
    attempts: 0,
    startTime: Timestamp,
    endTime: Timestamp,
    error: null
  }
}
```

#### `payment_intents` Collection
```javascript
payment_intents/{paymentIntentId}
{
  id: "pi_3abc123def456",
  amount: 6500,
  currency: "usd",
  status: "requires_payment_method",
  productId: "kaayko-hoodie",
  productTitle: "Kaayko Hoodie - Black",
  size: "M",
  createdAt: Timestamp,
  receipt_email: null,  // Set after payment
  metadata: {
    notifyEmail: "rohan@kaayko.com"
  }
}
```

---

## 🚀 Deployment

### Deploy All Components
```bash
cd api/deployment
./deploy-full-stack.sh
```

### Deploy Functions Only
```bash
cd api/deployment
./deploy-firebase-functions.sh
```

### Deploy Frontend Only
```bash
cd api/deployment
./deploy-frontend.sh
```

---

## 🔍 Debugging

### Common Issues

#### Webhook Not Firing
- **Check webhook secret**: Must match Stripe Dashboard
- **Verify URL**: Check Stripe Dashboard has correct endpoint
- **Check events**: `payment_intent.succeeded` selected
- **View logs**: `firebase functions:log --only api`

#### Emails Not Sending
- **Check mail collection**: Should have documents
- **Verify email service**: Extension installed or SendGrid configured
- **Check delivery status**: `mail/{id}/delivery/state`
- **Test email service**: Send test email manually

#### Email Not Displayed
- **Check browser console**: JavaScript errors?
- **Verify payment intent**: Has `receipt_email` field?
- **Check URL params**: Has `payment_intent` and `payment_intent_client_secret`?
- **Test retrieval**: `stripe.retrievePaymentIntent()` returns data?

### Logs

**View Firebase Functions logs**:
```bash
firebase functions:log --only api
```

**View Stripe events**:
```bash
stripe events list --limit 10
```

**View webhook attempts**:
https://dashboard.stripe.com/test/webhooks/{webhook_id}

---

## 📊 Analytics

### Track Conversions

Monitor in Firebase Console:
- **Orders collection**: Total orders
- **Payment intents**: Success rate
- **Mail collection**: Email delivery rate

### Key Metrics

```javascript
// Total orders today
db.collection('orders')
  .where('createdAt', '>=', startOfDay)
  .get()

// Email delivery success rate
db.collection('mail')
  .where('delivery.state', '==', 'SUCCESS')
  .get()

// Average order value
orders.reduce((sum, order) => sum + order.amount, 0) / orders.length
```

---

## 🔐 Security

### Best Practices

1. **Webhook signature verification**: Always verify `stripe-signature` header
2. **Environment secrets**: Never commit `.env.local` to git
3. **Email validation**: Validate customer email format
4. **Rate limiting**: Consider implementing rate limits on checkout
5. **Order validation**: Verify payment amount matches product price

### Security Checklist

- [ ] Webhook secret configured and not exposed
- [ ] HTTPS only (enforced by Firebase Functions)
- [ ] Stripe keys are test/live appropriate
- [ ] Email templates sanitized (no user input)
- [ ] CORS configured correctly
- [ ] Firestore rules secure orders/mail collections

---

## 📚 Resources

### Documentation
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- [Firebase Email Extension](https://firebase.google.com/products/extensions/firestore-send-email)
- [Stripe Payment Element](https://stripe.com/docs/payments/payment-element)

### Internal Docs
- `STRIPE_EMAIL_SETUP_GUIDE.md` - Complete setup guide
- `API-QUICK-REFERENCE-v2.1.0.md` - API documentation
- `NAVIGATION.md` - Project navigation

### Quick Links
- [Stripe Dashboard](https://dashboard.stripe.com/test)
- [Firebase Console](https://console.firebase.google.com/project/kaaykostore)
- [Local Testing Script](../../local-dev/scripts/test-stripe-emails.sh)

---

## ✅ Success Criteria

System is fully operational when:

1. ✅ Customer can complete checkout with email
2. ✅ Order confirmation shows customer email
3. ✅ Customer receives confirmation email
4. ✅ Admin receives new order notification
5. ✅ Order stored in Firestore
6. ✅ Webhook events logged
7. ✅ All emails delivered successfully

---

**Last Updated**: December 2024  
**Maintainer**: Rohan (rohan@kaayko.com)
