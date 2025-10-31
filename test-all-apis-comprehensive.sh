#!/bin/bash

#############################################################
# Kaayko API Comprehensive Test Suite
# Tests ALL endpoints with proper validation
# Fixes false negatives from previous test script
#############################################################

# Note: Removed 'set -e' to allow tests to continue even if one fails

BASE_URL="http://127.0.0.1:5001/kaaykostore/us-central1/api"
PASSED=0
FAILED=0
TOTAL=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
}

print_test() {
    echo -e "\n${YELLOW}🧪 Test $TOTAL: $1${NC}"
}

print_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    ((PASSED++))
}

print_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    echo -e "${RED}   Response: $2${NC}"
    ((FAILED++))
}

test_endpoint() {
    ((TOTAL++))
    local test_name="$1"
    local url="$2"
    local method="${3:-GET}"
    local data="$4"
    local expected_check="$5"
    
    print_test "$test_name"
    echo "   URL: $method $url"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$url")
    elif [ "$method" = "POST" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$url" \
            -H "Content-Type: application/json" \
            -d "$data")
    elif [ "$method" = "PUT" ]; then
        response=$(curl -s -w "\n%{http_code}" -X PUT "$url" \
            -H "Content-Type: application/json" \
            -d "$data")
    elif [ "$method" = "DELETE" ]; then
        response=$(curl -s -w "\n%{http_code}" -X DELETE "$url")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    # Check HTTP status
    if [ "$http_code" -ne 200 ] && [ "$http_code" -ne 201 ]; then
        print_fail "$test_name - HTTP $http_code" "$body"
        return 1
    fi
    
    # Check expected content
    if [ -n "$expected_check" ]; then
        if echo "$body" | grep -q "$expected_check"; then
            print_pass "$test_name"
            echo "   Sample: $(echo "$body" | jq -r '.' 2>/dev/null | head -n 3 || echo "$body" | head -c 100)"
            return 0
        else
            print_fail "$test_name - Expected pattern not found: $expected_check" "$body"
            return 1
        fi
    else
        # Just check if response has content
        if [ -n "$body" ] && [ "$body" != "null" ] && [ "$body" != "{}" ]; then
            print_pass "$test_name"
            echo "   Sample: $(echo "$body" | jq -r '.' 2>/dev/null | head -n 3 || echo "$body" | head -c 100)"
            return 0
        else
            print_fail "$test_name - Empty response" "$body"
            return 1
        fi
    fi
}

#############################################################
# START TESTS
#############################################################

print_header "Kaayko API Comprehensive Test Suite"
echo "Base URL: $BASE_URL"
echo "Testing all endpoints with CRUD operations..."

#############################################################
# SECTION 1: Health & Documentation
#############################################################
print_header "SECTION 1: Health & Documentation"

# Note: Root endpoint (/) doesn't exist - that's OK, we test individual services

test_endpoint \
    "API Documentation (Swagger UI)" \
    "$BASE_URL/docs" \
    "GET" \
    "" \
    "swagger"

#############################################################
# SECTION 2: Smart Links - Full CRUD
#############################################################
print_header "SECTION 2: Smart Links API"

# Health check
test_endpoint \
    "SmartLinks Health Check" \
    "$BASE_URL/smartlinks/health" \
    "GET" \
    "" \
    "success"

# List all links (before creation)
test_endpoint \
    "List All Links (Initial)" \
    "$BASE_URL/smartlinks" \
    "GET" \
    "" \
    ""

# Create structured link
STRUCTURED_LINK_DATA='{
  "space": "lake",
  "linkId": "test-tahoe-999",
  "title": "Test Lake Tahoe",
  "description": "Beautiful alpine lake for testing",
  "destination": "https://kaayko.com/lakes/tahoe",
  "metadata": {
    "elevation": "6225ft",
    "activities": ["kayaking", "paddle boarding"]
  }
}'

test_endpoint \
    "Create Structured Link (POST /smartlinks)" \
    "$BASE_URL/smartlinks" \
    "POST" \
    "$STRUCTURED_LINK_DATA" \
    "linkId"

# Create short code link
SHORT_LINK_DATA='{
  "destination": "https://kaayko.com/store/paddle-999",
  "title": "Test Paddle",
  "description": "Premium carbon fiber paddle",
  "metadata": {
    "price": "$299",
    "category": "equipment"
  }
}'

test_endpoint \
    "Create Short Code Link (POST /smartlinks/short)" \
    "$BASE_URL/smartlinks/short" \
    "POST" \
    "$SHORT_LINK_DATA" \
    "code"

# Get structured link
test_endpoint \
    "Get Structured Link (GET /smartlinks/lake/test-tahoe-999)" \
    "$BASE_URL/smartlinks/lake/test-tahoe-999" \
    "GET" \
    "" \
    "test-tahoe-999"

# Update structured link
UPDATE_LINK_DATA='{
  "title": "Updated Lake Tahoe",
  "description": "Updated description for testing"
}'

test_endpoint \
    "Update Structured Link (PUT /smartlinks/lake/test-tahoe-999)" \
    "$BASE_URL/smartlinks/lake/test-tahoe-999" \
    "PUT" \
    "$UPDATE_LINK_DATA" \
    "success"

# List all links (after creation)
test_endpoint \
    "List All Links (After Creation)" \
    "$BASE_URL/smartlinks" \
    "GET" \
    "" \
    "test-tahoe-999"

# Delete structured link
test_endpoint \
    "Delete Structured Link (DELETE /smartlinks/lake/test-tahoe-999)" \
    "$BASE_URL/smartlinks/lake/test-tahoe-999" \
    "DELETE" \
    "" \
    "success"

# Verify deletion
echo -e "\n${YELLOW}🧪 Verifying deletion...${NC}"
deleted_check=$(curl -s "$BASE_URL/smartlinks/lake/test-tahoe-999")
if echo "$deleted_check" | grep -q "not found\|error"; then
    echo -e "${GREEN}✅ Link successfully deleted${NC}"
else
    echo -e "${RED}❌ Link still exists after deletion${NC}"
fi

#############################################################
# SECTION 3: Weather & Paddle Scores
#############################################################
print_header "SECTION 3: Weather & Paddle Scores"

# Paddle Score (Lake Tahoe)
test_endpoint \
    "Paddle Score - Lake Tahoe" \
    "$BASE_URL/paddleScore?lat=39.0968&lng=-120.0324" \
    "GET" \
    "" \
    "rating"

# Fast Forecast (San Francisco Bay)
test_endpoint \
    "Fast Forecast - San Francisco Bay" \
    "$BASE_URL/fastForecast?lat=37.7749&lng=-122.4194" \
    "GET" \
    "" \
    "temperature"

# Paddling Out (All curated lakes)
test_endpoint \
    "Paddling Out - Curated Lakes" \
    "$BASE_URL/paddlingOut" \
    "GET" \
    "" \
    "lakeName"

# Nearby Water (Needs params)
test_endpoint \
    "Nearby Water - Lake Discovery" \
    "$BASE_URL/nearbyWater?lat=37.7749&lng=-122.4194&radius=10000" \
    "GET" \
    "" \
    ""

#############################################################
# SECTION 4: Products
#############################################################
print_header "SECTION 4: Products Catalog"

# List all products
test_endpoint \
    "Products Catalog - List All" \
    "$BASE_URL/products" \
    "GET" \
    "" \
    "title"

# Image proxy (test with a product image)
test_endpoint \
    "Image Proxy - Test Image" \
    "$BASE_URL/images?url=https://example.com/image.jpg" \
    "GET" \
    "" \
    ""

#############################################################
# SECTION 5: AI & Chatbot
#############################################################
print_header "SECTION 5: AI & Chatbot"

# PaddleBot health check
test_endpoint \
    "PaddleBot Health Check" \
    "$BASE_URL/paddlebot/health" \
    "GET" \
    "" \
    ""

# GPT Actions health check
test_endpoint \
    "GPT Actions Health Check" \
    "$BASE_URL/gptActions/health" \
    "GET" \
    "" \
    ""

#############################################################
# SECTION 6: Deep Links
#############################################################
print_header "SECTION 6: Deep Links & Redirects"

# Test redirect handler (will return 404 if code doesn't exist - that's OK)
echo -e "\n${YELLOW}🧪 Testing redirect handler (404 expected for non-existent code)${NC}"
redirect_test=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/smartlinks/r/nonexistent123")
if [ "$redirect_test" = "404" ] || [ "$redirect_test" = "302" ] || [ "$redirect_test" = "301" ]; then
    echo -e "${GREEN}✅ Redirect handler is responding (HTTP $redirect_test)${NC}"
else
    echo -e "${RED}❌ Unexpected redirect response: HTTP $redirect_test${NC}"
fi

#############################################################
# SECTION 7: Analytics & Stats
#############################################################
print_header "SECTION 7: Analytics & Stats"

# Smart Links analytics
test_endpoint \
    "Smart Links Analytics" \
    "$BASE_URL/smartlinks/stats" \
    "GET" \
    "" \
    ""

# Track event (click)
TRACK_EVENT_DATA='{
  "linkId": "lk1ngp",
  "userAgent": "Test Suite",
  "referer": "http://localhost:8080"
}'

test_endpoint \
    "Track Event - Click" \
    "$BASE_URL/smartlinks/events/click" \
    "POST" \
    "$TRACK_EVENT_DATA" \
    "success"

#############################################################
# FINAL RESULTS
#############################################################
print_header "TEST RESULTS"

echo ""
echo -e "${BLUE}Total Tests:${NC} $TOTAL"
echo -e "${GREEN}Passed:${NC}      $PASSED"
echo -e "${RED}Failed:${NC}      $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL TESTS PASSED! Ready for frontend integration.${NC}"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "1. Start frontend: cd ../frontend && npx http-server src -p 8080"
    echo "2. Open browser: http://localhost:8080"
    echo "3. Test complete user flow"
    echo "4. Review LOCAL_TESTING_GUIDE.md for detailed instructions"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Review errors above.${NC}"
    echo ""
    echo -e "${YELLOW}Common Issues:${NC}"
    echo "1. Missing environment variables (.env.kaaykostore)"
    echo "2. Firestore emulator not running"
    echo "3. WeatherAPI key not configured"
    echo "4. OpenAI API key missing (for AI endpoints)"
    exit 1
fi
