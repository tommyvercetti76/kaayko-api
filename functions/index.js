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
const PRIVILEGED_PREFIXES = ["/admin", "/kreators/admin", "/billing", "/campaigns"];

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
exports.api = onRequest({
  cors: true,
  invoker: "public",
  timeoutSeconds: 300,
  memory: "512MiB"
}, apiApp);

// ===========================
// 🕒 SCHEDULED FUNCTIONS - TEMPORARILY DISABLED
// ===========================
// Scheduled forecast generator (enabled)
const {
  earlyMorningForecast,
  morningForecastUpdate,
  afternoonForecastUpdate,
  eveningForecastUpdate,
  emergencyForecastRefresh,
  forecastSchedulerHealth
} = require('./scheduled/forecastScheduler');

// Export scheduled forecast functions as Cloud Function scheduled triggers
exports.earlyMorningForecast = earlyMorningForecast;
exports.morningForecastUpdate = morningForecastUpdate;
exports.afternoonForecastUpdate = afternoonForecastUpdate;
exports.eveningForecastUpdate = eveningForecastUpdate;
exports.emergencyForecastRefresh = emergencyForecastRefresh;
exports.forecastSchedulerHealth = forecastSchedulerHealth;

// Paddle score cache warmer — runs every 15 min, pre-warms scores for all curated spots
// Deploy: firebase deploy --only functions:warmPaddleScoreCache
const {
  warmPaddleScoreCache,
  aggregatePaddleFeedback
} = require('./scheduled/paddleScoreWarmer');

exports.warmPaddleScoreCache    = warmPaddleScoreCache;
exports.aggregatePaddleFeedback = aggregatePaddleFeedback;

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

console.log("✅ Kaayko API v2 - PUBLIC: fastForecast + paddlingOut | PREMIUM: forecast ($$) | SMARTLINKS: admin portal");
