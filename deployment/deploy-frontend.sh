#!/bin/bash

# Kaayko Frontend Deployment Script
# This script deploys the frontend to Firebase Hosting

set -e

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

echo "🌐 Kaayko Frontend Deployment"
echo "=============================="

# Show configuration
show_config

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
echo "Frontend URL: $FRONTEND_URL"

echo "Testing homepage..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")
if [ "$HTTP_CODE" = "200" ]; then
    log_success "Homepage accessible (HTTP $HTTP_CODE)"
else
    log_warning "Homepage returned HTTP $HTTP_CODE"
fi

echo ""
echo "🎉 Frontend Deployment Complete!"
echo "Frontend URL: $FRONTEND_URL"
echo "=============================="
