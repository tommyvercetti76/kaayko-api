// File: functions/src/api/docs.js
//
// 📚 SWAGGER DOCUMENTATION ENDPOINT
//
// Serves Swagger UI with the kaayko-paddling-api specification

const express = require('express');
const router = express.Router();
const path = require('path');

// Swagger UI HTML template
const swaggerUIHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Kaayko Paddling API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin:0;
      background: #fafafa;
    }
    .topbar {
      background: #1b5e20 !important;
    }
    .topbar .download-url-wrapper {
      display: none;
    }
    .swagger-ui .topbar .download-url-wrapper .select-label {
      color: #fff;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const ui = SwaggerUIBundle({
        url: 'https://us-central1-kaaykostore.cloudfunctions.net/api/docs/spec.yaml',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        tryItOutEnabled: true,
        displayRequestDuration: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        showExtensions: true,
        showCommonExtensions: true,
        supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
        onComplete: function() {
          console.log('Kaayko Paddling API Documentation loaded successfully!');
        }
      });
    };
  </script>
</body>
</html>
`;

// Route to serve Swagger UI
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerUIHTML);
});

// Route to serve the YAML specification
router.get('/spec.yaml', (req, res) => {
  try {
    const fs = require('fs');
    const yamlPath = path.join(__dirname, '../../../docs/kaayko-paddling-api-swagger.yaml');
    
    if (fs.existsSync(yamlPath)) {
      const yamlContent = fs.readFileSync(yamlPath, 'utf8');
      res.setHeader('Content-Type', 'application/x-yaml');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(yamlContent);
    } else {
      res.status(404).json({
        success: false,
        error: 'Swagger specification not found',
        message: 'The YAML specification file could not be located.'
      });
    }
  } catch (error) {
    console.error('Error serving Swagger spec:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to load Swagger specification.'
    });
  }
});

// Route to serve raw JSON version (if needed)
router.get('/spec.json', (req, res) => {
  try {
    const fs = require('fs');
    const yaml = require('yaml');
    const yamlPath = path.join(__dirname, '../../../docs/kaayko-paddling-api-swagger.yaml');
    
    if (fs.existsSync(yamlPath)) {
      const yamlContent = fs.readFileSync(yamlPath, 'utf8');
      const jsonContent = yaml.parse(yamlContent);
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json(jsonContent);
    } else {
      res.status(404).json({
        success: false,
        error: 'Swagger specification not found'
      });
    }
  } catch (error) {
    console.error('Error converting YAML to JSON:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to convert Swagger specification to JSON.'
    });
  }
});

module.exports = router;
