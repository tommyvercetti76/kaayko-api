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
apiApp.use("/paddleConditions", require("./api/paddleConditions"));
apiApp.use("/paddlingReport", require("./api/paddlingReport"));
apiApp.use("/paddlePredict", require("./api/paddlePredict"));
apiApp.use("/", require("./api/deeplinkRoutes"));

// Export main API function directly without nested /api mounting
exports.api = onRequest({
  cors: true,
  invoker: "public"  // Allow public access without authentication
}, apiApp);

// Export additional HTTP functions
const { fastForecast, cacheManager } = require("./api/fastForecast");
exports.fastForecast = fastForecast;
exports.cacheManager = cacheManager;

console.log("✅ Kaayko API restored with all endpoints + fastForecast + cacheManager - Firebase Functions v2");