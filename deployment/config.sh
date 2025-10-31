#!/bin/bash

# Kaayko Deployment Configuration
# This file contains all configurable values for deployment scripts
# Source this file in other deployment scripts: source "$(dirname "$0")/config.sh"

# Auto-detect monorepo root (assuming this script is in api/deployment/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Project Configuration
export PROJECT_ID="kaaykostore"
export REGION="us-central1"
export SERVICE_NAME="kaayko-ml-service"

# Path Configuration (relative to monorepo root)
export API_PATH="$MONOREPO_ROOT/api"
export FRONTEND_PATH="$MONOREPO_ROOT/frontend"
export ML_PATH="$MONOREPO_ROOT/ml"
export FUNCTIONS_PATH="$MONOREPO_ROOT/api/functions"
export ML_SERVICE_PATH="$MONOREPO_ROOT/api/ml-service"
export LOCAL_DEV_PATH="$MONOREPO_ROOT/local-dev"

# Cloud Run Configuration
export ML_SERVICE_MEMORY="2Gi"
export ML_SERVICE_CPU="2"
export ML_SERVICE_TIMEOUT="300"
export ML_SERVICE_MAX_INSTANCES="5"

# Firebase Configuration
export FIREBASE_PROJECT="$PROJECT_ID"

# Production URLs
export ML_SERVICE_URL="https://kaayko-ml-service-87383373015.us-central1.run.app"
export API_FUNCTIONS_URL="https://us-central1-$PROJECT_ID.cloudfunctions.net/api"
export FRONTEND_URL="https://$PROJECT_ID.web.app"

# Deployment Settings
export CLOUD_BUILD_TIMEOUT="1200s"
export CLOUD_BUILD_MACHINE_TYPE="e2-highcpu-8"

# Color codes for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Validate configuration
validate_config() {
    log_info "Validating configuration..."
    
    if [ ! -d "$MONOREPO_ROOT" ]; then
        log_error "Monorepo root not found: $MONOREPO_ROOT"
        return 1
    fi
    
    if [ ! -d "$API_PATH" ]; then
        log_error "API path not found: $API_PATH"
        return 1
    fi
    
    if [ ! -d "$FRONTEND_PATH" ]; then
        log_error "Frontend path not found: $FRONTEND_PATH"
        return 1
    fi
    
    log_success "Configuration validated"
    return 0
}

# Display configuration
show_config() {
    echo ""
    echo "📋 Deployment Configuration"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Project ID:      $PROJECT_ID"
    echo "Region:          $REGION"
    echo "Monorepo Root:   $MONOREPO_ROOT"
    echo "API Path:        $API_PATH"
    echo "Frontend Path:   $FRONTEND_PATH"
    echo "ML Service Path: $ML_SERVICE_PATH"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}
