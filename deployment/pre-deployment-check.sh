#!/bin/bash

# Kaayko Pre-Deployment Checklist
# Run this before deploying to production

set -e

echo "🚨 KAAYKO PRE-DEPLOYMENT CHECKLIST"
echo "=================================="
echo ""

ERRORS=0
WARNINGS=0

# Check 1: Verify trained model exists
echo "🔍 Check 1: Trained ML Model"
if [ -f "/Users/Rohan/Desktop/Kaayko_ML_Training/models/kaayko_randomforest_model.pkl" ]; then
    MODEL_SIZE=$(stat -f%z "/Users/Rohan/Desktop/Kaayko_ML_Training/models/kaayko_randomforest_model.pkl")
    echo "✅ Trained model found (${MODEL_SIZE} bytes)"
else
    echo "❌ Trained model NOT FOUND"
    ERRORS=$((ERRORS + 1))
fi

# Check 2: Verify feature names
echo ""
echo "🔍 Check 2: Feature Names"
if [ -f "/Users/Rohan/Desktop/Kaayko_ML_Training/models/feature_names.pkl" ]; then
    echo "✅ Feature names found"
else
    echo "❌ Feature names NOT FOUND"
    ERRORS=$((ERRORS + 1))
fi

# Check 3: Verify environment configuration
echo ""
echo "🔍 Check 3: Environment Configuration"
ENV_FILE="$FUNCTIONS_PATH/.env.kaaykostore"
if [ -f "$ENV_FILE" ]; then
    if grep -q "WEATHER_API_KEY=" "$ENV_FILE" && grep -q "OPENWEATHER_API_KEY=" "$ENV_FILE"; then
        echo "✅ Production API keys found in .env.kaaykostore"
    else
        echo "❌ Production API keys not found in .env.kaaykostore"
        echo "Please add: WEATHER_API_KEY and OPENWEATHER_API_KEY"
        exit 1
    fi

# Check 4: Verify gcloud setup
echo ""
echo "🔍 Check 4: Google Cloud Configuration"
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "$CURRENT_PROJECT" = "kaaykostore" ]; then
    echo "✅ gcloud project set to kaaykostore"
else
    echo "❌ gcloud project not set correctly (current: $CURRENT_PROJECT)"
    ERRORS=$((ERRORS + 1))
fi

# Check 5: Verify Firebase CLI
echo ""
echo "🔍 Check 5: Firebase CLI"
if command -v firebase &> /dev/null; then
    echo "✅ Firebase CLI installed"
else
    echo "❌ Firebase CLI NOT INSTALLED"
    ERRORS=$((ERRORS + 1))
fi

# Check 6: Check Docker setup (Cloud Build can be used as alternative)
echo ""
echo "🔍 Check 6: Docker Configuration"
if command -v docker &> /dev/null; then
    if docker info &> /dev/null; then
        echo "✅ Docker running"
    else
        echo "⚠️  Docker not running (Cloud Build will be used)"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo "⚠️  Docker not installed (Cloud Build will be used)"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 7: Verify jq for JSON processing
echo ""
echo "🔍 Check 7: JSON Processing"
if command -v jq &> /dev/null; then
    echo "✅ jq installed"
else
    echo "⚠️  jq not installed (recommended for testing)"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 8: Test current API (if running)
echo ""
echo "🔍 Check 8: Current ML Service Status"
if curl -s "https://kaayko-ml-service-87383373015.us-central1.run.app/health" | grep -q "healthy"; then
    echo "✅ Current ML service is healthy"
    echo "⚠️  Will be replaced during deployment"
    WARNINGS=$((WARNINGS + 1))
else
    echo "⚠️  Current ML service may not be responding"
    WARNINGS=$((WARNINGS + 1))
fi

# Summary
echo ""
echo "📊 CHECKLIST SUMMARY"
echo "==================="
echo "Errors: $ERRORS"
echo "Warnings: $WARNINGS"
echo ""

if [ $ERRORS -gt 0 ]; then
    echo "❌ DEPLOYMENT BLOCKED - Fix errors before proceeding"
    echo "Cannot deploy with $ERRORS error(s)"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo "⚠️  DEPLOYMENT READY WITH WARNINGS"
    echo "Found $WARNINGS warning(s) - review before proceeding"
    echo ""
    read -p "Continue with deployment despite warnings? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Deployment cancelled by user"
        exit 1
    fi
else
    echo "✅ ALL CHECKS PASSED - READY FOR DEPLOYMENT"
fi

echo ""
echo "🚀 Ready to deploy Kaayko production system!"
echo "Next step: Run ./deploy-full-stack.sh"
echo ""
