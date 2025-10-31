#!/bin/bash

echo "🔒 SECURITY CLEANUP SCRIPT"
echo "=========================="

# Check if BFG Repo-Cleaner is available (safer than filter-branch)
if command -v bfg &> /dev/null; then
    echo "🧹 Using BFG Repo-Cleaner (recommended)..."
    bfg --delete-files '.env.kaaykostore' --no-blob-protection .
    git reflog expire --expire=now --all && git gc --prune=now --aggressive
else
    echo "⚠️  BFG Repo-Cleaner not found. Using git filter-branch..."
    echo "   For better results, install BFG: brew install bfg"
    
    # Use filter-branch as fallback
    FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --index-filter \
        'git rm --cached --ignore-unmatch functions/.env.kaaykostore' \
        --prune-empty --tag-name-filter cat -- --all
        
    # Clean up
    git reflog expire --expire=now --all
    git gc --prune=now --aggressive
fi

echo "✅ Repository cleaned!"
echo ""
echo "🚨 IMPORTANT NEXT STEPS:"
echo "1. Force push to remote: git push --force-with-lease origin main"
echo "2. Regenerate API key at: https://www.weatherapi.com/"
echo "3. Set new key in Firebase Functions config"
echo "4. Notify team members to re-clone repository"
