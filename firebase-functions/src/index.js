// functions/src/index.js
const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const express   = require("express");
const cors      = require("cors");

// 1) Let Firebase supply credentials in prod
admin.initializeApp();

// 2) Create Express app for your JSON API
const apiApp = express();
apiApp.use(cors());
apiApp.use(express.json());

// 3) Mount routers with deeplinks first for proper routing
// 🔗 Deep Link & Universal Link Management (mount first to avoid conflicts)
apiApp.use("/", require("./api/deeplinkRoutes")); // Mount at root for clean URLs

apiApp.use("/images",          require("./api/images"));
apiApp.get("/helloWorld",      (_r, res) => res.send("OK"));
apiApp.use("/products",        require("./api/products"));
apiApp.use("/paddlingOut",     require("./api/paddlingout"));
apiApp.use("/paddleConditions", require("./api/paddleConditions"));
apiApp.use("/paddlingReport", require("./api/paddlingReport"));
apiApp.use("/paddlePredict",   require("./api/paddlePredict")); // ML predictions endpoint

// 4) Export as a single HTTPS function
exports.api = functions.https.onRequest(apiApp);

// 5) Export scheduled functions
// exports.cleanupExpiredCache = require('./scheduled/cacheCleanup').cleanupExpiredCache;