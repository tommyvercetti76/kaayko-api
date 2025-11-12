#!/bin/bash

# Kaayko API - Start Local Development Environment
# Starts Firebase emulators with Auth, Firestore, and Functions

set -e

echo "🚀 Starting Kaayko API Local Development Environment"
echo ""

# Check if we're in the right directory
if [ ! -f "firebase.json" ]; then
    echo "❌ Error: firebase.json not found!"
    echo "   Please run this script from: /Users/Rohan/Desktop/kaayko-monorepo/api"
    exit 1
fi

# Check if functions directory exists
if [ ! -d "functions" ]; then
    echo "❌ Error: functions directory not found!"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "functions/node_modules" ]; then
    echo "📦 Installing dependencies..."
    cd functions
    npm install
    cd ..
fi

echo "🔧 Starting Firebase Emulators..."
echo ""
echo "Emulators:"
echo "  - Functions:  http://127.0.0.1:5001"
echo "  - Firestore:  http://127.0.0.1:8080"
echo "  - Auth:       http://127.0.0.1:9099"
echo "  - UI:         http://127.0.0.1:4000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start emulators
firebase emulators:start --only functions,firestore,auth
