#!/bin/bash
# Kaayko Test Suite Runner
# Runs all essential tests in the correct order

echo "🧪 Kaayko Test Suite"
echo "===================="

BASE_URL=${1:-"https://api-vwcc5j4qda-uc.a.run.app"}
echo "🎯 Target: $BASE_URL"
echo ""

# Run Integration Tests (most important)
echo "🔄 Running Integration Tests..."
node integration_tests.js --detailed --baseUrl="$BASE_URL"
INTEGRATION_EXIT=$?

echo ""

# Run Security Tests
echo "🔒 Running Security Tests..."
node security_tests.js --aggressive --baseUrl="$BASE_URL"
SECURITY_EXIT=$?

echo ""

# Run Performance Tests (less critical, can be flaky)
echo "⚡ Running Performance Tests..."
node performance_tests.js --profiling --baseUrl="$BASE_URL" --maxConcurrent=3
PERFORMANCE_EXIT=$?

echo ""

# Run Quick Forecast Analysis (NEW - Fast version)
echo "🗺️ Running Quick Forecast Analysis..."
node forecast_heatmap_optimizer.js --fast
FORECAST_EXIT=$?

echo ""
echo "===================="
echo "📊 Test Suite Summary"
echo "===================="

if [ $INTEGRATION_EXIT -eq 0 ]; then
    echo "✅ Integration Tests: PASSED"
else
    echo "❌ Integration Tests: FAILED"
fi

if [ $SECURITY_EXIT -eq 0 ]; then
    echo "✅ Security Tests: PASSED"
else
    echo "❌ Security Tests: FAILED"
fi

if [ $PERFORMANCE_EXIT -eq 0 ]; then
    echo "✅ Performance Tests: PASSED"
else
    echo "⚠️ Performance Tests: FAILED (may be due to rate limiting)"
fi

if [ $FORECAST_EXIT -eq 0 ]; then
    echo "✅ Forecast Analysis: PASSED"
else
    echo "⚠️ Forecast Analysis: FAILED"
fi

# Exit with failure if critical tests failed
if [ $INTEGRATION_EXIT -ne 0 ] || [ $SECURITY_EXIT -ne 0 ]; then
    echo ""
    echo "❌ Critical tests failed!"
    exit 1
else
    echo ""
    echo "✅ All critical tests passed!"
    exit 0
fi
