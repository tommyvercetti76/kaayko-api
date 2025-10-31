# 🚀 Kaayko Deployment Documentation

**Production deployment scripts for the Kaayko monorepo**

---

## 📦 What's Here

This directory contains **PRODUCTION-ONLY** deployment scripts. For local development, see [`../../local-dev/`](../../local-dev/).

### Scripts

| Script | Purpose | Use Case |
|--------|---------|----------|
| **`config.sh`** | Shared configuration | Sourced by all deployment scripts |
| **`deploy-full-stack.sh`** | Deploy everything | Complete production deployment |
| **`deploy-ml-service.sh`** | ML service only | Update Cloud Run ML service |
| **`deploy-firebase-functions.sh`** | API functions only | Update Firebase Functions |
| **`deploy-frontend.sh`** | Frontend only | Update Firebase Hosting |
| **`pre-deployment-check.sh`** | Pre-flight checks | Validate before deployment |
| **`rollback.sh`** | Emergency rollback | Revert failed deployments |

---

## 🎯 Quick Start

### Full Stack Deployment (Recommended)
```bash
cd api/deployment
./deploy-full-stack.sh
```

### Individual Component Deployment
```bash
# Deploy ML service only
./deploy-ml-service.sh

# Deploy API functions only  
./deploy-firebase-functions.sh

# Deploy frontend only
./deploy-frontend.sh
```

---

## ⚙️ Configuration

All configuration is centralized in **`config.sh`**:

- ✅ **Auto-detects monorepo root** (no hardcoded paths!)
- ✅ **Portable** - works on any machine
- ✅ **Single source of truth** - edit once, applies everywhere

### Key Configuration Variables:
```bash
PROJECT_ID="kaaykostore"
REGION="us-central1"
MONOREPO_ROOT="<auto-detected>"
```

---

## 📊 Components

### Required Tools
```bash
# Install Google Cloud CLI
curl https://sdk.cloud.google.com | bash
gcloud auth login
gcloud config set project kaaykostore

# Install Firebase CLI
npm install -g firebase-tools
firebase login

# Install jq for JSON processing (optional, for formatted output)
brew install jq  # macOS
apt-get install jq  # Linux
```

### Required Permissions
- **Google Cloud Project:** `kaaykostore`
- **Roles:** Cloud Run Admin, Cloud Build Editor, Firebase Admin
- **APIs Enabled:** Cloud Run, Cloud Build, Firebase

### Required Files
- ✅ `api/functions/.env.kaaykostore` - Production environment variables
- ✅ `api/ml-service/kaayko_production_model_compat.pkl` - Trained ML model (83MB)
- ✅ `frontend/src/` - Frontend source files

## 🏗️ Architecture

### Deployment Flow:
```
deploy-full-stack.sh
├── 1. deploy-ml-service.sh
│   ├── Validate model files
│   ├── Build Docker container (Cloud Build)
│   ├── Deploy to Cloud Run
│   └── Test ML endpoints
│
├── 2. deploy-firebase-functions.sh
│   ├── Validate environment config
│   ├── Deploy Firebase Functions
│   └── Test API endpoints
│
└── 3. deploy-frontend.sh
    ├── Validate frontend files
    ├── Deploy to Firebase Hosting
    └── Test frontend accessibility
```

---

## 📋 Pre-Deployment Checklist

Run this before deploying:
```bash
./pre-deployment-check.sh
```

**Checks:**
- ✅ Model files exist
- ✅ Environment variables configured
- ✅ gcloud authenticated
- ✅ Firebase authenticated
- ✅ APIs enabled (Cloud Run, Cloud Build, Firebase)

---

## 🆚 Local vs Production

| Environment | Scripts Location | Purpose |
|-------------|-----------------|---------|
| **Local** | `local-dev/scripts/` | Development & testing |
| **Production** | `api/deployment/` | Production deployment |

### Local Development:
```bash
cd local-dev/scripts
./start-local.sh    # Start local backend + frontend
./test-local.sh     # Test all APIs locally
./stop-local.sh     # Stop everything
```

### Production Deployment:
```bash
cd api/deployment
./deploy-full-stack.sh    # Deploy to production
```

---

## 🔑 Prerequisites

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

## 🔐 Environment Variables

### Production Environment File
**Location:** `api/functions/.env.kaaykostore`

```bash
WEATHER_API_KEY=<your_weatherapi_key_here>
OPENAI_API_KEY=<your_openai_key_here>
TEST_MODE=false
NODE_ENV=production
```

**Security:** This file is git-ignored and should NEVER be committed!

---
## 🌐 Production URLs

After successful deployment, your services will be available at:

| Service | URL | Purpose |
|---------|-----|---------|
| **ML Service** | https://kaayko-ml-service-87383373015.us-central1.run.app | ML inference API |
| **API Functions** | https://us-central1-kaaykostore.cloudfunctions.net/api | Main API (33 endpoints) |
| **Frontend** | https://kaaykostore.web.app | Web application |

### API Documentation:
- **Swagger UI:** https://us-central1-kaaykostore.cloudfunctions.net/api/docs
- **OpenAPI Spec:** See `docs/kaayko-paddling-api-swagger.yaml`
- **Accuracy:** 99.98% R² on 13.6M samples
- **Training Data:** 2,779 lakes across North America

**Note:** Model must be trained first using `ml/` pipeline before deployment

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

## 🎯 Design Principles

This deployment system is:
- ✅ **Portable** - No hardcoded paths, works on any machine
- ✅ **Modular** - Deploy components independently
- ✅ **Validated** - Pre-flight checks before deployment
- ✅ **Tested** - Each deployment includes health checks
- ✅ **Rollback-ready** - Easy emergency rollback
- ✅ **Monitored** - Comprehensive logging

---

## 🔗 Related Documentation

- **API Documentation:** [`../functions/api/README.md`](../functions/api/README.md)
- **Local Development:** [`../../local-dev/README.md`](../../local-dev/README.md)
- **Technical Docs:** [`../docs/`](../docs/)
- **ML Training:** [`../../ml/README.md`](../../ml/README.md)

---

## 📞 Support

For deployment issues:
1. Check script output for specific errors
2. Review logs: `gcloud logs tail --service kaayko-ml-service`
3. Firebase logs: `firebase functions:log`
4. Run pre-deployment check: `./pre-deployment-check.sh`
5. See troubleshooting section above

---

**Last Updated:** October 31, 2025  
**Status:** ✅ Production-ready with portable configuration
## Support

For deployment issues, check:
1. Script outputs for specific error messages
2. Google Cloud Console for service status
3. Firebase Console for function logs
4. This documentation for troubleshooting steps
