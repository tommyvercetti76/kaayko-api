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
apiApp.use(express.json());

// Load essential API routes
apiApp.use("/images", require("./api/images"));
apiApp.get("/helloWorld", (_r, res) => res.send("OK"));
apiApp.use("/products", require("./api/products"));
apiApp.use("/paddlingOut", require("./api/paddlingout"));

// 📚 API DOCUMENTATION
apiApp.use("/docs", require("./api/docs"));

// 🌍 LOCATION SERVICES
apiApp.use("/nearbyWater", require("./api/nearbyWater")); // Find nearby lakes/rivers for custom locations

// 🌟 STREAMLINED WEATHER APIs
apiApp.use("/paddleScore", require("./api/paddleScore"));     // ML-POWERED: Paddle condition rating with ML model
apiApp.use("/fastForecast", require("./api/fastForecast"));   // PUBLIC: Fast cached forecasts for frontend
apiApp.use("/forecast", require("./api/forecast").router);    // PREMIUM: On-demand forecasts (requires $$ token)

// Legacy deeplink routes
apiApp.use("/", require("./api/deeplinkRoutes"));

// Export main API function
exports.api = onRequest({
  cors: true,
  invoker: "public"
}, apiApp);

// ===========================
// 🕒 SCHEDULED FUNCTIONS
// ===========================
const {
  morningForecastWarming,
  middayForecastUpdate,
  eveningForecastUpdate,
  nightForecastMaintenance,
  emergencyForecastRefresh,
  forecastSchedulerHealth
} = require('./scheduled/forecastScheduler');

// Export scheduled forecast functions
exports.morningForecastWarming = morningForecastWarming;
exports.middayForecastUpdate = middayForecastUpdate;
exports.eveningForecastUpdate = eveningForecastUpdate;
exports.nightForecastMaintenance = nightForecastMaintenance;
exports.emergencyForecastRefresh = emergencyForecastRefresh;
exports.forecastSchedulerHealth = forecastSchedulerHealth;

console.log("✅ Kaayko API v2 - PUBLIC: fastForecast + paddlingOut | PREMIUM: forecast ($$) | SCHEDULED: forecast pre-computation");