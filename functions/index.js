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

// ⚠️ CRITICAL: Stripe webhook needs raw body for signature verification
// Must be defined BEFORE express.json() middleware
apiApp.use("/createPaymentIntent/webhook", express.raw({ type: 'application/json' }), require("./api/checkout/stripeWebhook"));

// Now apply JSON parsing for all other routes
apiApp.use(express.json());

// Load essential API routes
apiApp.use("/images", require("./api/products/images"));
apiApp.get("/helloWorld", (_r, res) => res.send("OK"));
apiApp.use("/products", require("./api/products/products"));
apiApp.use("/paddlingOut", require("./api/weather/paddlingout"));

// 📚 API DOCUMENTATION
apiApp.use("/docs", require("./api/core/docs"));

// 🌍 LOCATION SERVICES
apiApp.use("/nearbyWater", require("./api/weather/nearbyWater")); // Find nearby lakes/rivers for custom locations

// 🌟 STREAMLINED WEATHER APIs - Enabled
apiApp.use("/paddleScore", require("./api/weather/paddleScore"));     // ML-POWERED: Paddle condition rating with ML model
apiApp.use("/fastForecast", require("./api/weather/fastForecast"));   // PUBLIC: Fast cached forecasts for frontend
apiApp.use("/forecast", require("./api/weather/forecast").router);    // PREMIUM: On-demand forecasts (requires $$ token)

// 🔗 SMART LINKS - NEW!
apiApp.use("/smartlinks", require("./api/smartLinks/smartLinks"));    // Smart link CRUD & analytics

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

// Legacy deeplink routes
apiApp.use("/", require("./api/deepLinks/deeplinkRoutes"));

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

console.log("✅ Kaayko API v2 - PUBLIC: fastForecast + paddlingOut | PREMIUM: forecast ($$) | SMARTLINKS: admin portal");
