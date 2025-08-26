#!/bin/bash

# Kaayko ML Service Deployment Script
# This script deploys the trained ML model to Google Cloud Run

set -e

echo "🚀 Kaayko ML Service Deployment"
echo "==============================="

# Configuration
PROJECT_ID="kaaykostore"
SERVICE_NAME="kaayko-ml-service"
REGION="us-central1"
ML_TRAINING_PATH="/Users/Rohan/Desktop/Kaayko_ML_Training"
ML_SERVICE_PATH="/Users/Rohan/Desktop/Kaayko_v5/kaayko-api/ml-service"

echo "📋 Deployment Configuration:"
echo "   Project ID: $PROJECT_ID"
echo "   Service Name: $SERVICE_NAME"
echo "   Region: $REGION"
echo "   ML Training Path: $ML_TRAINING_PATH"
echo "   ML Service Path: $ML_SERVICE_PATH"
echo ""

# Step 1: Verify trained model exists
echo "🔍 Step 1: Verifying trained model..."
if [ ! -f "$ML_TRAINING_PATH/models/kaayko_randomforest_model.pkl" ]; then
    echo "❌ Error: Trained model not found at $ML_TRAINING_PATH/models/kaayko_randomforest_model.pkl"
    exit 1
fi

if [ ! -f "$ML_TRAINING_PATH/models/feature_names.pkl" ]; then
    echo "❌ Error: Feature names not found at $ML_TRAINING_PATH/models/feature_names.pkl"
    exit 1
fi

echo "✅ Trained model files found"

# Step 2: Copy model files to ML service directory
echo ""
echo "📦 Step 2: Copying model files to ML service..."

# Check if we already have a properly structured production model
if [ -f "$ML_SERVICE_PATH/kaayko_production_model.pkl" ]; then
    echo "ℹ️  Production model already exists, not overwriting"
    echo "   To rebuild, delete kaayko_production_model.pkl and run again"
else
    echo "⚠️  No production model found, copying raw RandomForest model"
    echo "   You may need to rebuild it with proper structure"
    cp "$ML_TRAINING_PATH/models/kaayko_randomforest_model.pkl" "$ML_SERVICE_PATH/kaayko_production_model.pkl"
fi

cp "$ML_TRAINING_PATH/models/feature_names.pkl" "$ML_SERVICE_PATH/"

# Copy additional files if they exist
if [ -f "$ML_TRAINING_PATH/models/additional_encoders.pkl" ]; then
    cp "$ML_TRAINING_PATH/models/additional_encoders.pkl" "$ML_SERVICE_PATH/"
    echo "✅ Copied additional encoders"
fi

if [ -f "$ML_TRAINING_PATH/models/lake_label_encoder.pkl" ]; then
    cp "$ML_TRAINING_PATH/models/lake_label_encoder.pkl" "$ML_SERVICE_PATH/"
    echo "✅ Copied lake label encoder"
fi

echo "✅ Model files copied successfully"

# Step 3: Build and deploy Docker container using Cloud Build
echo ""
echo "🐳 Step 3: Building Docker container using Cloud Build..."
cd "$ML_SERVICE_PATH"

# Build the container using Cloud Build (no local Docker required)
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME

echo "✅ Docker container built successfully"

# Step 4: Deploy to Cloud Run
echo ""
echo "🚀 Step 4: Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
    --platform managed \
    --region $REGION \
    --memory 2Gi \
    --cpu 2 \
    --timeout 300 \
    --max-instances 5 \
    --allow-unauthenticated

echo "✅ ML Service deployed successfully!"

# Step 5: Get service URL
echo ""
echo "🔗 Step 5: Getting service URL..."
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')
echo "Service URL: $SERVICE_URL"

# Step 6: Test the deployment
echo ""
echo "🧪 Step 6: Testing deployment..."
echo "Testing health endpoint..."
curl -s "$SERVICE_URL/health" | jq '.'

echo ""
echo "Testing model info endpoint..."
curl -s "$SERVICE_URL/model/info" | jq '.'

echo ""
echo "🎉 ML Service Deployment Complete!"
echo "Service URL: $SERVICE_URL"
echo "==============================="
