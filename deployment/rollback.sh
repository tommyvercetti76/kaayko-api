#!/bin/bash

# Kaayko Rollback Script
# This script rolls back deployments in case of issues

set -e

echo "🔄 KAAYKO ROLLBACK SCRIPT"
echo "========================="
echo "This script helps rollback deployments if issues occur"
echo ""

PROJECT_ID="kaaykostore"
SERVICE_NAME="kaayko-ml-service"
REGION="us-central1"

# Menu for rollback options
echo "Select what to rollback:"
echo "1. 🤖 ML Service (Cloud Run)"
echo "2. 🔥 Firebase Functions"
echo "3. 🌐 Frontend (Hosting)"
echo "4. 🔄 Full System"
echo "5. ❌ Cancel"
echo ""

read -p "Enter choice (1-5): " choice

case $choice in
    1)
        echo "Rolling back ML Service..."
        gcloud run services list --platform managed --region $REGION
        echo ""
        read -p "Enter revision to rollback to: " revision
        gcloud run services update-traffic $SERVICE_NAME --to-revisions=$revision=100 --region=$REGION
        echo "✅ ML Service rolled back"
        ;;
    2)
        echo "Rolling back Firebase Functions..."
        firebase functions:log --project $PROJECT_ID
        echo ""
        echo "⚠️  Firebase Functions don't support automatic rollback"
        echo "You need to redeploy a previous version manually"
        ;;
    3)
        echo "Rolling back Frontend..."
        firebase hosting:releases --project $PROJECT_ID
        echo ""
        read -p "Enter release ID to rollback to: " release_id
        firebase hosting:clone $release_id --project $PROJECT_ID
        echo "✅ Frontend rolled back"
        ;;
    4)
        echo "This would rollback the entire system"
        echo "⚠️  Please rollback components individually for safety"
        ;;
    5)
        echo "❌ Rollback cancelled"
        exit 0
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "🔄 Rollback completed!"
