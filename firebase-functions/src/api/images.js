/**
 * images.js
 *
 * Proxies images from Cloud Storage so the client never sees
 * the raw firebase-storage URL.
 *
 * Routes:
 *   GET /api/images/:productId/:fileName
 */

const express = require("express");
const router  = express.Router();
const admin   = require("firebase-admin");

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    service: "images-api",
    timestamp: new Date().toISOString()
  });
});

// Default route to show API info
router.get("/", (req, res) => {
  res.json({
    service: "Images API",
    status: "running",
    usage: "GET /api/images/:productId/:fileName",
    health: "GET /api/images/health",
    timestamp: new Date().toISOString()
  });
});

// uses default bucket from initializeApp()
const bucket = admin.storage().bucket();

// OPTIONAL: basic referer check (uncomment in index.js to enable)
const ALLOWED_ORIGINS = [
  "https://kaayko.com",
  "http://localhost:8080"
];
function checkReferer(req, res, next) {
  const origin = req.get("Origin") || req.get("Referer");
  if (ALLOWED_ORIGINS.includes(origin)) return next();
  return res.status(403).send("Forbidden");
}

/**
 * GET /api/images/:productId/:fileName
 * Streams the requested image down, setting Cache headers.
 */
router.get(
  "/:productId/:fileName",
  // checkReferer,
  async (req, res) => {
    const { productId, fileName } = req.params;
    
    try {
      // Log the request for debugging
      console.log(`Image request: productId=${productId}, fileName=${fileName}`);
      
      const path = `kaaykoStoreTShirtImages/${productId}/${fileName}`;
      const file = bucket.file(path);

      const [exists] = await file.exists();
      if (!exists) {
        console.log(`Image not found: ${path}`);
        return res.status(404).json({ 
          error: "Image not found",
          path: path,
          productId,
          fileName 
        });
      }

      // cache 5 minutes in browser/CDN
      res.set("Cache-Control", "public, max-age=300");
      res.set("Content-Type", "image/jpeg"); // Default to JPEG, could be enhanced to detect type

      // pipe the contents directly
      file.createReadStream()
        .on("error", err => {
          console.error("Stream error:", err);
          res.status(500).json({ error: "Failed to stream image" });
        })
        .pipe(res);

    } catch (e) {
      console.error("Error proxying image:", e);
      res.status(500).json({ error: "Internal server error", details: e.message });
    }
  }
);

module.exports = router;