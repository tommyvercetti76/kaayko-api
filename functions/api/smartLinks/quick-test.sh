#!/bin/bash
# Quick Smart Links v4 Test - One Command Testing
# Usage: ./quick-test.sh [local|prod]

MODE=${1:-local}

if [ "$MODE" == "local" ]; then
    BASE="http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks"
    echo "🔧 Testing LOCAL emulator"
else
    BASE="https://us-central1-kaaykostore.cloudfunctions.net/api/smartlinks"
    echo "☁️  Testing PRODUCTION"
fi

echo ""
echo "1️⃣  Health Check..."
curl -s "$BASE/health" | jq .

echo ""
echo "2️⃣  Create Link..."
RESPONSE=$(curl -s -X POST "$BASE" \
    -H "Content-Type: application/json" \
    -d '{"webDestination":"https://kaayko.com/test","title":"Quick Test"}')
echo "$RESPONSE" | jq .
CODE=$(echo "$RESPONSE" | jq -r '.link.code // empty')

if [ -n "$CODE" ]; then
    echo ""
    echo "3️⃣  Get Link..."
    curl -s "$BASE/$CODE" | jq .
    
    echo ""
    echo "4️⃣  Test Redirect..."
    curl -sI "$BASE/r/$CODE" | grep -i location
    
    echo ""
    echo "5️⃣  Delete Link..."
    curl -s -X DELETE "$BASE/$CODE" | jq .
fi

echo ""
echo "✅ Quick test complete!"
