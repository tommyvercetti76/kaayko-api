#!/bin/bash

# KAAYKO COMPREHENSIVE TEST RUNNER
# This script runs all tests in the correct order with proper setup

set -e  # Exit on any error

echo "🚀 KAAYKO COMPREHENSIVE TEST SUITE"
echo "=================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to check if a service is running
check_service() {
    local service_name=$1
    local url=$2
    local max_attempts=10
    local attempt=1

    print_status $YELLOW "Checking if $service_name is running..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            print_status $GREEN "✅ $service_name is running"
            return 0
        fi
        
        print_status $YELLOW "⏳ Waiting for $service_name (attempt $attempt/$max_attempts)..."
        sleep 2
        ((attempt++))
    done
    
    print_status $RED "❌ $service_name is not responding after $max_attempts attempts"
    return 1
}

# Function to run a test and capture results
run_test() {
    local test_name=$1
    local test_command=$2
    
    print_status $BLUE "\n🧪 Running: $test_name"
    echo "Command: $test_command"
    
    if eval "$test_command"; then
        print_status $GREEN "✅ PASSED: $test_name"
        return 0
    else
        print_status $RED "❌ FAILED: $test_name"
        return 1
    fi
}

# Initialize counters
total_tests=0
passed_tests=0
failed_tests=0

# Start time tracking
start_time=$(date +%s)

print_status $BLUE "\n📋 PRE-FLIGHT CHECKS"
echo "===================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_status $RED "❌ Node.js is not installed"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    print_status $RED "❌ Python 3 is not installed"
    exit 1
fi

# Check if required directories exist
if [ ! -d "firebase-functions" ]; then
    print_status $RED "❌ firebase-functions directory not found"
    exit 1
fi

if [ ! -d "ml-service" ]; then
    print_status $RED "❌ ml-service directory not found"
    exit 1
fi

print_status $GREEN "✅ All prerequisites checked"

print_status $BLUE "\n🔧 DEPENDENCY SETUP"
echo "==================="

# Install Node.js dependencies
if [ -f "firebase-functions/package.json" ]; then
    print_status $YELLOW "Installing Firebase Functions dependencies..."
    cd firebase-functions
    npm install --silent
    cd ..
    print_status $GREEN "✅ Firebase Functions dependencies installed"
fi

# Install Python dependencies
if [ -f "ml-service/requirements.txt" ]; then
    print_status $YELLOW "Installing ML Service dependencies..."
    cd ml-service
    python3 -m pip install -r requirements.txt --quiet
    cd ..
    print_status $GREEN "✅ ML Service dependencies installed"
fi

print_status $BLUE "\n🚀 STARTING SERVICES"
echo "===================="

# Start ML Service in background
print_status $YELLOW "Starting ML Service..."
cd ml-service
python3 main.py &
ML_PID=$!
cd ..

# Wait for ML service to start
sleep 3
if ! check_service "ML Service" "http://127.0.0.1:8080/health"; then
    kill $ML_PID 2>/dev/null || true
    print_status $RED "Failed to start ML Service"
    exit 1
fi

# Start Firebase Emulator in background
print_status $YELLOW "Starting Firebase Emulator..."
cd firebase-functions
npm run serve &
FIREBASE_PID=$!
cd ..

# Wait for Firebase emulator to start
sleep 10
if ! check_service "Firebase Functions" "http://127.0.0.1:5001/kaayko-92a4a/us-central1/api/helloWorld"; then
    kill $FIREBASE_PID 2>/dev/null || true
    kill $ML_PID 2>/dev/null || true
    print_status $RED "Failed to start Firebase Emulator"
    exit 1
fi

print_status $GREEN "✅ All services are running"

print_status $BLUE "\n🧪 RUNNING TESTS"
echo "================"

# Test 1: Enhanced Test Suite
((total_tests++))
if run_test "Enhanced Test Suite" "node enhanced_test_suite.js"; then
    ((passed_tests++))
else
    ((failed_tests++))
fi

# Test 2: Production Test Suite
((total_tests++))
if run_test "Production Test Suite" "node production_test_suite.js"; then
    ((passed_tests++))
else
    ((failed_tests++))
fi

# Test 3: Interactive Test Suite (Manual)
echo "ℹ️  Interactive test suite available: node interactive_test_suite.js"

# Test 4: API Health Checks
((total_tests++))
if run_test "API Health Checks" "curl -s http://127.0.0.1:5001/kaayko-92a4a/us-central1/api/helloWorld | grep -q 'OK'"; then
    ((passed_tests++))
else
    ((failed_tests++))
fi

# Test 5: ML Service Health
((total_tests++))
if run_test "ML Service Health" "curl -s http://127.0.0.1:8080/health | grep -q 'healthy'"; then
    ((passed_tests++))
else
    ((failed_tests++))
fi

print_status $BLUE "\n🧹 CLEANUP"
echo "=========="

# Stop services
print_status $YELLOW "Stopping services..."
kill $FIREBASE_PID 2>/dev/null || true
kill $ML_PID 2>/dev/null || true
sleep 2

# Force kill if still running
kill -9 $FIREBASE_PID 2>/dev/null || true
kill -9 $ML_PID 2>/dev/null || true

print_status $GREEN "✅ Services stopped"

# Calculate execution time
end_time=$(date +%s)
execution_time=$((end_time - start_time))

print_status $BLUE "\n📊 TEST RESULTS SUMMARY"
echo "======================="
echo "Total Tests: $total_tests"
echo "Passed: $passed_tests"
echo "Failed: $failed_tests"
echo "Execution Time: ${execution_time}s"

# Calculate success rate
if [ $total_tests -gt 0 ]; then
    success_rate=$((passed_tests * 100 / total_tests))
    echo "Success Rate: ${success_rate}%"
    
    if [ $success_rate -ge 90 ]; then
        print_status $GREEN "🎉 EXCELLENT! System is ready for production"
        exit 0
    elif [ $success_rate -ge 70 ]; then
        print_status $YELLOW "⚠️  GOOD but address failed tests before production"
        exit 1
    else
        print_status $RED "🚨 CRITICAL ISSUES - System needs fixing before deployment"
        exit 1
    fi
else
    print_status $RED "❌ No tests were executed"
    exit 1
fi
