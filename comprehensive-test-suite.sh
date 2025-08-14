#!/bin/bash
# COMPREHENSIVE KAAYKO TEST SUITE
# Tests ALL APIs, Frontend, Firebase Services, and Production Readiness
# Usage: ./comprehensive-test-suite.sh [--production]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Test mode
PRODUCTION_MODE=false
if [[ "$1" == "--production" ]]; then
    PRODUCTION_MODE=true
fi

# Configuration
LOCAL_API_BASE="http://127.0.0.1:5002/api"
LOCAL_FUNCTIONS_BASE="http://127.0.0.1:5003/kaaykostore/us-central1"
LOCAL_FRONTEND="http://127.0.0.1:5002"
PROD_API_BASE="https://us-central1-kaaykostore.cloudfunctions.net/api"
PROD_FRONTEND="https://kaaykostore.web.app"

# Set endpoints based on mode
if [[ "$PRODUCTION_MODE" == "true" ]]; then
    API_BASE="$PROD_API_BASE"
    FUNCTIONS_BASE="https://us-central1-kaaykostore.cloudfunctions.net"
    FRONTEND_BASE="$PROD_FRONTEND"
    echo -e "${YELLOW}🌐 TESTING PRODUCTION ENVIRONMENT${NC}"
else
    API_BASE="$LOCAL_API_BASE"
    FUNCTIONS_BASE="$LOCAL_FUNCTIONS_BASE"
    FRONTEND_BASE="$LOCAL_FRONTEND"
    echo -e "${BLUE}🏠 TESTING LOCAL ENVIRONMENT${NC}"
fi

# Function definitions
print_header() { echo -e "${CYAN}$1${NC}"; echo -e "${CYAN}$(echo "$1" | sed 's/./=/g')${NC}"; }
print_section() { echo -e "\n${PURPLE}📋 $1${NC}"; echo -e "${PURPLE}$(echo "$1" | sed 's/./-/g')${NC}"; }
print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[✅ PASS]${NC} $1"; }
print_error() { echo -e "${RED}[❌ FAIL]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[⚠️  WARN]${NC} $1"; }
print_test() { echo -e "${CYAN}[TEST]${NC} $1"; }

# Test counters
TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_WARNINGS=0

test_result() {
    ((TESTS_TOTAL++))
    if [[ "$1" == "pass" ]]; then
        ((TESTS_PASSED++))
        print_success "$2"
    elif [[ "$1" == "fail" ]]; then
        ((TESTS_FAILED++))
        print_error "$2"
    elif [[ "$1" == "warn" ]]; then
        ((TESTS_WARNINGS++))
        print_warning "$2"
    fi
}

# Function to test API endpoint
test_api_endpoint() {
    local url="$1"
    local description="$2"
    local expected_pattern="$3"
    local timeout="${4:-10}"
    
    print_test "$description"
    
    local response
    local status_code
    
    # Use timeout to avoid hanging
    if command -v timeout >/dev/null 2>&1; then
        response=$(timeout "$timeout" curl -s -w "\\n%{http_code}" "$url" 2>/dev/null)
    else
        response=$(curl -s -w "\\n%{http_code}" "$url" 2>/dev/null)
    fi
    
    if [[ $? -ne 0 ]]; then
        test_result "fail" "$description - Connection failed"
        return 1
    fi
    
    status_code=$(echo "$response" | tail -n1)
    response_body=$(echo "$response" | sed '$d')
    
    if [[ "$status_code" -ge 200 && "$status_code" -lt 300 ]]; then
        if [[ -n "$expected_pattern" ]]; then
            if echo "$response_body" | grep -q "$expected_pattern"; then
                test_result "pass" "$description - Status: $status_code"
                return 0
            else
                test_result "warn" "$description - Status: $status_code but unexpected response format"
                echo "    Expected: $expected_pattern"
                echo "    Got: ${response_body:0:200}..."
                return 1
            fi
        else
            test_result "pass" "$description - Status: $status_code"
            return 0
        fi
    elif [[ "$status_code" -ge 400 && "$status_code" -lt 500 ]]; then
        test_result "warn" "$description - Client error: $status_code"
        return 1
    else
        test_result "fail" "$description - Server error: $status_code"
        return 1
    fi
}

# Function to test frontend page
test_frontend_page() {
    local url="$1"
    local description="$2"
    local expected_pattern="$3"
    
    print_test "$description"
    
    local response
    local status_code
    
    response=$(curl -s -w "\\n%{http_code}" "$url" 2>/dev/null)
    
    if [[ $? -ne 0 ]]; then
        test_result "fail" "$description - Connection failed"
        return 1
    fi
    
    status_code=$(echo "$response" | tail -n1)
    response_body=$(echo "$response" | sed '$d')
    
    if [[ "$status_code" -eq 200 ]]; then
        if [[ -n "$expected_pattern" ]]; then
            if echo "$response_body" | grep -q "$expected_pattern"; then
                test_result "pass" "$description"
                return 0
            else
                test_result "warn" "$description - Page loaded but missing expected content"
                return 1
            fi
        else
            test_result "pass" "$description"
            return 0
        fi
    else
        test_result "fail" "$description - Status: $status_code"
        return 1
    fi
}

# Main test execution
print_header "🚀 KAAYKO COMPREHENSIVE TEST SUITE"
echo -e "Mode: ${PRODUCTION_MODE:+PRODUCTION}${PRODUCTION_MODE:-LOCAL}"
echo -e "Time: $(date)"
echo -e "API Base: $API_BASE"
echo -e "Frontend: $FRONTEND_BASE"

# Check if local emulator is running (for local mode)
if [[ "$PRODUCTION_MODE" == "false" ]]; then
    print_section "Emulator Health Check"
    if ! curl -s "$LOCAL_FRONTEND" > /dev/null 2>&1; then
        print_error "❌ Local emulator not running!"
        echo "Start emulator with: ./start-and-test.sh"
        exit 1
    fi
    print_success "✅ Local emulator is running"
fi

# ========================================
# CORE API TESTS
# ========================================

print_section "Core API Endpoints"

# Test paddlingOut API
test_api_endpoint "$API_BASE/paddlingOut" "PaddlingOut API - All spots" '"id".*"imgSrc"'

# Test individual paddling spot
test_api_endpoint "$API_BASE/paddlingOut/diablo" "PaddlingOut API - Individual spot (diablo)" '"title":"Diablo Lake"'

# Test products API
test_api_endpoint "$API_BASE/products" "Products API - All products" '"name\|title"'

# Test individual product
if [[ "$PRODUCTION_MODE" == "false" ]]; then
    test_api_endpoint "$API_BASE/products/nagpur" "Products API - Individual product" '"title\|name"'
fi

# Test images API
test_api_endpoint "$API_BASE/images" "Images API - Info endpoint" '"service".*"Images API"'

# Test images health
test_api_endpoint "$API_BASE/images/health" "Images API - Health check" '"status".*"healthy"'

# ========================================
# ADVANCED API TESTS
# ========================================

print_section "Advanced API Endpoints"

# Test paddle conditions API
test_api_endpoint "$API_BASE/paddleConditions/summary?lat=39.7392&lng=-104.9903" "Paddle Conditions API - Summary" '"rating\|conditions\|safety"'

# Test paddle conditions health
test_api_endpoint "$API_BASE/paddleConditions/health" "Paddle Conditions API - Health" '"status".*"healthy"'

# Test paddling report API
test_api_endpoint "$API_BASE/paddlingReport/health" "Paddling Report API - Health" '"status".*"healthy"'

# Test deeplink routes health
test_api_endpoint "$API_BASE/health" "Deeplink Routes API - Health" '"status".*"healthy"'

# ========================================
# FIREBASE FUNCTIONS TESTS
# ========================================

print_section "Firebase Functions"

# Test fastForecast function
test_api_endpoint "$FUNCTIONS_BASE/fastForecast?lat=39.7392&lng=-104.9903" "FastForecast Function" '"forecast\|weather\|error"'

# Test cacheManager function
test_api_endpoint "$FUNCTIONS_BASE/cacheManager" "Cache Manager Function" '"status\|cache"'

# ========================================
# FRONTEND TESTS
# ========================================

print_section "Frontend Pages"

# Test main paddling page
test_frontend_page "$FRONTEND_BASE/paddlingout" "Frontend - Paddling spots page" "<!DOCTYPE html"

# Test individual spot page
test_frontend_page "$FRONTEND_BASE/paddlingout?id=diablo" "Frontend - Individual spot page" "<!DOCTYPE html"

# Test about page
test_frontend_page "$FRONTEND_BASE/about" "Frontend - About page" "<!DOCTYPE html"

# Test testimonials page
test_frontend_page "$FRONTEND_BASE/testimonials" "Frontend - Testimonials page" "<!DOCTYPE html"

# ========================================
# FRONTEND ASSET TESTS
# ========================================

print_section "Frontend Assets"

# Test critical JS files
test_frontend_page "$FRONTEND_BASE/js/paddlingout.js" "Frontend JS - paddlingout.js" "function\|const\|var"

test_frontend_page "$FRONTEND_BASE/js/main.js" "Frontend JS - main.js" "function\|const\|var"

test_frontend_page "$FRONTEND_BASE/js/kaayko_ui.js" "Frontend JS - kaayko_ui.js" "function\|const\|var"

# Test critical CSS files
test_frontend_page "$FRONTEND_BASE/css/storestyle.css" "Frontend CSS - storestyle.css" "body\|\.|\#"

# ========================================
# DATA INTEGRITY TESTS
# ========================================

print_section "Data Integrity"

# Test paddling spots have images
print_test "Paddling spots data integrity"
SPOTS_RESPONSE=$(curl -s "$API_BASE/paddlingOut" 2>/dev/null)
if echo "$SPOTS_RESPONSE" | jq -e '.[0].imgSrc | length > 0' >/dev/null 2>&1; then
    SPOTS_COUNT=$(echo "$SPOTS_RESPONSE" | jq '. | length' 2>/dev/null)
    test_result "pass" "Paddling spots have images ($SPOTS_COUNT spots loaded)"
elif echo "$SPOTS_RESPONSE" | grep -q '"imgSrc"'; then
    test_result "pass" "Paddling spots data structure valid (jq not available)"
else
    test_result "fail" "Paddling spots missing image data"
fi

# Test individual spot has specific images
print_test "Individual spot image specificity"
DIABLO_RESPONSE=$(curl -s "$API_BASE/paddlingOut/diablo" 2>/dev/null)
if echo "$DIABLO_RESPONSE" | grep -q "diablo.*webp"; then
    DIABLO_IMAGES=$(echo "$DIABLO_RESPONSE" | grep -o "diablo[0-9]" | wc -l)
    test_result "pass" "Diablo spot has spot-specific images ($DIABLO_IMAGES images)"
else
    test_result "fail" "Individual spot not returning spot-specific images"
fi

# ========================================
# FIREBASE STORAGE TESTS
# ========================================

print_section "Firebase Storage"

# Test direct image access
print_test "Firebase Storage direct access"
STORAGE_URL="https://firebasestorage.googleapis.com/v0/b/kaaykostore.firebasestorage.app/o/images%2Fpaddling_out%2Fdiablo1.webp?alt=media"
STORAGE_RESPONSE=$(curl -s -I "$STORAGE_URL" 2>/dev/null | head -n1)
if echo "$STORAGE_RESPONSE" | grep -q "200 OK"; then
    test_result "pass" "Firebase Storage images accessible"
else
    test_result "warn" "Firebase Storage access may be restricted"
fi

# ========================================
# PERFORMANCE TESTS
# ========================================

print_section "Performance"

# Test API response times
print_test "API response time (paddlingOut)"
START_TIME=$(date +%s%N)
curl -s "$API_BASE/paddlingOut" > /dev/null 2>&1
END_TIME=$(date +%s%N)
RESPONSE_TIME=$(( (END_TIME - START_TIME) / 1000000 ))
if [[ $RESPONSE_TIME -lt 5000 ]]; then
    test_result "pass" "API response time: ${RESPONSE_TIME}ms (< 5s)"
elif [[ $RESPONSE_TIME -lt 10000 ]]; then
    test_result "warn" "API response time: ${RESPONSE_TIME}ms (5-10s)"
else
    test_result "fail" "API response time: ${RESPONSE_TIME}ms (> 10s)"
fi

# Test frontend page load time
print_test "Frontend load time"
START_TIME=$(date +%s%N)
curl -s "$FRONTEND_BASE/paddlingout" > /dev/null 2>&1
END_TIME=$(date +%s%N)
LOAD_TIME=$(( (END_TIME - START_TIME) / 1000000 ))
if [[ $LOAD_TIME -lt 3000 ]]; then
    test_result "pass" "Frontend load time: ${LOAD_TIME}ms (< 3s)"
elif [[ $LOAD_TIME -lt 8000 ]]; then
    test_result "warn" "Frontend load time: ${LOAD_TIME}ms (3-8s)"
else
    test_result "fail" "Frontend load time: ${LOAD_TIME}ms (> 8s)"
fi

# ========================================
# SECURITY TESTS
# ========================================

print_section "Security"

# Test CORS headers
print_test "CORS headers"
CORS_RESPONSE=$(curl -s -I "$API_BASE/paddlingOut" 2>/dev/null)
if echo "$CORS_RESPONSE" | grep -q "Access-Control-Allow-Origin"; then
    test_result "pass" "CORS headers present"
else
    test_result "warn" "CORS headers missing"
fi

# Test rate limiting (if applicable)
print_test "Rate limiting protection"
RATE_RESPONSE=$(curl -s -I "$API_BASE/paddleConditions/health" 2>/dev/null)
if echo "$RATE_RESPONSE" | grep -q "X-RateLimit\|Rate-Limit"; then
    test_result "pass" "Rate limiting headers present"
else
    test_result "warn" "Rate limiting headers not detected"
fi

# ========================================
# ERROR HANDLING TESTS
# ========================================

print_section "Error Handling"

# Test 404 handling
test_api_endpoint "$API_BASE/nonexistent" "404 Error handling" "error\|not found\|404"

# Test invalid parameters
test_api_endpoint "$API_BASE/paddlingOut/invalid_spot_id_12345" "Invalid parameter handling" "error\|not found"

# ========================================
# INTEGRATION TESTS
# ========================================

print_section "Integration Tests"

# Test API data matches frontend expectations
print_test "API-Frontend integration"
API_DATA=$(curl -s "$API_BASE/paddlingOut" 2>/dev/null)
FRONTEND_PAGE=$(curl -s "$FRONTEND_BASE/paddlingout" 2>/dev/null)

if echo "$API_DATA" | grep -q '"imgSrc"' && echo "$FRONTEND_PAGE" | grep -q "paddlingout.js"; then
    test_result "pass" "API data structure matches frontend expectations"
else
    test_result "warn" "API-Frontend integration needs verification"
fi

# Test deeplink functionality
test_api_endpoint "$API_BASE/l/test123" "Deeplink redirect handling" "html\|redirect\|location"

# ========================================
# FINAL RESULTS
# ========================================

print_header "📊 TEST RESULTS SUMMARY"
echo -e "Total Tests: ${CYAN}$TESTS_TOTAL${NC}"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo -e "Warnings: ${YELLOW}$TESTS_WARNINGS${NC}"

# Calculate success rate
if [[ $TESTS_TOTAL -gt 0 ]]; then
    SUCCESS_RATE=$(( (TESTS_PASSED * 100) / TESTS_TOTAL ))
    echo -e "Success Rate: ${CYAN}$SUCCESS_RATE%${NC}"
    
    if [[ $SUCCESS_RATE -ge 90 ]]; then
        echo -e "\n${GREEN}🎉 EXCELLENT! System is ready for production${NC}"
        EXIT_CODE=0
    elif [[ $SUCCESS_RATE -ge 75 ]]; then
        echo -e "\n${YELLOW}✅ GOOD! System is mostly ready, review warnings${NC}"
        EXIT_CODE=0
    elif [[ $SUCCESS_RATE -ge 50 ]]; then
        echo -e "\n${YELLOW}⚠️  CAUTION! System has issues, fix before deploying${NC}"
        EXIT_CODE=1
    else
        echo -e "\n${RED}❌ CRITICAL! System has major issues${NC}"
        EXIT_CODE=2
    fi
else
    echo -e "\n${RED}❌ No tests executed${NC}"
    EXIT_CODE=3
fi

# Additional info
echo -e "\n${BLUE}📋 NEXT STEPS:${NC}"
if [[ "$PRODUCTION_MODE" == "true" ]]; then
    echo "• Monitor production metrics"
    echo "• Check error logs if issues found"
    echo "• Update monitoring alerts"
else
    echo "• Fix any failed tests before deployment"
    echo "• Run production tests: $0 --production"
    echo "• Deploy with: ./deploy-to-production.sh"
fi

echo -e "\n${CYAN}🔗 USEFUL LINKS:${NC}"
echo "• Frontend: $FRONTEND_BASE/paddlingout"
echo "• API Docs: $API_BASE/"
echo "• Emulator UI: http://127.0.0.1:4002/"

echo -e "\n${CYAN}📝 QUICK COMMANDS:${NC}"
echo "• Test APIs: ./quick-test-apis.sh"
echo "• Start dev: ./start-and-test.sh"
echo "• Deploy: ./deploy-to-production.sh"

exit $EXIT_CODE
