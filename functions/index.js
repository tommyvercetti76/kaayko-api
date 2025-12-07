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
// apiApp.use("/nearbyWater", require("./api/weather/nearbyWater")); // Find nearby lakes/rivers for custom locations

// 🌟 STREAMLINED WEATHER APIs - TEMPORARILY DISABLED FOR STRIPE TESTING
// apiApp.use("/paddleScore", require("./api/weather/paddleScore"));     // ML-POWERED: Paddle condition rating with ML model
// apiApp.use("/fastForecast", require("./api/weather/fastForecast"));   // PUBLIC: Fast cached forecasts for frontend
// apiApp.use("/forecast", require("./api/weather/forecast").router);    // PREMIUM: On-demand forecasts (requires $$ token)

// 🔗 SMART LINKS - NEW!
apiApp.use("/smartlinks", require("./api/smartLinks/smartLinks"));    // Smart link CRUD & analytics

// 💳 CHECKOUT & PAYMENTS
apiApp.use("/createPaymentIntent", require("./api/checkout/router")); // Stripe payment intent creation

// 👔 ADMIN ORDER MANAGEMENT
apiApp.post("/admin/updateOrderStatus", require("./api/admin/updateOrderStatus"));
const { getOrder, listOrders } = require("./api/admin/getOrder");
apiApp.get("/admin/getOrder", getOrder);
apiApp.get("/admin/listOrders", listOrders);

// Legacy deeplink routes
apiApp.use("/", require("./api/deepLinks/deeplinkRoutes"));

// Export main API function
exports.api = onRequest({
  cors: true,
  invoker: "public"
}, apiApp);

// ===========================
// 🕒 SCHEDULED FUNCTIONS - TEMPORARILY DISABLED
// ===========================
// const {
//   morningForecastWarming,
//   middayForecastUpdate,
//   eveningForecastUpdate,
//   nightForecastMaintenance,
//   emergencyForecastRefresh,
//   forecastSchedulerHealth
// } = require('./scheduled/forecastScheduler');

// Export scheduled forecast functions
// exports.morningForecastWarming = morningForecastWarming;
// exports.middayForecastUpdate = middayForecastUpdate;
// exports.eveningForecastUpdate = eveningForecastUpdate;
// exports.nightForecastMaintenance = nightForecastMaintenance;
// exports.emergencyForecastRefresh = emergencyForecastRefresh;
// exports.forecastSchedulerHealth = forecastSchedulerHealth;

console.log("✅ Kaayko API v2 - PUBLIC: fastForecast + paddlingOut | PREMIUM: forecast ($$) | SMARTLINKS: admin portal");
