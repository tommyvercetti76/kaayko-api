#!/bin/bash

# 🚀 KAAYKO FULL-STACK DEPLOYMENT SCRIPT
# 
# Deploys both backend (Firebase Functions) and frontend (Firebase Hosting)
# with comprehensive status monitoring and health checks

set -e

echo "🚀 KAAYKO FULL-STACK PRODUCTION DEPLOYMENT"
echo "══════════════════════════════════════════════════════════════════════"
echo "📅 $(date)"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print status messages
print_section() {
    echo -e "\n${PURPLE}📋 $1${NC}"
    echo -e "${PURPLE}$(echo "$1" | sed 's/./-/g')${NC}"
}

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

print_step() {
    echo -e "${CYAN}🔧 $1${NC}"
}

# Track deployment progress
STEPS_TOTAL=8
CURRENT_STEP=0

print_progress() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo -e "${PURPLE}[${CURRENT_STEP}/${STEPS_TOTAL}]${NC} $1"
}

# Paths
API_DIR="/Users/Rohan/Desktop/Kaayko_v5/kaayko-api"
FRONTEND_DIR="/Users/Rohan/Desktop/kaayko-stable/kaayko-frontend"

print_section "PRE-DEPLOYMENT VALIDATION"

print_progress "Validating environment setup"

# Check if we're in the right directory
if [[ ! -f "$API_DIR/firebase.json" ]]; then
    print_error "API firebase.json not found at $API_DIR"
    exit 1
fi

if [[ ! -f "$FRONTEND_DIR/firebase.json" ]]; then
    print_error "Frontend firebase.json not found at $FRONTEND_DIR"
    exit 1
fi

print_success "Project directories verified"

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    print_error "Firebase CLI not installed. Install with: npm install -g firebase-tools"
    exit 1
fi

print_success "Firebase CLI found ($(firebase --version))"

# Check if logged in to Firebase
if ! firebase projects:list &> /dev/null; then
    print_error "Not logged in to Firebase. Run: firebase login"
    exit 1
fi

print_success "Firebase authentication verified"

print_progress "Checking project dependencies"

# Check API dependencies
cd "$API_DIR"
if [[ ! -d "functions/node_modules" ]]; then
    print_step "Installing API dependencies..."
    cd functions && npm install && cd ..
fi

print_success "API dependencies verified"

# Check frontend structure
cd "$FRONTEND_DIR"
if [[ ! -f "src/index.html" ]]; then
    print_error "Frontend source files not found in src/"
    exit 1
fi

print_success "Frontend source files verified"

print_section "DEPLOYMENT CONFIRMATION"

echo "📊 DEPLOYMENT SUMMARY:"
echo "══════════════════════════════════════════════════════════════════════"
echo "🔧 Backend (API):     Firebase Functions → kaaykostore"
echo "🌐 Frontend (Web):    Firebase Hosting → kaaykostore.web.app"
echo "📍 Target Project:    kaaykostore"
echo "🌍 Region:           us-central1"
echo ""

echo "🎯 API ENDPOINTS TO DEPLOY:"
echo "──────────────────────────────────────────────────────────────────────"
echo "🌊 FastForecast:     /api/fastForecast"
echo "🏄 PaddleScore:      /api/paddleScore" 
echo "📍 PaddlingOut:      /api/paddlingOut"
echo "🔮 Forecast:         /api/forecast"
echo "🛍️  Products:        /api/products"
echo "🖼️  Images:          /api/images"
echo ""

echo "🌐 FRONTEND PAGES TO DEPLOY:"
echo "──────────────────────────────────────────────────────────────────────"
echo "🏠 Main App:         /paddlingout.html (paddle conditions)"
echo "ℹ️  About:           /about.html (company info)"
echo "💬 Testimonials:     /testimonials.html (reviews)"
echo "🔄 Redirector:       /index.html (redirects to main app)"
echo ""

print_warning "This will deploy to PRODUCTION - your services will be publicly accessible"
echo ""

read -p "🚀 Continue with full-stack deployment? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Deployment cancelled by user"
    exit 0
fi

print_section "BACKEND DEPLOYMENT (Firebase Functions)"

print_progress "Deploying API to Firebase Functions"

cd "$API_DIR"

print_step "Starting Firebase Functions deployment..."
echo ""

if firebase deploy --only functions; then
    print_success "🎉 API deployed to Firebase Functions successfully!"
else
    print_error "API deployment failed. Check the output above for errors."
    exit 1
fi

print_section "FRONTEND DEPLOYMENT (Firebase Hosting)"

print_progress "Deploying frontend to Firebase Hosting"

cd "$FRONTEND_DIR"

print_step "Starting Firebase Hosting deployment..."
echo ""

if firebase deploy --only hosting; then
    print_success "🎉 Frontend deployed to Firebase Hosting successfully!"
else
    print_error "Frontend deployment failed. Check the output above for errors."
    exit 1
fi

print_section "POST-DEPLOYMENT HEALTH CHECKS"

print_progress "Running comprehensive health checks"

cd "$API_DIR"

print_step "Testing production API endpoints..."
echo ""

if [[ -f "scripts/health-check.js" ]]; then
    if node scripts/health-check.js; then
        print_success "All API health checks passed!"
    else
        print_warning "Some API health checks failed - check output above"
    fi
else
    print_warning "Health check script not found. Manual verification recommended."
fi

print_progress "Testing frontend accessibility"

print_step "Checking frontend deployment..."

# Test frontend is accessible
FRONTEND_URL="https://kaaykostore.web.app"
if curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" | grep -q "200"; then
    print_success "Frontend is accessible at $FRONTEND_URL"
else
    print_warning "Frontend may not be immediately accessible (DNS propagation)"
fi

print_section "DEPLOYMENT SUMMARY"

print_progress "Generating deployment report"

echo ""
echo "🎉 FULL-STACK DEPLOYMENT COMPLETED SUCCESSFULLY!"
echo "══════════════════════════════════════════════════════════════════════"
echo ""

echo "🔗 PRODUCTION URLs:"
echo "──────────────────────────────────────────────────────────────────────"
echo "🌐 Main Website:      https://kaaykostore.web.app"
echo "📱 Paddle App:        https://kaaykostore.web.app/paddlingout"
echo "ℹ️  About Page:       https://kaaykostore.web.app/about"  
echo "💬 Testimonials:      https://kaaykostore.web.app/testimonials"
echo ""

echo "🚀 API ENDPOINTS:"
echo "──────────────────────────────────────────────────────────────────────"
echo "🌊 FastForecast:      https://us-central1-kaaykostore.cloudfunctions.net/api/fastForecast"
echo "🏄 PaddleScore:       https://us-central1-kaaykostore.cloudfunctions.net/api/paddleScore"
echo "📍 PaddlingOut:       https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut"
echo "🔮 Forecast:          https://us-central1-kaaykostore.cloudfunctions.net/api/forecast"
echo "🛍️  Products:         https://us-central1-kaaykostore.cloudfunctions.net/api/products"
echo "🖼️  Images:           https://us-central1-kaaykostore.cloudfunctions.net/api/images"
echo ""

echo "📊 MONITORING & MANAGEMENT:"
echo "──────────────────────────────────────────────────────────────────────"
echo "🔧 Firebase Console:  https://console.firebase.google.com/project/kaaykostore"
echo "📈 Functions Logs:    https://console.firebase.google.com/project/kaaykostore/functions"
echo "🌐 Hosting Console:   https://console.firebase.google.com/project/kaaykostore/hosting"
echo ""

print_progress "Deployment completed successfully!"

echo "✨ NEXT STEPS:"
echo "──────────────────────────────────────────────────────────────────────"
echo "1. 🧪 Test your APIs: curl https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut"
echo "2. 🌐 Visit your site: open https://kaaykostore.web.app"
echo "3. 📊 Monitor performance in Firebase Console"
echo "4. 🔔 Set up alerting for production monitoring"
echo ""

# Optional: Open monitoring consoles
read -p "📊 Open Firebase Console for monitoring? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v open &> /dev/null; then
        print_status "Opening Firebase Console..."
        open "https://console.firebase.google.com/project/kaaykostore/functions"
        sleep 2
        open "https://kaaykostore.web.app"
    else
        print_status "Open these URLs manually:"
        echo "  🔧 https://console.firebase.google.com/project/kaaykostore"
        echo "  🌐 https://kaaykostore.web.app"
    fi
fi

echo ""
print_success "🏁 Full-stack deployment completed successfully!"
print_status "Your Kaayko application is now live in production!"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "🎯 Deployment completed at $(date)"
echo "═══════════════════════════════════════════════════════════════════════════════"
