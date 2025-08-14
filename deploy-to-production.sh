#!/bin/bash
# Production deployment script
# Usage: ./deploy-to-production.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

echo "🚀 KAAYKO PRODUCTION DEPLOYMENT"
echo "==============================="

# Check if logged in to Firebase
if ! firebase projects:list > /dev/null 2>&1; then
    print_error "Not logged in to Firebase. Run: firebase login"
    exit 1
fi

print_success "Firebase CLI authenticated"

# Check current project
PROJECT=$(firebase use 2>&1 | grep "Active Project:" | cut -d' ' -f3)
if [ -z "$PROJECT" ]; then
    print_error "No Firebase project selected. Run: firebase use <project-id>"
    exit 1
fi

print_status "Current project: $PROJECT"

# Confirm deployment
echo ""
print_warning "This will deploy to PRODUCTION environment: $PROJECT"
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_status "Deployment cancelled"
    exit 0
fi

# Run local tests first
print_status "Running pre-deployment tests..."
if [ -f "./quick-test-apis.sh" ]; then
    # Start emulator for testing
    firebase emulators:start --only functions,hosting &
    EMULATOR_PID=$!
    sleep 15
    
    # Run tests
    ./quick-test-apis.sh
    
    # Stop emulator
    kill $EMULATOR_PID 2>/dev/null || true
    sleep 5
    
    print_success "Pre-deployment tests passed"
else
    print_warning "Test script not found, skipping pre-deployment tests"
fi

echo ""
print_status "Deploying functions and hosting..."

# Deploy to production
firebase deploy --only functions,hosting

if [ $? -eq 0 ]; then
    print_success "🎉 DEPLOYMENT SUCCESSFUL!"
    echo ""
    echo "🌐 PRODUCTION URLS:"
    echo "=================="
    echo "Frontend:    https://$PROJECT.web.app/paddlingout"
    echo "API:         https://us-central1-$PROJECT.cloudfunctions.net/api/"
    echo ""
    echo "🧪 TEST PRODUCTION:"
    echo "=================="
    echo "curl -s https://us-central1-$PROJECT.cloudfunctions.net/api/paddlingOut | jq '.[0].id'"
    echo ""
    echo "✅ Ready for users!"
else
    print_error "Deployment failed"
    exit 1
fi
