#!/bin/bash

# Kaayko Firebase Functions Deployment Script
# This script deploys the API functions to Firebase

set -e

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

echo "🔥 Kaayko Firebase Functions Deployment"
echo "======================================="

# Show configuration
show_config

# Step 1: Verify environment configuration
echo "🔍 Step 1: Verifying environment configuration..."
cd "$FUNCTIONS_PATH"

if [ ! -f ".env.kaaykostore" ]; then
    echo "❌ Error: Production environment file .env.kaaykostore not found"
    exit 1
fi

echo "✅ Environment configuration found"

# Step 2: Set up production environment
echo ""
echo "🔧 Step 2: Setting up production environment..."
cp .env.kaaykostore .env
echo "✅ Production environment activated"

# Step 3: Verify dependencies
echo ""
echo "📦 Step 3: Verifying dependencies..."
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found"
    exit 1
fi

npm list --depth=0 || echo "Some dependencies may be missing, but continuing..."

# Step 4: Deploy to Firebase
echo ""
echo "🚀 Step 4: Deploying to Firebase..."
cd "$API_PATH"

# Deploy functions
firebase deploy --only functions --project $PROJECT_ID

echo "✅ Firebase Functions deployed successfully!"

# Step 5: Test the deployment
echo ""
echo "🧪 Step 5: Testing deployment..."
echo "Testing API endpoint: $API_FUNCTIONS_URL"

echo ""
echo "Testing paddlingOut endpoint..."
curl -s "$API_FUNCTIONS_URL/paddlingOut" | jq '.[0] | {name: .name, paddleScore: .paddleScore.rating}' 2>/dev/null || echo "Note: Install jq for formatted output"

# Step 6: Clean up
echo ""
echo "🧹 Step 6: Cleaning up..."
cd functions
rm -f .env
echo "✅ Cleanup complete"

echo ""
echo ""
echo "🎉 Firebase Functions Deployment Complete!"
echo "API URL: $API_FUNCTIONS_URL"
echo "======================================="