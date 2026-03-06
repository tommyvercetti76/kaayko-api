const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

process.env.FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR || 'true';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'kaayko-predeploy';
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({ projectId: 'kaayko-predeploy' });

if (!admin.apps.length) {
  admin.initializeApp();
}

const functionsDir = path.resolve(__dirname, '..');
const indexPath = path.join(functionsDir, 'index.js');
const indexSource = fs.readFileSync(indexPath, 'utf8');

const requiredMounts = [
  'apiApp.use("/products"',
  'apiApp.use("/paddlingOut"',
  'apiApp.use("/docs"',
  'apiApp.use("/nearbyWater"',
  'apiApp.use("/paddleScore"',
  'apiApp.use("/fastForecast"',
  'apiApp.use("/forecast"',
  'apiApp.use("/smartlinks"',
  'apiApp.use("/kreators"',
  'apiApp.use("/gptActions"',
  'apiApp.use("/auth"',
  'apiApp.use("/createPaymentIntent"',
  'apiApp.use("/billing"',
  'apiApp.use("/cameras"',
  'apiApp.use("/lenses"',
  'apiApp.use("/presets/smart"',
  'apiApp.use("/presets"',
  'apiApp.use("/", require("./api/deepLinks/deeplinkRoutes"))',
];

const forbiddenMounts = [
  'apiApp.use("/roots"',
];

for (const mount of requiredMounts) {
  if (!indexSource.includes(mount)) {
    throw new Error(`Missing required route mount in functions/index.js: ${mount}`);
  }
}

for (const mount of forbiddenMounts) {
  if (indexSource.includes(mount)) {
    throw new Error(`Unexpected route mount in functions/index.js: ${mount}`);
  }
}

[
  './api/cameras/camerasRoutes',
  './api/cameras/lensesRoutes',
  './api/cameras/presetsRoutes',
  './api/cameras/smartRoutes',
].forEach((modulePath) => {
  require(path.join(functionsDir, modulePath));
});

console.log('Predeploy checks passed.');
