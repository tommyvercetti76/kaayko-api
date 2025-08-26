#!/bin/bash

# Kaayko Firebase Functions Deployment Script
# This script deploys the API functions to Firebase

set -e

echo "🔥 Kaayko Firebase Functions Deployment"
echo "======================================="

# Configuration
PROJECT_ID="kaaykostore"
FUNCTIONS_PATH="/Users/Rohan/Desktop/Kaayko_v5/kaayko-api/functions"

echo "📋 Deployment Configuration:"
echo "   Project ID: $PROJECT_ID"
echo "   Functions Path: $FUNCTIONS_PATH"
echo ""

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
cd ..

# Deploy functions
firebase deploy --only functions --project $PROJECT_ID

echo "✅ Firebase Functions deployed successfully!"

# Step 5: Test the deployment
echo ""
echo "🧪 Step 5: Testing deployment..."
FUNCTION_URL="https://us-central1-$PROJECT_ID.cloudfunctions.net/api"
echo "Testing API endpoint: $FUNCTION_URL"

echo ""
echo "Testing paddlingOut endpoint..."
curl -s "$FUNCTION_URL/paddlingOut" | jq '.[0] | {name: .name, paddleScore: .paddleScore.rating}'

# Step 6: Clean up
echo ""
echo "🧹 Step 6: Cleaning up..."
cd functions
rm -f .env
echo "✅ Cleanup complete"

echo ""
echo "🎉 Firebase Functions Deployment Complete!"
echo "API URL: $FUNCTION_URL"
echo "======================================="
