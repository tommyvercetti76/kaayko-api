#!/bin/bash

# 🚀 Kaayko API Production Deployment Script
# 
# This script deploys your locally-tested APIs to Firebase Functions
# All tests show 100% health - ready for production!

echo "🚀 KAAYKO API PRODUCTION DEPLOYMENT"
echo "═══════════════════════════════════════════════"
echo "📅 $(date)"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print status messages
print_status() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if we're in the right directory
if [[ ! -f "firebase.json" ]]; then
    print_error "firebase.json not found. Please run this script from the kaayko-api root directory."
    exit 1
fi

print_status "Pre-deployment checks..."

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    print_error "Firebase CLI not installed. Install with: npm install -g firebase-tools"
    exit 1
fi

print_success "Firebase CLI found"

# Check if logged in to Firebase
if ! firebase projects:list &> /dev/null; then
    print_error "Not logged in to Firebase. Run: firebase login"
    exit 1
fi

print_success "Firebase authentication verified"

# Check if functions dependencies are installed
if [[ ! -d "functions/node_modules" ]]; then
    print_status "Installing function dependencies..."
    cd functions && npm install
    cd ..
fi

print_success "Dependencies verified"

print_status "Starting deployment to production..."
echo ""

# Deploy functions
print_status "Deploying Firebase Functions..."
print_warning "This will deploy to production - your APIs will be publicly accessible"
echo ""

read -p "🚀 Continue with deployment? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Deployment cancelled by user"
    exit 0
fi

echo ""
print_status "Deploying to Firebase Functions..."

# Deploy functions
if firebase deploy --only functions; then
    print_success "Firebase Functions deployed successfully!"
else
    print_error "Deployment failed. Check the output above for errors."
    exit 1
fi

echo ""
print_success "🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!"
echo ""

# Show the production endpoints
echo "📋 Your Production API Endpoints:"
echo "═══════════════════════════════════════════════"
echo "🌊 FastForecast: https://us-central1-kaaykostore.cloudfunctions.net/api/fastForecast"
echo "🏄 PaddleScore:  https://us-central1-kaaykostore.cloudfunctions.net/api/paddleScore"
echo "📍 PaddlingOut:  https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut"
echo "🔮 Forecast:     https://us-central1-kaaykostore.cloudfunctions.net/api/forecast"
echo ""

print_status "Running post-deployment health check..."
echo ""

# Run production health check
if [[ -f "scripts/health-check.js" ]]; then
    node scripts/health-check.js
else
    print_warning "Health check script not found. Manually verify APIs are working."
fi

echo ""
print_success "🎯 Deployment Complete!"
print_status "Your Kaayko APIs are now live in production!"
print_status "Monitor performance at: https://console.firebase.google.com/project/kaaykostore/functions"
echo ""

# Optional: Open Firebase console
read -p "📊 Open Firebase Console to monitor? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v open &> /dev/null; then
        open "https://console.firebase.google.com/project/kaaykostore/functions"
    else
        print_status "Open: https://console.firebase.google.com/project/kaaykostore/functions"
    fi
fi

echo "🏁 Deployment script completed!"
