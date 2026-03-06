const express = require('express');

function buildTestApp(mountPath, router) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  return app;
}

module.exports = { buildTestApp };
