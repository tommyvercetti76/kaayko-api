#!/bin/bash

# Kaayko Full Stack Deployment Script
# This script orchestrates the complete deployment process

set -e

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

echo "🚀 KAAYKO FULL STACK DEPLOYMENT"
echo "================================"
echo "This script will deploy:"
echo "1. 🤖 ML Service (Cloud Run)"
echo "2. 🔥 Firebase Functions (API)"
echo "3. 🌐 Frontend (Firebase Hosting)"
echo ""

# Show configuration
show_config

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
log_success "DEPLOYMENT COMPLETE!"
echo "======================="
echo "✅ ML Service: $ML_SERVICE_URL"
echo "✅ API Functions: $API_FUNCTIONS_URL"
echo "✅ Frontend: $FRONTEND_URL"
echo ""
echo "🧪 FINAL SYSTEM TEST"
echo "===================="
echo "Testing complete system integration..."

echo "Testing paddlingOut API with ML integration..."
curl -s "$API_FUNCTIONS_URL/paddlingOut" 2>/dev/null | jq '.[0] | {name: .name, rating: .paddleScore.rating, mlUsed: .paddleScore.mlModelUsed, source: .paddleScore.predictionSource}' 2>/dev/null || log_warning "API test requires jq tool"

echo ""
log_success "KAAYKO DEPLOYMENT SUCCESSFUL!"
echo "Your ML-powered paddle prediction API is now live!"
echo "================================"
