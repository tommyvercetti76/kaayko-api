#!/bin/bash

# Smart Links v4 Quick Test Script
# Tests all endpoints for the simplified short-code-only API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# API Base URL - auto-detect local vs production
if curl -s http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/health > /dev/null 2>&1; then
    BASE_URL="http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks"
    echo -e "${YELLOW}🔧 Using LOCAL emulator${NC}"
else
    BASE_URL="https://us-central1-kaaykostore.cloudfunctions.net/api/smartlinks"
    echo -e "${BLUE}☁️  Using PRODUCTION${NC}"
fi

echo "Testing Smart Links v4 API at: $BASE_URL"
echo "=========================================="
echo ""

# Test counter
PASSED=0
FAILED=0

# Test function
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    local expected=$5
    
    echo -e "${BLUE}Testing: ${name}${NC}"
    
    if [ "$method" == "POST" ] || [ "$method" == "PUT" ]; then
        response=$(curl -s -X $method "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    else
        response=$(curl -s -X $method "$BASE_URL$endpoint")
    fi
    
    if echo "$response" | jq -e "$expected" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ PASSED${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAILED${NC}"
        echo "Response: $response"
        ((FAILED++))
    fi
    echo ""
}

# Store created link code for later tests
CREATED_CODE=""

# TEST 1: Health Check
echo -e "${YELLOW}=== Test 1: Health Check ===${NC}"
response=$(curl -s "$BASE_URL/health")
if echo "$response" | jq -e '.success == true and .status == "healthy"' > /dev/null; then
    echo -e "${GREEN}✅ PASSED - Health check${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED - Health check${NC}"
    ((FAILED++))
fi
echo ""

# TEST 2: Create Short Link
echo -e "${YELLOW}=== Test 2: Create Short Link ===${NC}"
response=$(curl -s -X POST "$BASE_URL" \
    -H "Content-Type: application/json" \
    -d '{
        "webDestination": "https://kaayko.com/paddlingout?id=test",
        "iosDestination": "kaayko://paddlingout?id=test",
        "title": "Test Lake",
        "description": "Automated test link"
    }')

if echo "$response" | jq -e '.success == true and .link.code' > /dev/null; then
    CREATED_CODE=$(echo "$response" | jq -r '.link.code')
    echo -e "${GREEN}✅ PASSED - Created link: $CREATED_CODE${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED - Create link${NC}"
    echo "Response: $response"
    ((FAILED++))
fi
echo ""

# TEST 3: List All Links
echo -e "${YELLOW}=== Test 3: List All Links ===${NC}"
response=$(curl -s "$BASE_URL")
if echo "$response" | jq -e '.success == true and .links | length > 0' > /dev/null; then
    count=$(echo "$response" | jq '.links | length')
    echo -e "${GREEN}✅ PASSED - Found $count links${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED - List links${NC}"
    ((FAILED++))
fi
echo ""

# TEST 2b: Create Short Link with custom code & metadata
echo -e "${YELLOW}=== Test 2b: Create Short Link (custom code + metadata) ===${NC}"
CODE_ALIAS="qa${RANDOM}${RANDOM}"
CODE_ALIAS=${CODE_ALIAS:0:10}
response=$(curl -s -X POST "$BASE_URL" \
    -H "Content-Type: application/json" \
    -d "{\"webDestination\": \"https://kaayko.com/paddlingout?id=testalias\", \"title\": \"Alias Test\", \"createdBy\": \"tester\", \"code\": \"$CODE_ALIAS\", \"metadata\": {\"env\": \"test\"}}")

if echo "$response" | jq -e ".success == true and .link.code == \"$CODE_ALIAS\"" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PASSED - Created alias link: $CODE_ALIAS${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED - Create alias link${NC}"
    echo "Response: $response"
    ((FAILED++))
fi
echo ""

# TEST 4: Get Specific Link
if [ -n "$CREATED_CODE" ]; then
    echo -e "${YELLOW}=== Test 4: Get Link by Code ===${NC}"
    response=$(curl -s "$BASE_URL/$CREATED_CODE")
    if echo "$response" | jq -e '.success == true and .link.code' > /dev/null; then
        echo -e "${GREEN}✅ PASSED - Retrieved link $CREATED_CODE${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAILED - Get link${NC}"
        ((FAILED++))
    fi
    echo ""
fi

# TEST 5: Update Link
if [ -n "$CREATED_CODE" ]; then
    echo -e "${YELLOW}=== Test 5: Update Link ===${NC}"
    response=$(curl -s -X PUT "$BASE_URL/$CREATED_CODE" \
        -H "Content-Type: application/json" \
        -d '{"title": "Updated Test Lake"}')
    if echo "$response" | jq -e '.success == true' > /dev/null; then
        echo -e "${GREEN}✅ PASSED - Updated link${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAILED - Update link${NC}"
        ((FAILED++))
    fi
    echo ""
fi

# TEST 6: Test Redirect (check for Location header)
if [ -n "$CREATED_CODE" ]; then
    echo -e "${YELLOW}=== Test 6: Test Redirect ===${NC}"
    location=$(curl -sI "$BASE_URL/r/$CREATED_CODE" | grep -i "location:" | cut -d' ' -f2 | tr -d '\r')
    if [ -n "$location" ]; then
        echo -e "${GREEN}✅ PASSED - Redirects to: $location${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAILED - No redirect${NC}"
        ((FAILED++))
    fi
    echo ""
fi

# TEST 7: Stats
echo -e "${YELLOW}=== Test 7: Get Statistics ===${NC}"
response=$(curl -s "$BASE_URL/stats")
if echo "$response" | jq -e '.success == true' > /dev/null; then
    echo -e "${GREEN}✅ PASSED - Stats retrieved${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED - Stats${NC}"
    ((FAILED++))
fi
echo ""

# TEST 8: Delete Link
if [ -n "$CREATED_CODE" ]; then
    echo -e "${YELLOW}=== Test 8: Delete Link ===${NC}"
    response=$(curl -s -X DELETE "$BASE_URL/$CREATED_CODE")
    if echo "$response" | jq -e '.success == true' > /dev/null; then
        echo -e "${GREEN}✅ PASSED - Deleted link${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAILED - Delete link${NC}"
        ((FAILED++))
    fi
    echo ""
    
    # Verify deletion
    echo -e "${YELLOW}=== Test 8b: Verify Deletion ===${NC}"
    response=$(curl -s "$BASE_URL/$CREATED_CODE")
    if echo "$response" | jq -e '.success == false' > /dev/null; then
        echo -e "${GREEN}✅ PASSED - Link properly deleted${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAILED - Link still exists${NC}"
        ((FAILED++))
    fi
    echo ""
fi

# TEST 9: 404 for Non-existent Link
echo -e "${YELLOW}=== Test 9: 404 for Non-existent Link ===${NC}"
response=$(curl -s "$BASE_URL/lkNOPE")
if echo "$response" | jq -e '.success == false' > /dev/null; then
    echo -e "${GREEN}✅ PASSED - Returns error for non-existent link${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED - Should return error${NC}"
    ((FAILED++))
fi
echo ""

# Final Summary
echo "=========================================="
echo -e "${BLUE}TEST SUMMARY${NC}"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL TESTS PASSED! Smart Links v4 is working perfectly!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some tests failed. Check the output above.${NC}"
    exit 1
fi
