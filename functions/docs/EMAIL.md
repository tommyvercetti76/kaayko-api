# Email — one queue, one sender, any provider

## How it works

```
notify()  ──►  Firestore `mail/{deterministic-id}`  ──►  mailSender (SMTP)  ──►  inbox
                      ▲                                        │
                      │                                        ▼
               every product                          mailRedrive (every 15 min)
                                                      mailHealth (admin banner)
```

One queue. One sender. One health view. Adding email to a product is: pick a
`product` tag, pick a `kind`, pass a stable `dedupeKey`. No new transport, no new
queue, no new secret.

```js
const { notify } = require('../../services/notify');

await notify({
  product: 'kreator',                     // store|paddling|alumni|kreator|kortex|contact|system
  kind: 'application-received',
  to: applicant.email,
  subject: 'We have your application',
  template: 'kreatorApplicationReceived', // or pass html/text directly
  data: { name: applicant.name },
  dedupeKey: `kreator_app_${applicationId}`,   // makes retries idempotent
});
// → { queued: true, mailId } | { queued: false, reason }
// It NEVER reports success for a message it did not queue.
```

## Choosing a provider

`mailSender` uses nodemailer, which speaks plain SMTP. **Any provider works.**
Resolution order:

1. `MAIL_SMTP_URL` — a full `smtps://user:pass@host:port` URL. Wins if set.
2. `ZOHO_EMAIL` + `EMAIL_PASSWORD` — the credentials already in Secret Manager.
   Host defaults to `smtp.zoho.com:465`, overridable with `MAIL_SMTP_HOST` and
   `MAIL_SMTP_PORT`.

Switching provider is one command and no code change:

```bash
printf 'smtps://USER:PASS@smtp.provider.com:465' | \
  firebase functions:secrets:set MAIL_SMTP_URL --data-file=-
firebase deploy --only functions:mailSender,functions:mailRedrive
```

The username almost always contains `@`, which **must** be percent-encoded as
`%40` or the URL will not parse. This has bitten this project before.

### Options, honestly

| Provider | Free tier | Why you would pick it |
|---|---|---|
| **Zoho** (already configured) | included with the mailbox | Zero extra work — the credentials exist today |
| **Resend** | 3,000/mo | Best developer experience, clean SMTP and dashboard |
| **Postmark** | 100/mo, then ~$15 | Best transactional deliverability; strict no-marketing policy |
| **AWS SES** | ~$0.10 per 1,000 | Cheapest at volume; most setup, needs a sandbox exit |
| **Brevo** | 300/day | Generous free tier |
| **Gmail / Workspace** | ~500/day | Convenient, but rate-limited and rewrites `From` |

At current volume — order receipts plus a handful of kreator and paddling
notifications — **any** of these is free or near-free. The provider is not the
important decision.

### What actually determines whether mail arrives

Deliverability is about the DOMAIN, not the provider. Whatever you choose:

1. **SPF** — a TXT record on `kaayko.com` authorising that provider to send.
2. **DKIM** — the provider's signing keys, published as DNS records.
3. **DMARC** — a policy record; start at `p=none` and read the reports.

Without these, receipts land in spam regardless of provider. Zoho, Resend,
Postmark and SES all walk you through it. **This is the step worth your time.**

A split worth considering: keep your mailbox provider for person-to-person mail
and use a dedicated transactional provider for automated mail, so a mailbox
problem cannot take down order receipts.

## Operating it

- **Health** — `GET /admin/mailHealth` (platform-admin only) reports counts and
  ids for `ERROR`, stale `RETRY` and stalled `PROCESSING`, surfaced as a banner in
  Kortex → Orders. Counts and ids only; mail bodies never cross the wire.
- **Redrive** — `scheduled/mailRedrive.js`, every 15 minutes. Re-drives anything
  never attempted, mid-retry, or abandoned by a dead invocation. `ERROR`
  documents are left alone: four attempts have failed and a human should look.
- **Retention** — `orderRetention` deletes mail documents after 90 days.
- **Sensitive mail** — guest access codes are flagged `sensitive: true` and their
  bodies stripped by the redrive job once delivery succeeds, so a live credential
  is at rest for seconds rather than 90 days. When no provider is configured they
  are not queued at all.

## History — why this exists

Before 6 September 2026 the platform had THREE mail stacks and had **never sent a
single email**:

- `queueMailOnce → mail → mailSender` — correct, store-only, and **mailSender was
  never deployed**, because deploying it required a `MAIL_SMTP_URL` secret that
  did not exist.
- `services/emailNotificationService.js → SendGrid` — used by alumni, kortex,
  paddling and kreator. `@sendgrid/mail` was never installed and no key was set,
  so it logged to the console and returned `{success: true}`. Every caller
  believed its mail had been delivered.
- `services/emailDelivery.js → SendGrid REST → pending_emails` — a second queue
  that nothing drained.

Meanwhile `ZOHO_EMAIL` and `EMAIL_PASSWORD` sat in Secret Manager, correct and
unused, because the sender wanted a third secret in a different shape.

Four real order emails — two customer receipts, two owner notifications — sat in
`mail` with `state: (none)` and `attempts: 0`.

The lesson is in the second stack: **a mail path that reports success without
sending is worse than one that throws.** One product's broken email is a bug;
four products each trusting their own private stack is a system nobody can
observe. Hence one queue, one sender, one health view — and `notify()` never
returning success for a message it did not queue.
