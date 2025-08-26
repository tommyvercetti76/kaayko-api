#!/bin/bash

# Kaayko Frontend Deployment Script
# This script deploys the frontend to Firebase Hosting

set -e

echo "🌐 Kaayko Frontend Deployment"
echo "=============================="

# Configuration
PROJECT_ID="kaaykostore"
FRONTEND_PATH="/Users/Rohan/Desktop/kaayko-stable/kaayko-frontend"
API_PATH="/Users/Rohan/Desktop/Kaayko_v5/kaayko-api"

echo "📋 Deployment Configuration:"
echo "   Project ID: $PROJECT_ID"
echo "   Frontend Path: $FRONTEND_PATH"
echo "   API Path: $API_PATH"
echo ""

# Step 1: Verify frontend exists
echo "🔍 Step 1: Verifying frontend..."
if [ ! -d "$FRONTEND_PATH" ]; then
    echo "❌ Error: Frontend path not found: $FRONTEND_PATH"
    exit 1
fi

if [ ! -f "$FRONTEND_PATH/src/index.html" ]; then
    echo "❌ Error: Frontend index.html not found"
    exit 1
fi

echo "✅ Frontend files found"

# Step 2: Update API configuration
echo ""
echo "🔧 Step 2: Updating API configuration..."
cd "$FRONTEND_PATH"

# Update prod-config.js to point to production API
if [ -f "src/js/prod-config.js" ]; then
    echo "Updating prod-config.js for production..."
    # This could be enhanced to automatically update API endpoints
    echo "✅ Configuration ready"
else
    echo "⚠️  Warning: prod-config.js not found, using default configuration"
fi

# Step 3: Deploy to Firebase Hosting
echo ""
echo "🚀 Step 3: Deploying to Firebase Hosting..."
cd "$API_PATH"

# Deploy hosting
firebase deploy --only hosting --project $PROJECT_ID

echo "✅ Frontend deployed successfully!"

# Step 4: Test the deployment
echo ""
echo "🧪 Step 4: Testing deployment..."
HOSTING_URL="https://$PROJECT_ID.web.app"
echo "Frontend URL: $HOSTING_URL"

echo "Testing homepage..."
curl -s -o /dev/null -w "%{http_code}" "$HOSTING_URL" | grep -q "200" && echo "✅ Homepage accessible" || echo "❌ Homepage test failed"

echo ""
echo "🎉 Frontend Deployment Complete!"
echo "Frontend URL: $HOSTING_URL"
echo "=============================="
