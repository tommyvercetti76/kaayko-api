# Kaayko Deployment Documentation

## Overview
This directory contains comprehensive deployment scripts for the Kaayko platform, including ML service, API functions, and frontend.

## Components
- **ML Service**: Google Cloud Run service hosting the trained RandomForest model
- **Firebase Functions**: API endpoints for paddle predictions with weather integration  
- **Frontend**: Static site hosted on Firebase Hosting

## Scripts

### Individual Deployment Scripts
- `deploy-ml-service.sh` - Deploys the ML model to Cloud Run
- `deploy-firebase-functions.sh` - Deploys API functions to Firebase
- `deploy-frontend.sh` - Deploys frontend to Firebase Hosting
- `rollback.sh` - Rollback utility for deployments

### Full Stack Deployment
- `deploy-full-stack.sh` - Orchestrates complete system deployment

## Prerequisites

### Required Tools
```bash
# Install Google Cloud CLI
curl https://sdk.cloud.google.com | bash
gcloud auth login
gcloud config set project kaaykostore

# Install Firebase CLI
npm install -g firebase-tools
firebase login

# Install jq for JSON processing
brew install jq  # macOS
```

### Required Permissions
- Google Cloud Project: `kaaykostore`
- Cloud Run Admin
- Cloud Build Editor
- Firebase Admin

## Deployment Process

### Option 1: Full Stack Deployment (Recommended)
```bash
cd /Users/Rohan/Desktop/Kaayko_v5/kaayko-api/deployment
chmod +x *.sh
./deploy-full-stack.sh
```

### Option 2: Individual Component Deployment
```bash
# Deploy ML service only
./deploy-ml-service.sh

# Deploy API functions only  
./deploy-firebase-functions.sh

# Deploy frontend only
./deploy-frontend.sh
```

## What Each Script Does

### deploy-ml-service.sh
1. ✅ Verifies trained model files exist
2. 📦 Copies model files to ML service directory
3. 🐳 Builds Docker container with Cloud Build
4. 🚀 Deploys to Cloud Run with optimized settings
5. 🧪 Tests deployment with health checks

### deploy-firebase-functions.sh
1. 🔍 Verifies environment configuration
2. 🔧 Sets up production environment variables
3. 📦 Verifies Node.js dependencies
4. 🚀 Deploys functions to Firebase
5. 🧪 Tests API endpoints

### deploy-frontend.sh
1. 🔍 Verifies frontend files exist
2. 🔧 Updates API configuration for production
3. 🚀 Deploys to Firebase Hosting
4. 🧪 Tests frontend accessibility

## Environment Configuration

### Required Environment Files
- `functions/.env.kaaykostore` - Production environment variables
  ```bash
  WEATHER_API_KEY=a0ede903980f45c4a27183708252308
  TEST_MODE=false
  ```

### Model Files Required
- `kaayko_randomforest_model.pkl` - Main trained model (99.28% accuracy)
- `feature_names.pkl` - Feature name mappings
- `additional_encoders.pkl` - Label encoders (if used)

## Production URLs

After successful deployment:
- **ML Service**: https://kaayko-ml-service-87383373015.us-central1.run.app
- **API Functions**: https://us-central1-kaaykostore.cloudfunctions.net/api
- **Frontend**: https://kaaykostore.web.app

## Testing Deployment

### Test ML Service
```bash
curl https://kaayko-ml-service-87383373015.us-central1.run.app/health
curl https://kaayko-ml-service-87383373015.us-central1.run.app/model/info
```

### Test API Functions
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut" | jq '.[0]'
```

### Test Frontend
```bash
curl -I https://kaaykostore.web.app
```

## Troubleshooting

### Common Issues
1. **Model files not found**: Ensure ML training completed and models exist
2. **gcloud auth issues**: Run `gcloud auth login` and set correct project
3. **Firebase permission errors**: Ensure you have admin access to project
4. **Build failures**: Check Docker syntax in ML service
5. **Function timeouts**: Increase timeout in firebase.json if needed

### Logs and Monitoring
```bash
# Cloud Run logs
gcloud logs tail --service kaayko-ml-service

# Firebase Function logs  
firebase functions:log --project kaaykostore

# Cloud Build logs
gcloud builds log --project kaaykostore
```

## Rollback Procedure

If deployment issues occur:
```bash
./rollback.sh
```

This script provides options to rollback individual components.

## Security Notes

- Environment variables are automatically secured
- Cloud Run service is configured for production
- API keys are not exposed in logs
- Rate limiting is enforced at function level

## Future Enhancements

This deployment system is designed to be:
- ✅ **Universal**: Works for future model updates
- ✅ **Modular**: Individual components can be deployed separately  
- ✅ **Tested**: Each deployment includes verification
- ✅ **Rollback-ready**: Easy to revert if issues occur
- ✅ **Monitored**: Includes logging and health checks

## Support

For deployment issues, check:
1. Script outputs for specific error messages
2. Google Cloud Console for service status
3. Firebase Console for function logs
4. This documentation for troubleshooting steps
