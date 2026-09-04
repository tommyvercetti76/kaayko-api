// functions/src/index.js - Firebase Functions v2
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

// Initialize Firebase Admin
admin.initializeApp();

// Create Express app for JSON API
const apiApp = express();
apiApp.use(cors());

// Strip /api/ prefix when requests come through Firebase Hosting rewrite
// (Firebase Hosting forwards the full path, e.g. /api/kutz/parseFoods)
apiApp.use((req, _res, next) => {
  if (req.url.startsWith('/api/')) req.url = req.url.slice(4);
  next();
});

// Privileged surfaces are same-origin only. Public routes keep the permissive
// CORS above (they serve the catalog and forecasts to any caller), but admin
// and account routes have no legitimate cross-origin consumer, so a browser on
// another site must not be able to read their responses. Auth is Bearer-token
// based, so this is defence in depth rather than the primary control.
const ADMIN_ORIGIN_ALLOWLIST = new Set([
  "https://kaayko.com",
  "https://www.kaayko.com",
  "https://kaaykostore.web.app",
  "https://kaaykostore.firebaseapp.com",
]);
// /createPaymentIntent is included because it creates real Stripe charges from
// an unauthenticated request; only the Kaayko storefront has any business
// calling it from a browser. Stripe's webhook (/createPaymentIntent/webhook)
// sends no Origin header, so it passes through untouched.
const PRIVILEGED_PREFIXES = ["/admin", "/kreators/admin", "/billing", "/campaigns", "/createPaymentIntent"];

apiApp.use((req, res, next) => {
  const path = req.url.split("?")[0];
  if (!PRIVILEGED_PREFIXES.some(p => path === p || path.startsWith(p + "/"))) return next();

  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  if (origin && ADMIN_ORIGIN_ALLOWLIST.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  } else {
    // Unknown origin: strip the permissive header set by cors() above so the
    // browser refuses to hand the response to the calling page.
    res.removeHeader("Access-Control-Allow-Origin");
    if (origin && req.method === "OPTIONS") return res.status(403).end();
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ⚠️ CRITICAL: Stripe webhook needs raw body for signature verification
// Must be defined BEFORE express.json() middleware
apiApp.use("/createPaymentIntent/webhook", express.raw({ type: 'application/json' }), require("./api/checkout/stripeWebhook"));

// ⚠️ CRITICAL: Kortex billing (subscription) webhook also needs the raw body.
// Must be mounted BEFORE express.json() for the same signature-verification reason.
apiApp.use("/billing/webhook", express.raw({ type: 'application/json' }), require("./api/billing/stripeWebhook"));

// Now apply JSON parsing for all other routes
apiApp.use(express.json());

// Load essential API routes
apiApp.use("/images", require("./api/products/images"));
apiApp.get("/helloWorld", (_r, res) => res.send("OK"));
apiApp.use("/products", require("./api/products/products"));
apiApp.use("/animals", require("./api/products/animals"));
apiApp.use("/paddlingOut", require("./api/weather/paddlingout"));
apiApp.use("/paddle-trainer", require("./api/weather/paddleTrainer"));

// 📚 API DOCUMENTATION
apiApp.use("/docs", require("./api/core/docs"));

// 🌍 LOCATION SERVICES
apiApp.use("/nearbyWater", require("./api/weather/nearbyWater")); // Find nearby lakes/rivers for custom locations

// 📦 VERSIONED PADDLING API (metered): X-API-Key + scope read:paddling.
// Read-only, stable contract for third parties / a future paid tier. The
// unversioned routes below stay anonymous for kaayko.com itself.
apiApp.use("/v1", require("./api/weather/v1PaddlingApi"));

// 🌟 STREAMLINED WEATHER APIs - Enabled
apiApp.use("/paddleScore", require("./api/weather/paddleScore"));     // ML-POWERED: Paddle condition rating with ML model
apiApp.use("/fastForecast", require("./api/weather/fastForecast"));   // PUBLIC: Fast cached forecasts for frontend
apiApp.use("/forecast", require("./api/weather/forecast").router);    // PREMIUM: On-demand forecasts (requires $$ token)

// 🔗 KORTEX LINKS API
// Canonical namespace: /kortex
// Compatibility namespace: /smartlinks (kept to avoid breaking older clients)
const kortexRouter = require("./api/kortex/smartLinks");
apiApp.use("/kortex", kortexRouter);
apiApp.use("/smartlinks", kortexRouter);
apiApp.use("/campaigns", require("./api/campaigns/campaignRoutes"));  // KORTEX campaign management
// Mounted at "/public" because the prefix-strip middleware above rewrites the
// external path /api/public/* -> /public/* before routing. External callers still
// use /api/public/*; mounting at /api/public would be unreachable (double-strip).
apiApp.use("/public", require("./api/kortex/publicApiRouter"));       // KORTEX public developer API (API-key auth)

// 🎓 ALUMNI INTEREST CAMPAIGN
apiApp.use("/alumni", require("./api/alumni/alumniRoutes"));           // Interest form, scoring, admin dashboard

// 🎨 KREATOR (CREATOR) MANAGEMENT - NEW!
apiApp.use("/kreators", require("./api/kreators/kreatorRoutes"));     // Kreator onboarding, auth, profile

// 🤖 AI / GPT Actions (exposed for ChatGPT / internal GPT Actions clients)
apiApp.use("/gptActions", require("./api/ai/gptActions"));

// 🔐 Auth routes (login / logout / session helpers)
apiApp.use("/auth", require("./api/auth/authRoutes"));

// 💳 CHECKOUT & PAYMENTS
apiApp.use("/createPaymentIntent", require("./api/checkout/router")); // Stripe payment intent creation

// � BILLING & SUBSCRIPTIONS
apiApp.use("/billing", require("./api/billing/router")); // Subscription management for Kortex

// �👔 ADMIN ORDER MANAGEMENT - PROTECTED WITH AUTH
const { requireAuth, requireAdmin } = require("./middleware/authMiddleware");
apiApp.post("/admin/updateOrderStatus", requireAuth, requireAdmin, require("./api/admin/updateOrderStatus"));
const { getOrder, listOrders } = require("./api/admin/getOrder");
apiApp.get("/admin/getOrder", requireAuth, requireAdmin, getOrder);
apiApp.get("/admin/listOrders", requireAuth, requireAdmin, listOrders);

// 🥗 KALEKUTZ - Voice-first nutrition tracker
apiApp.use("/kutz", require("./api/kutz/kutzRouter"));

// 📷 KAMERA QUEST - Camera/lens data & photography presets
apiApp.use("/cameras", require("./api/cameras/camerasRoutes"));
apiApp.use("/lenses", require("./api/cameras/lensesRoutes"));
apiApp.use("/presets/smart", require("./api/cameras/smartRoutes"));
apiApp.use("/presets", require("./api/cameras/presetsRoutes"));

// KORTEX: Tenant-namespaced links at alumni.kaayko.com/<tenant-slug>/<code>
// Host-aware — only activates for alumni.kaayko.com requests
apiApp.use("/", require("./api/kortex/tenantLinkResolver"));

// Phase 3: campaign namespace resolver (/:campaignSlug/:code)
// Must be mounted before legacy deep-links, and must fail-closed on unknown domains.
apiApp.use("/", require("./api/campaigns/campaignPublicResolver"));

// Universal deep-link resolver (now lives in kortex/)
apiApp.use("/", require("./api/kortex/deeplinkRoutes"));

// Export main API function
// `secrets` is what binds Secret Manager values into the running function's
// process.env. Without it STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are simply
// absent in production and every checkout call fails with
// "STRIPE_SECRET_KEY not configured" — which is exactly what happened.
// Set the values once with:
//   firebase functions:secrets:set STRIPE_SECRET_KEY
//   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
// (Firebase-managed secrets arrive with a trailing newline; consumers .trim().)
exports.api = onRequest({
  cors: true,
  invoker: "public",
  timeoutSeconds: 300,
  memory: "512MiB",
  secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
}, apiApp);

// ===========================
// 🕒 SCHEDULED FUNCTIONS
// ===========================
// The forecast scheduler pipeline (earlyMorningForecast, morningForecastUpdate,
// afternoonForecastUpdate, eveningForecastUpdate, emergencyForecastRefresh,
// forecastSchedulerHealth) was DELETED in algorithm v2.0.0: its cache writes used
// a key scheme no endpoint read, and its ML calls ran on default features —
// ~470 wasted external calls/day. Deploying removes the six Cloud Functions.

// Paddle score cache warmer — runs every 15 min, pre-warms scores for all curated spots
// Deploy: firebase deploy --only functions:warmPaddleScoreCache
const {
  warmPaddleScoreCache,
  aggregatePaddleFeedback
} = require('./scheduled/paddleScoreWarmer');

exports.warmPaddleScoreCache    = warmPaddleScoreCache;
exports.aggregatePaddleFeedback = aggregatePaddleFeedback;

// Monthly re-validation of static enrichment data (gauges, FCC vintage, tips age)
exports.enrichmentFreshness = require('./scheduled/enrichmentFreshness').enrichmentFreshness;

// KORTEX: Weekly analytics digest — every Monday 9am IST (3:30am UTC)
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runWeeklyDigest } = require("./api/kortex/analyticsAlertService");

exports.kortexWeeklyDigest = onSchedule({
  schedule: "30 3 * * 1",
  timeZone: "Asia/Kolkata",
  memory: "512MiB",
  timeoutSeconds: 300
}, async () => {
  console.log("[KortexDigest] Running weekly analytics digest...");
  const results = await runWeeklyDigest();
  console.log(`[KortexDigest] Done. Processed ${results.length} tenants.`);
});

// KORTEX: destination safety — refresh the free threat feeds every 6 hours and
// re-check live links daily so a destination that turns malicious after
// creation is switched off without anyone noticing first.
const { syncThreatFeeds, rescanActiveLinks } = require("./api/kortex/safetyJobs");

exports.kortexThreatFeedSync = onSchedule({
  schedule: "15 */6 * * *",
  timeZone: "Asia/Kolkata",
  memory: "512MiB",
  timeoutSeconds: 300
}, async () => {
  console.log("[KortexSafety] Syncing threat feeds...");
  const summary = await syncThreatFeeds();
  console.log(`[KortexSafety] Feed sync done: ${summary.totalHosts} hosts, written=${summary.written}`);
});

exports.kortexLinkRescan = onSchedule({
  schedule: "30 4 * * *",
  timeZone: "Asia/Kolkata",
  memory: "512MiB",
  timeoutSeconds: 540
}, async () => {
  console.log("[KortexSafety] Re-scanning live links...");
  const result = await rescanActiveLinks({ limit: 400 });
  console.log(`[KortexSafety] Re-scan done: scanned=${result.scanned} blocked=${result.blocked.length} errors=${result.errors}`);
});

// KORTEX: guest (no-account) workspaces expire after a year without a
// check-in; their links are disabled, never deleted, and revive on the next
// successful access-code entry.
const { expireGuestWorkspaces } = require("./api/kortex/guestJobs");

exports.kortexDemoRefresh = onSchedule({
  schedule: "20 3 * * 1",
  timeZone: "Asia/Kolkata",
  memory: "512MiB",
  timeoutSeconds: 540
}, async () => {
  console.log("[KortexDemo] Refreshing the sample workspace...");
  const result = await require("./api/kortex/demoWorkspace").seedDemo();
  console.log(`[KortexDemo] Done: links=${result.links.length} events=${result.events}`);
});

exports.kortexGuestHousekeeping = onSchedule({
  schedule: "45 3 * * *",
  timeZone: "Asia/Kolkata",
  memory: "256MiB",
  timeoutSeconds: 300
}, async () => {
  console.log("[KortexGuest] Expiring dormant guest workspaces...");
  const result = await expireGuestWorkspaces({ limit: 200 });
  console.log(`[KortexGuest] Done: expired=${result.expired} linksDisabled=${result.linksDisabled}`);
  const purged = await require("./api/kortex/guestJobs").purgeQueuedCredentialEmails();
  if (purged.removed) console.log(`[KortexGuest] Purged ${purged.removed} queued credential emails`);
});

// KORTEX: daily rollups — one counts-only document per link per UTC day, so
// the workspace overview reads days instead of replaying events and a day's
// numbers outlive the 30-day event TTL. Yesterday is re-rolled as complete;
// today is rolled partial and finished by tomorrow's run.
const { rollupDay, dailyRollupDates } = require("./api/kortex/rollups");

exports.kortexDailyRollup = onSchedule({
  schedule: "every day 02:30",
  timeZone: "UTC",
  memory: "512MiB",
  timeoutSeconds: 540
}, async () => {
  console.log("[KortexRollup] Rolling up yesterday and today...");
  for (const dateUtc of dailyRollupDates()) {
    const result = await rollupDay({ dateUtc });
    console.log(`[KortexRollup] ${result.date}: links=${result.links} written=${result.written} complete=${result.complete}`);
  }
});

console.log("✅ Kaayko API v2 - PUBLIC: fastForecast + paddlingOut | PREMIUM: forecast ($$) | SMARTLINKS: admin portal");
