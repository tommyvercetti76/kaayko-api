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

console.log("✅ Kaayko API v2 - PUBLIC: fastForecast + paddlingOut | PREMIUM: forecast ($$) | SMARTLINKS: admin portal");
