# Stripe Email Notification Setup Guide

> ## ✅ Email delivery is in-repo — ONE secret to set before launch
>
> Every email the store sends (order confirmation, owner alerts, shipping
> confirmation, delay notice, refund and chargeback alerts) is a document in
> the Firestore `mail` collection, delivered over SMTP by the `mailSender`
> Cloud Function (`functions/triggers/mailSender.js`, nodemailer). The
> `firestore-send-email` extension is NOT installed and must NOT be:
> **if the extension is ever installed alongside this trigger, every email is
> sent twice. It is one or the other — never both.**
>
> ### The one command
>
> Copy the SMTP URL (format below) to the clipboard, then:
>
> ```bash
> cd /Users/Rohan/Kaayko_v6/kaayko-api && pbpaste > /tmp/k.txt && firebase functions:secrets:set MAIL_SMTP_URL --data-file=/tmp/k.txt; rm -f /tmp/k.txt
> ```
>
> ### Gmail URL format
>
> ```
> smtps://your.name%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465
> ```
>
> * The `@` in the username **must be written `%40`** — a bare `@` breaks the URL.
>   nodemailer decodes it back to `your.name@gmail.com` (covered by a test).
> * `abcdefghijklmnop` is a Google **App Password** (Google Account → Security →
>   2-Step Verification → App passwords). Google displays it with spaces — remove them.
> * `smtps://` on port 465 (implicit TLS). Consumer Gmail caps sending at
>   roughly 500 recipients/day, which is plenty for order mail.
> * Gmail rewrites the From header to the authenticated account unless the
>   address is a verified "Send mail as" alias, so leave `MAIL_FROM` unset when
>   sending through Gmail. Reply-To is the owner address (`ORDER_NOTIFY_EMAIL`,
>   default `rohanramekar17@gmail.com`), so customer replies land where they are read.
>
> ### Then deploy and verify
>
> ```bash
> firebase deploy --only functions:mailSender,functions:api
> firebase functions:secrets:access MAIL_SMTP_URL | sed 's/:[^:@]*@/:***@/'   # set? (password masked)
> firebase functions:log --only mailSender
> ```
>
> Make a test purchase (or create a `mail` document in the shape shown under
> "Firestore Mail Collection Structure" below) and read it back:
> `delivery.state` becomes `SUCCESS`, or `ERROR` with `delivery.error` saying
> exactly why — a missing secret says so in plain words, it never fails silently.
>
> ### Delivery states — `mail/{id}.delivery` (same field names as the extension)
>
> | state | meaning |
> |---|---|
> | `PROCESSING` | claimed by a running invocation, in a transaction — a duplicate trigger delivery skips it, so nothing double-sends |
> | `SUCCESS` | accepted by SMTP; `info.messageId`, `info.accepted`, `endTime` |
> | `RETRY` | transient failure (connection, timeout, SMTP 4xx); `attempts` and `error` recorded. Nothing re-drives these automatically yet |
> | `ERROR` | permanent failure (SMTP 5xx, bad credentials, no recipient, secret missing) or the 4th failed attempt; see `error` |
>
> To re-send a `RETRY`/`ERROR` document by hand: copy it under a new document
> id (creation fires the trigger), or run `deliverMailDocument(id, { force: true })`
> from `functions/triggers/mailSender.js` in a Node script with admin credentials.
>
> ### Secret and env summary
>
> | name | where | purpose |
> |---|---|---|
> | `MAIL_SMTP_URL` | Secret Manager (`firebase functions:secrets:set`) | the only required value — full `smtps://` URL |
> | `MAIL_FROM` | `functions/.env`, optional | From header; default is the owner address |
> | `ORDER_NOTIFY_EMAIL` | `functions/.env`, optional | owner alert address and default From / Reply-To |
>
> The rest of this document is the original checkout + webhook guide. Where it
> mentions the extension or SendGrid, the banner above supersedes it.

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
   - `charge.refunded` — full and partial refunds (marks the order refunded / partially_refunded)
   - `charge.dispute.created` — chargebacks (marks the order disputed, records the evidence deadline)
   - `charge.dispute.closed` — dispute outcome (won / lost / warning_closed / charge_refunded)
5. Click "Add endpoint"
6. Copy the "Signing secret" (starts with `whsec_`)
7. Add to `.env.local` and production config

---

### Step 2: Set Up Email Service

Done in-repo — see the banner at the top of this document. Set the
`MAIL_SMTP_URL` secret, deploy `functions:mailSender`, and do NOT install the
`firestore-send-email` extension (it would double-send).

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
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`

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
- [ ] `MAIL_SMTP_URL` secret set (`firebase functions:secrets:access MAIL_SMTP_URL`) and `mailSender` deployed
- [ ] `mail` collection has documents — read `delivery.state` and `delivery.error` on them
- [ ] `firebase functions:log --only mailSender`
- [ ] Gmail: App Password (not the account password), `%40` for the `@` in the username, spaces removed
- [ ] The `firestore-send-email` extension is NOT installed (`firebase ext:list`) — with both, mail double-sends
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
mailSender Firestore trigger (functions/triggers/mailSender.js, SMTP via MAIL_SMTP_URL)
  ├─ Send email to customer
  └─ Send email to the owner (ORDER_NOTIFY_EMAIL)
  └─ delivery.state written back: SUCCESS | RETRY | ERROR
```

---

## 🚀 Quick Start Commands

```bash
# 1. Update webhook secret
cd api/functions
nano .env.local
# Add: STRIPE_WEBHOOK_SECRET=whsec_...

# 2. Set the SMTP secret (required — see the banner at the top)
pbpaste > /tmp/k.txt && firebase functions:secrets:set MAIL_SMTP_URL --data-file=/tmp/k.txt; rm -f /tmp/k.txt

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
  delivery: {            // written by mailSender; absent until the trigger runs
    state: 'PROCESSING', // → SUCCESS | RETRY | ERROR
    attempts: 1,
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
