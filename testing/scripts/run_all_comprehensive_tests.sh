#!/bin/bash
# Master Test Runner for Kaayko API Test Suite
# 
# This script orchestrates all test suites and generates a comprehensive report
# 
# Usage: ./run_all_comprehensive_tests.sh [--quick] [--full] [--report-only]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-https://api-vwcc5j4qda-uc.a.run.app}"
QUICK_MODE=false
FULL_MODE=false
REPORT_ONLY=false
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${TEST_DIR}/results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Parse command line arguments
for arg in "$@"; do
    case $arg in
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --full)
            FULL_MODE=true
            shift
            ;;
        --report-only)
            REPORT_ONLY=true
            shift
            ;;
        --baseUrl=*)
            BASE_URL="${arg#*=}"
            shift
            ;;
        *)
            echo "Unknown argument: $arg"
            echo "Usage: $0 [--quick] [--full] [--report-only] [--baseUrl=URL]"
            exit 1
            ;;
    esac
done

# Print header
echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🧪 KAAYKO API COMPREHENSIVE TEST SUITE${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}🎯 Target:${NC} $BASE_URL"
echo -e "${CYAN}📅 Timestamp:${NC} $TIMESTAMP"
echo -e "${CYAN}🏃 Mode:${NC} $([ "$QUICK_MODE" = true ] && echo "QUICK" || ([ "$FULL_MODE" = true ] && echo "FULL" || echo "STANDARD"))"
echo -e "${CYAN}📁 Results Directory:${NC} $RESULTS_DIR"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Test execution tracking
declare -a TEST_RESULTS
declare -A TEST_STATUS
declare -A TEST_DURATION
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
START_TIME=$(date +%s)

# Function to run a test suite
run_test_suite() {
    local test_name="$1"
    local test_script="$2"
    local test_args="$3"
    local is_optional="$4"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    echo -e "${PURPLE}📋 Running: ${test_name}${NC}"
    echo -e "${CYAN}   Script: ${test_script}${NC}"
    echo -e "${CYAN}   Args: ${test_args}${NC}"
    echo ""
    
    local start_time=$(date +%s)
    local result_file="${RESULTS_DIR}/${test_name// /_}_${TIMESTAMP}.log"
    
    if [ "$REPORT_ONLY" = true ]; then
        echo -e "${YELLOW}⏭️  Skipping execution (report-only mode)${NC}"
        TEST_STATUS["$test_name"]="SKIPPED"
        TEST_DURATION["$test_name"]=0
        return 0
    fi
    
    # Run the test and capture output
    if timeout 600 node "$TEST_DIR/$test_script" $test_args --baseUrl="$BASE_URL" > "$result_file" 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        echo -e "${GREEN}✅ ${test_name} PASSED${NC} (${duration}s)"
        TEST_STATUS["$test_name"]="PASSED"
        TEST_DURATION["$test_name"]=$duration
        PASSED_TESTS=$((PASSED_TESTS + 1))
        
        # Extract key metrics if available
        if grep -q "pass rate\|success rate\|score" "$result_file" 2>/dev/null; then
            local metrics=$(grep -i "pass rate\|success rate\|score" "$result_file" | tail -3)
            echo -e "${CYAN}   Metrics: ${metrics}${NC}"
        fi
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        local exit_code=$?
        
        if [ "$is_optional" = true ]; then
            echo -e "${YELLOW}⚠️  ${test_name} FAILED (optional)${NC} (${duration}s, exit code: $exit_code)"
            TEST_STATUS["$test_name"]="FAILED_OPTIONAL"
        else
            echo -e "${RED}❌ ${test_name} FAILED${NC} (${duration}s, exit code: $exit_code)"
            TEST_STATUS["$test_name"]="FAILED"
            FAILED_TESTS=$((FAILED_TESTS + 1))
        fi
        
        TEST_DURATION["$test_name"]=$duration
        
        # Show last few lines of error output
        echo -e "${RED}   Last error output:${NC}"
        tail -5 "$result_file" | sed 's/^/   /'
    fi
    
    echo ""
}

# Function to check if API is available
check_api_availability() {
    echo -e "${CYAN}🔍 Checking API availability...${NC}"
    
    if curl -s --max-time 10 "$BASE_URL/helloWorld" > /dev/null; then
        echo -e "${GREEN}✅ API is accessible${NC}"
        return 0
    else
        echo -e "${RED}❌ API is not accessible at $BASE_URL${NC}"
        echo -e "${YELLOW}Please check your BASE_URL and network connection${NC}"
        return 1
    fi
}

# Function to estimate test duration
estimate_duration() {
    local total_est=0
    
    if [ "$QUICK_MODE" = true ]; then
        total_est=300  # 5 minutes for quick mode
    elif [ "$FULL_MODE" = true ]; then
        total_est=1800  # 30 minutes for full mode
    else
        total_est=900   # 15 minutes for standard mode
    fi
    
    echo -e "${CYAN}⏱️  Estimated duration: $((total_est / 60)) minutes${NC}"
}

# Main execution
main() {
    # Check API availability first
    if ! check_api_availability; then
        exit 1
    fi
    
    estimate_duration
    echo ""
    
    # Core functionality tests (always run)
    echo -e "${BLUE}🔹 CORE FUNCTIONALITY TESTS${NC}"
    run_test_suite "Comprehensive API Tests" "comprehensive_api_tests.js" "--verbose"
    run_test_suite "Integration Tests" "integration_tests.js" "--detailed"
    
    # Performance tests
    if [ "$QUICK_MODE" != true ]; then
        echo -e "${BLUE}🔹 PERFORMANCE TESTS${NC}"
        
        if [ "$FULL_MODE" = true ]; then
            run_test_suite "Performance Tests (Full)" "performance_tests.js" "--users=50 --duration=120000 --profile"
        else
            run_test_suite "Performance Tests" "performance_tests.js" "--users=20 --duration=60000"
        fi
    fi
    
    # Security tests (optional in quick mode, required in full mode)
    if [ "$QUICK_MODE" != true ] || [ "$FULL_MODE" = true ]; then
        echo -e "${BLUE}🔹 SECURITY TESTS${NC}"
        
        if [ "$FULL_MODE" = true ]; then
            run_test_suite "Security Tests (Aggressive)" "security_tests.js" "--aggressive --report" true
        else
            run_test_suite "Security Tests" "security_tests.js" "--report" true
        fi
    fi
    
    # Edge case and stress tests (full mode only)
    if [ "$FULL_MODE" = true ]; then
        echo -e "${BLUE}🔹 EDGE CASE & STRESS TESTS${NC}"
        run_test_suite "Edge Case Tests" "edge_case_tests.js" "--concurrent=30 --duration=60000 --memory" true
    fi
    
    # Generate comprehensive report
    generate_comprehensive_report
}

# Function to generate comprehensive report
generate_comprehensive_report() {
    local end_time=$(date +%s)
    local total_duration=$((end_time - START_TIME))
    local report_file="${RESULTS_DIR}/comprehensive_test_report_${TIMESTAMP}.md"
    local summary_file="${RESULTS_DIR}/test_summary_${TIMESTAMP}.json"
    
    echo -e "${BLUE}📊 Generating comprehensive report...${NC}"
    
    # Create markdown report
    cat > "$report_file" << EOF
# 🧪 Kaayko API Comprehensive Test Report

**Generated:** $(date)  
**Target:** $BASE_URL  
**Mode:** $([ "$QUICK_MODE" = true ] && echo "QUICK" || ([ "$FULL_MODE" = true ] && echo "FULL" || echo "STANDARD"))  
**Duration:** ${total_duration}s ($(($total_duration / 60))m $(($total_duration % 60))s)

## 📊 Executive Summary

- **Total Test Suites:** $TOTAL_TESTS
- **Passed:** $PASSED_TESTS
- **Failed:** $FAILED_TESTS
- **Success Rate:** $(echo "scale=1; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc -l)%

## 📋 Test Suite Results

EOF

    # Add individual test results
    for test_name in "${!TEST_STATUS[@]}"; do
        local status="${TEST_STATUS[$test_name]}"
        local duration="${TEST_DURATION[$test_name]}"
        local icon="❓"
        
        case "$status" in
            "PASSED") icon="✅" ;;
            "FAILED") icon="❌" ;;
            "FAILED_OPTIONAL") icon="⚠️" ;;
            "SKIPPED") icon="⏭️" ;;
        esac
        
        echo "### $icon $test_name" >> "$report_file"
        echo "- **Status:** $status" >> "$report_file"
        echo "- **Duration:** ${duration}s" >> "$report_file"
        echo "" >> "$report_file"
        
        # Add log file content if available
        local log_file="${RESULTS_DIR}/${test_name// /_}_${TIMESTAMP}.log"
        if [ -f "$log_file" ]; then
            echo "**Key Output:**" >> "$report_file"
            echo "\`\`\`" >> "$report_file"
            tail -20 "$log_file" >> "$report_file"
            echo "\`\`\`" >> "$report_file"
            echo "" >> "$report_file"
        fi
    done
    
    # Add recommendations
    cat >> "$report_file" << EOF
## 💡 Recommendations

EOF
    
    if [ $FAILED_TESTS -gt 0 ]; then
        echo "### 🚨 Critical Issues" >> "$report_file"
        echo "- $FAILED_TESTS test suite(s) failed and require immediate attention" >> "$report_file"
        echo "- Review individual test logs for specific failure details" >> "$report_file"
        echo "" >> "$report_file"
    fi
    
    if [ "$QUICK_MODE" = true ]; then
        cat >> "$report_file" << EOF
### 🏃 Quick Mode Limitations
- Performance tests were skipped
- Security tests were minimal
- Edge case testing was not performed
- Consider running \`--full\` mode for production readiness

EOF
    fi
    
    cat >> "$report_file" << EOF
### 📈 Next Steps
1. Address any failed test suites
2. Review security recommendations if security tests were run
3. Monitor performance metrics in production
4. Set up regular automated testing
5. Consider implementing additional monitoring

## 📁 Files Generated
- Test logs: \`${RESULTS_DIR}/*_${TIMESTAMP}.log\`
- JSON reports: Individual test suites generate detailed JSON reports
- Summary: \`${summary_file}\`

EOF
    
    # Create JSON summary
    cat > "$summary_file" << EOF
{
  "timestamp": "$TIMESTAMP",
  "target": "$BASE_URL",
  "mode": "$([ "$QUICK_MODE" = true ] && echo "QUICK" || ([ "$FULL_MODE" = true ] && echo "FULL" || echo "STANDARD"))",
  "duration": $total_duration,
  "summary": {
    "totalSuites": $TOTAL_TESTS,
    "passed": $PASSED_TESTS,
    "failed": $FAILED_TESTS,
    "successRate": $(echo "scale=2; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc -l)
  },
  "testResults": {
EOF
    
    local first=true
    for test_name in "${!TEST_STATUS[@]}"; do
        if [ "$first" = false ]; then
            echo "," >> "$summary_file"
        fi
        first=false
        
        cat >> "$summary_file" << EOF
    "$(echo "$test_name" | sed 's/ /_/g')": {
      "status": "${TEST_STATUS[$test_name]}",
      "duration": ${TEST_DURATION[$test_name]}
    }EOF
    done
    
    cat >> "$summary_file" << EOF

  }
}
EOF
    
    echo -e "${GREEN}📄 Report saved to: $report_file${NC}"
    echo -e "${GREEN}📄 Summary saved to: $summary_file${NC}"
}

# Function to print final summary
print_final_summary() {
    local end_time=$(date +%s)
    local total_duration=$((end_time - START_TIME))
    
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}📊 FINAL TEST SUMMARY${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}🎯 Target:${NC} $BASE_URL"
    echo -e "${CYAN}⏱️  Total Duration:${NC} ${total_duration}s ($(($total_duration / 60))m $(($total_duration % 60))s)"
    echo -e "${CYAN}📊 Test Suites:${NC} $TOTAL_TESTS total"
    echo -e "${GREEN}✅ Passed:${NC} $PASSED_TESTS"
    echo -e "${RED}❌ Failed:${NC} $FAILED_TESTS"
    
    local success_rate=$(echo "scale=1; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc -l)
    echo -e "${CYAN}📈 Success Rate:${NC} ${success_rate}%"
    
    if [ "$FAILED_TESTS" -eq 0 ]; then
        echo -e "${GREEN}🎉 ALL TESTS PASSED! API is working correctly.${NC}"
    elif [ "$FAILED_TESTS" -le 1 ]; then
        echo -e "${YELLOW}⚠️  Minor issues detected. Review failed tests.${NC}"
    else
        echo -e "${RED}🚨 Multiple test failures detected. Immediate attention required.${NC}"
    fi
    
    echo -e "${CYAN}📁 Results Directory:${NC} $RESULTS_DIR"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
}

# Trap to ensure final summary is always printed
trap print_final_summary EXIT

# Run main function
main

# Exit with appropriate code
if [ "$FAILED_TESTS" -eq 0 ]; then
    exit 0
else
    exit 1
fi
