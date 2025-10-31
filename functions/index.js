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

// ============================================================================
// CORE APIs
// ============================================================================
apiApp.use("/docs", require("./api/core/docs"));                         // 📚 API documentation (Swagger UI)
apiApp.get("/helloWorld", (_r, res) => res.send("OK"));                  // Health check

// ============================================================================
// PRODUCTS & E-COMMERCE
// ============================================================================
apiApp.use("/products", require("./api/products/products"));             // �️ Product catalog & voting
apiApp.use("/images", require("./api/products/images"));                 // 🖼️ Product image proxy

// ============================================================================
// WEATHER & PADDLING CONDITIONS
// ============================================================================
apiApp.use("/paddleScore", require("./api/weather/paddleScore"));        // ⭐ ML-powered paddle scoring
apiApp.use("/fastForecast", require("./api/weather/fastForecast"));      // 🚀 Fast cached forecasts (PUBLIC)
apiApp.use("/forecast", require("./api/weather/forecast").router);       // 💎 Premium on-demand forecasts
apiApp.use("/paddlingOut", require("./api/weather/paddlingout"));        // 🏞️ Paddling spots with conditions
apiApp.use("/nearbyWater", require("./api/weather/nearbyWater"));        // 🌍 Find nearby lakes/rivers

// ============================================================================
// AI & CHATBOT
// ============================================================================
apiApp.use("/paddlebot", require("./api/ai/paddleBotConversation"));     // 🤖 Conversational AI chatbot
apiApp.use("/gptActions", require("./api/ai/gptActions"));                // 🧠 GPT Actions wrapper

// ============================================================================
// SMART LINKS & DEEP LINKS
// ============================================================================
apiApp.use("/smartlinks", require("./api/smartLinks/smartLinks"));       // 🔗 Smart link CRUD & analytics
apiApp.use("/events", require("./api/smartLinks/smartLinks"));           // 📊 App event tracking
apiApp.use("/", require("./api/deepLinks/deeplinkRoutes"));              // 📱 Universal links (/l/:id, /resolve)

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