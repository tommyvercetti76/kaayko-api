# Stripe Email Notification Setup Guide

## Overview
Complete guide for setting up email notifications for Stripe checkout, including customer order confirmations and admin notifications to rohan@kaayko.com.

---

## 🎯 What's Been Implemented

### Payment Flow with Email Collection
```
Store → Add to Cart → Checkout Modal
  ↓
Stripe Payment Element (collects email, name, address)
  ↓
Payment Succeeds → Redirect to /order-confirmation.html
  ↓
Customer sees: Order ID, Email, Product, Amount
  ↓
Webhook fires → payment_intent.succeeded
  ↓
Backend: Store order + Queue 2 emails
  ├─ Customer: Order confirmation
  └─ Admin (rohan@kaayko.com): New order notification
```

### Files Modified/Created

1. **`api/functions/index.js`**
   - Added raw body parsing for webhook route
   - Webhook endpoint: `/api/createPaymentIntent/webhook`

2. **`api/functions/api/checkout/stripeWebhook.js`** (NEW)
   - Handles `payment_intent.succeeded` and `payment_intent.payment_failed`
   - Queues emails to Firestore `mail` collection
   - Updates `orders` collection with complete order data

3. **`api/functions/api/checkout/createPaymentIntent.js`**
   - Added `receipt_email: null` (collected via Payment Element)
   - Added `notifyEmail: 'rohan@kaayko.com'` to metadata

4. **`frontend/src/js/kaayko_ui.js`**
   - Payment Element collects: `name`, `email`, `address` (all mandatory)

5. **`frontend/src/order-confirmation.html`** (NEW)
   - Displays order details including customer email
   - Shows: "📧 A confirmation email has been sent to [email]"

---

## 📋 Setup Steps

### Step 1: Configure Stripe Webhook Secret

#### Option A: Using Stripe CLI (for local testing)
```bash
# Install Stripe CLI (if not already installed)
brew install stripe/stripe-cli/stripe

# Login to your Stripe account
stripe login

# Forward webhooks to local emulator
stripe listen --forward-to http://localhost:5001/kaaykostore/us-central1/api/createPaymentIntent/webhook

# Copy the webhook secret (starts with whsec_)
# Example output: > Ready! Your webhook signing secret is whsec_abc123...
```

Then update `.env.local`:
```bash
cd api/functions
nano .env.local

# Add the secret:
STRIPE_WEBHOOK_SECRET=whsec_abc123...
```

#### Option B: Using Stripe Dashboard (for production)
1. Go to: https://dashboard.stripe.com/test/webhooks
2. Click "+ Add endpoint"
3. Enter endpoint URL:
   ```
   https://us-central1-kaaykostore.cloudfunctions.net/api/createPaymentIntent/webhook
   ```
4. Select events to listen to:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Click "Add endpoint"
6. Copy the "Signing secret" (starts with `whsec_`)
7. Add to `.env.local` and production config

---

### Step 2: Set Up Email Service

You have **3 options** for sending emails:

#### Option A: Firebase Extension (Recommended - Easiest)

1. Install Trigger Email extension:
```bash
firebase ext:install firestore-send-email --project=kaaykostore
```

2. Configuration during install:
   - **SMTP Connection URI**: Use SendGrid, Gmail, or other SMTP
   - **Email documents collection**: `mail`
   - **Default FROM address**: `orders@kaayko.com`

3. SendGrid SMTP URI format:
```
smtps://apikey:YOUR_SENDGRID_API_KEY@smtp.sendgrid.net:465
```

#### Option B: SendGrid API (Custom Implementation)

Already have `SENDGRID_API_KEY` in `.env.local`, just need to implement sender:

```javascript
// api/functions/api/email/sendEmail.js
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail(to, subject, html) {
  const msg = {
    to,
    from: 'orders@kaayko.com',
    subject,
    html,
  };
  await sgMail.send(msg);
}

module.exports = { sendEmail };
```

Then update `stripeWebhook.js` to call this instead of writing to Firestore.

#### Option C: Gmail SMTP (Quick Testing)

1. Enable 2FA on your Gmail account
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Update `.env.local`:
```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

---

### Step 3: Create Email Templates

Create two HTML email templates:

#### Template 1: Customer Order Confirmation
**File**: `api/functions/api/email/templates/orderConfirmation.html`

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; }
    .header { text-align: center; color: #ffd700; font-size: 28px; margin-bottom: 20px; }
    .details { background: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; color: #666; margin-top: 30px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">🛶 Order Confirmed!</div>
    <p>Thank you for your order from Kaayko!</p>
    
    <div class="details">
      <p><strong>Order ID:</strong> {{orderId}}</p>
      <p><strong>Product:</strong> {{productName}}</p>
      <p><strong>Size:</strong> {{size}}</p>
      <p><strong>Amount:</strong> ${{amount}}</p>
    </div>
    
    <p>Your order will be processed shortly. You'll receive a shipping confirmation once it's on the way.</p>
    
    <div class="footer">
      <p>Kaayko - Made for the Wild</p>
      <p><a href="https://kaayko.com">kaayko.com</a></p>
    </div>
  </div>
</body>
</html>
```

#### Template 2: Admin New Order Notification
**File**: `api/functions/api/email/templates/newOrderNotification.html`

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; }
    .header { text-align: center; color: #ffd700; font-size: 24px; margin-bottom: 20px; }
    .alert { background: #fff3cd; padding: 15px; border-left: 4px solid #ffd700; margin: 20px 0; }
    .details { background: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">🔔 New Order Received</div>
    
    <div class="alert">
      <strong>Action Required:</strong> Process new order
    </div>
    
    <div class="details">
      <p><strong>Order ID:</strong> {{orderId}}</p>
      <p><strong>Customer Email:</strong> {{customerEmail}}</p>
      <p><strong>Product:</strong> {{productName}}</p>
      <p><strong>Size:</strong> {{size}}</p>
      <p><strong>Amount:</strong> ${{amount}}</p>
      <p><strong>Payment Status:</strong> {{status}}</p>
    </div>
    
    <p><a href="https://dashboard.stripe.com/test/payments/{{paymentIntentId}}">View in Stripe Dashboard →</a></p>
  </div>
</body>
</html>
```

---

### Step 4: Test the Complete Flow

#### Local Testing with Emulator

1. **Start Firebase emulator**:
```bash
cd api/functions
npm run serve
```

2. **Start Stripe CLI webhook forwarding** (separate terminal):
```bash
stripe listen --forward-to http://localhost:5001/kaaykostore/us-central1/api/createPaymentIntent/webhook
```

3. **Open store in browser**:
```
http://localhost:5001/kaaykostore/us-central1/api/store.html
```

4. **Test checkout flow**:
   - Add product to cart
   - Click "Proceed to Checkout"
   - Enter test card: `4242 4242 4242 4242`
   - Enter email (mandatory): `test@example.com`
   - Enter name and address
   - Click "Pay"
   - Should redirect to order confirmation showing email

5. **Verify webhook received**:
Check Stripe CLI output for:
```
→ POST /createPaymentIntent/webhook [200]
  payment_intent.succeeded
```

6. **Check Firestore emulator**:
   - Orders collection: Should have new order document
   - Mail collection: Should have 2 documents (customer + admin emails)

#### Production Testing

1. **Deploy all changes**:
```bash
cd api/deployment
./deploy-full-stack.sh
```

2. **Configure webhook in Stripe Dashboard**:
   - URL: `https://us-central1-kaaykostore.cloudfunctions.net/api/createPaymentIntent/webhook`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`

3. **Test with real Stripe test mode**:
   - Visit: https://kaayko.com/store.html
   - Complete checkout with test card
   - Check emails arrive at customer address and rohan@kaayko.com

---

## 🔍 Debugging Checklist

### Webhook Not Firing
- [ ] Webhook URL correct in Stripe Dashboard
- [ ] Webhook secret matches in `.env.local`
- [ ] `payment_intent.succeeded` event selected in Stripe
- [ ] Check Firebase Functions logs: `firebase functions:log`

### Emails Not Sending
- [ ] Email service configured (Extension or SendGrid)
- [ ] `mail` collection has documents
- [ ] Check email service logs
- [ ] Verify sender email is verified/authorized
- [ ] Check spam folder

### Order Not Stored
- [ ] Check Firestore `orders` collection
- [ ] Check Firebase Functions logs for errors
- [ ] Verify webhook handler is executing

### Email Not Displayed on Confirmation
- [ ] Check browser console for errors
- [ ] Verify payment intent has `receipt_email` in charges
- [ ] Check URL has `payment_intent` and `payment_intent_client_secret` params

---

## 📊 Data Flow Diagram

```
USER CHECKOUT
     ↓
Stripe Payment Element
  (collects email)
     ↓
Payment Intent Created
  metadata: { notifyEmail: 'rohan@kaayko.com' }
     ↓
Payment Succeeds
     ↓
Redirect → order-confirmation.html
  (shows: "Email sent to customer@email.com")
     ↓
Stripe Webhook → /api/createPaymentIntent/webhook
     ↓
stripeWebhook.js
  ├─ Update Firestore orders/{paymentIntentId}
  └─ Queue 2 emails to Firestore mail collection
       ├─ to: customer@email.com (order confirmation)
       └─ to: rohan@kaayko.com (new order alert)
     ↓
Firebase Email Extension/Service
  ├─ Send email to customer
  └─ Send email to rohan@kaayko.com
```

---

## 🚀 Quick Start Commands

```bash
# 1. Update webhook secret
cd api/functions
nano .env.local
# Add: STRIPE_WEBHOOK_SECRET=whsec_...

# 2. Install email extension (optional)
firebase ext:install firestore-send-email --project=kaaykostore

# 3. Deploy
cd ../deployment
./deploy-firebase-functions.sh

# 4. Test locally
cd ../functions
npm run serve
# In another terminal:
stripe listen --forward-to http://localhost:5001/kaaykostore/us-central1/api/createPaymentIntent/webhook

# 5. Check logs
firebase functions:log --only api
```

---

## 📧 Email Configuration Reference

### Firestore Mail Collection Structure

Each email document in `mail` collection:
```javascript
{
  to: 'customer@email.com',
  message: {
    subject: 'Order Confirmation - Kaayko',
    html: '<html>...</html>'
  },
  delivery: {
    state: 'PENDING', // Changes to SUCCESS/ERROR
    attempts: 0,
    startTime: timestamp,
    endTime: timestamp,
    error: null
  }
}
```

### SendGrid Configuration

If using SendGrid directly:
1. Add sender domain: https://app.sendgrid.com/settings/sender_auth
2. Verify domain with DNS records
3. Use API key in `.env.local`

---

## ✅ Success Criteria

Your setup is complete when:

1. [ ] Checkout collects customer email (mandatory field)
2. [ ] Payment succeeds and redirects to confirmation page
3. [ ] Confirmation page shows: "📧 A confirmation email has been sent to [email]"
4. [ ] Customer receives order confirmation email
5. [ ] rohan@kaayko.com receives new order notification email
6. [ ] Order appears in Firestore `orders` collection
7. [ ] Webhook events logged in Firebase Functions logs

---

## 🆘 Support

If issues persist:
1. Check Firebase Functions logs: `firebase functions:log`
2. Test webhook in Stripe Dashboard with "Send test webhook"
3. Verify email service is active
4. Check Firestore rules allow mail collection writes

**Test Card Numbers**:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- 3D Secure: `4000 0027 6000 3184`
