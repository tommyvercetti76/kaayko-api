#!/bin/bash

# Kaayko Full Stack Deployment Script
# This script orchestrates the complete deployment process

set -e

echo "🚀 KAAYKO FULL STACK DEPLOYMENT"
echo "================================"
echo "This script will deploy:"
echo "1. 🤖 ML Service (Cloud Run)"
echo "2. 🔥 Firebase Functions (API)"
echo "3. 🌐 Frontend (Firebase Hosting)"
echo ""

# Configuration
DEPLOYMENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="kaaykostore"

echo "📋 Configuration:"
echo "   Project ID: $PROJECT_ID"
echo "   Deployment Dir: $DEPLOYMENT_DIR"
echo ""

# Verify user is ready
read -p "🚨 This will deploy to PRODUCTION. Are you sure? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

# Set up gcloud project
echo ""
echo "🔧 Setting up Google Cloud project..."
gcloud config set project $PROJECT_ID
echo "✅ Project set to $PROJECT_ID"

# Deployment steps
STEP=1
TOTAL_STEPS=3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 STEP $STEP/$TOTAL_STEPS: Deploying ML Service"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$DEPLOYMENT_DIR/deploy-ml-service.sh"
STEP=$((STEP + 1))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔥 STEP $STEP/$TOTAL_STEPS: Deploying Firebase Functions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$DEPLOYMENT_DIR/deploy-firebase-functions.sh"
STEP=$((STEP + 1))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 STEP $STEP/$TOTAL_STEPS: Deploying Frontend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$DEPLOYMENT_DIR/deploy-frontend.sh"

echo ""
echo "🎉 DEPLOYMENT COMPLETE!"
echo "======================="
echo "✅ ML Service: https://kaayko-ml-service-87383373015.us-central1.run.app"
echo "✅ API Functions: https://us-central1-$PROJECT_ID.cloudfunctions.net/api"
echo "✅ Frontend: https://$PROJECT_ID.web.app"
echo ""
echo "🧪 FINAL SYSTEM TEST"
echo "===================="
echo "Testing complete system integration..."

API_URL="https://us-central1-$PROJECT_ID.cloudfunctions.net/api"
echo "Testing paddlingOut API with ML integration..."
curl -s "$API_URL/paddlingOut" | jq '.[0] | {name: .name, rating: .paddleScore.rating, mlUsed: .paddleScore.mlModelUsed, source: .paddleScore.predictionSource}'

echo ""
echo "🌟 KAAYKO DEPLOYMENT SUCCESSFUL!"
echo "Your ML-powered paddle prediction API is now live!"
echo "================================"
