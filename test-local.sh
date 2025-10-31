#!/bin/bash

# Kaayko Smart Links - Local Testing Guide
# This script helps you test the complete smart links system locally

set -e

echo "🔗 Kaayko Smart Links - Local Testing"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}Step 1: Start Firebase Functions Emulator${NC}"
echo "This runs your API locally on port 5001"
echo ""
echo "  cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions"
echo "  npm run serve"
echo ""
echo "Press ENTER when emulator is running..."
read

echo ""
echo -e "${BLUE}Step 2: Start Frontend Server (in new terminal)${NC}"
echo "This serves your web UI on port 8080"
echo ""
echo "  cd /Users/Rohan/Desktop/kaayko-monorepo/frontend"
echo "  python3 -m http.server 8080"
echo ""
echo "Press ENTER when server is running..."
read

echo ""
echo -e "${GREEN}✅ Both servers running!${NC}"
echo ""
echo "======================================"
echo "🎯 Now you can test:"
echo "======================================"
echo ""

echo -e "${YELLOW}1. Open Web UI:${NC}"
echo "   http://localhost:8080/src/create-smart-link.html"
echo ""

echo -e "${YELLOW}2. Create a lake link:${NC}"
echo "   - Select: Paddling Location"
echo "   - Enter ID: trinity"
echo "   - Check: Auto-fetch metadata"
echo "   - Click: Create Smart Link"
echo ""

echo -e "${YELLOW}3. Test API directly:${NC}"
echo "   curl -X POST http://localhost:5001/kaaykostore/us-central1/api/smartlinks \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"space\": \"lake\", \"linkId\": \"trinity\", \"autoEnrich\": true}'"
echo ""

echo -e "${YELLOW}4. View in browser:${NC}"
echo "   Open: http://localhost:8080/src/create-smart-link.html"
echo ""

echo "======================================"
echo "📊 Test Different Content Types:"
echo "======================================"
echo ""
echo "Lake:     {\"space\": \"lake\", \"linkId\": \"trinity\", \"autoEnrich\": true}"
echo "Product:  {\"space\": \"product\", \"linkId\": \"funny-tshirt-001\", \"autoEnrich\": true}"
echo "Category: {\"space\": \"category\", \"linkId\": \"sarcastic\", \"autoEnrich\": true}"
echo "Store:    {\"space\": \"store\", \"linkId\": \"home\", \"autoEnrich\": true}"
echo ""

echo "Press CTRL+C to exit this guide"
read
