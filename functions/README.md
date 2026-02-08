# Firebase Functions - Kaayko API

## 📚 Documentation

### Admin Authentication System
**Complete documentation:** [`docs/admin/`](./docs/admin/)

Quick links:
- **Deploy Now:** [QUICK_DEPLOY.md](./docs/admin/QUICK_DEPLOY.md)
- **Security Audit:** [SECURITY_AUDIT_SUMMARY.md](./docs/admin/SECURITY_AUDIT_SUMMARY.md)
- **Deployment Guide:** [DEPLOYMENT_GUIDE.md](./docs/admin/DEPLOYMENT_GUIDE.md)
- **Admin Management:** [ADMIN_MANAGEMENT_GUIDE.md](./docs/admin/ADMIN_MANAGEMENT_GUIDE.md)

### API Documentation
- **Smart Links API:** [`api/kortex/README.md`](./api/kortex/README.md)
- **Main API Docs:** `/api/README.md`

---

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start emulators
firebase emulators:start

# Or use convenience script
../start-emulators.sh
```

### Create First Admin

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
node scripts/initFirstAdmin.js admin@kaayko.com SecurePassword123!
```

### Deploy to Production

```bash
# Deploy everything
firebase deploy --only functions,firestore

# Deploy specific function
firebase deploy --only functions:api
```

---

## 📁 Project Structure

```
functions/
├── docs/
│   └── admin/              # Complete admin system documentation
│       ├── README.md       # Documentation index
│       ├── QUICK_DEPLOY.md
│       ├── SECURITY_AUDIT_SUMMARY.md
│       ├── SECURITY_CHECKLIST.md
│       ├── DEPLOYMENT_GUIDE.md
│       ├── ADMIN_MANAGEMENT_GUIDE.md
│       ├── AUTHENTICATION_README.md
│       ├── AUTHENTICATION_COMPLETE.md
│       └── TESTING_GUIDE.md
│
├── api/                    # API endpoints
│   ├── kortex/         # Smart Links CRUD API
│   ├── admin/              # Admin management API
│   └── ...                 # Other API modules
│
├── middleware/             # Express middleware
│   ├── authMiddleware.js   # JWT verification & RBAC
│   └── rateLimit.js        # Rate limiting
│
├── services/               # Business logic
│   └── adminUserService.js # Admin user management
│
├── scripts/                # Utility scripts
│   └── initFirstAdmin.js   # Create first admin user
│
└── index.js                # Main entry point
```

---

## 🔐 Security

**Status:** ✅ Production Ready (9/10 score)

**Key Features:**
- Enterprise authentication (Firebase Auth)
- Role-based access control (4 roles)
- Rate limiting (60 req/min authenticated, 10 req/min public)
- Input validation & sanitization
- Comprehensive Firestore security rules

**Read first:** [SECURITY_AUDIT_SUMMARY.md](./docs/admin/SECURITY_AUDIT_SUMMARY.md)

---

## 🎯 Key Endpoints

### Protected (Requires Auth)
```
POST   /api/smartlinks          - Create smart link
GET    /api/smartlinks          - List all links
PUT    /api/smartlinks/:code    - Update link
DELETE /api/smartlinks/:code    - Delete link (admin only)
GET    /api/admin/users         - List admin users (super-admin only)
POST   /api/admin/users         - Create admin user (super-admin only)
```

### Public
```
GET    /api/l/:code             - Redirect to destination (public)
POST   /api/analytics           - Track link clicks (anonymous)
```

---

## 🧪 Testing

### Run Local Tests

```bash
# Start emulators
firebase emulators:start

# Test protected endpoint (should fail)
curl -X POST http://localhost:5001/kaaykostore/us-central1/api/smartlinks

# Test public endpoint (should work)
curl http://localhost:5001/kaaykostore/us-central1/api/l/lkTEST
```

**Complete testing guide:** [TESTING_GUIDE.md](./docs/admin/TESTING_GUIDE.md)

---

## 📊 Admin System Status

**Admin User:** ✅ Created
- Email: `rohan@kaayko.com`
- Role: `super-admin`
- UID: `l1HeaRlJ4IYeSEBrm9cQvjXu8po1`

**Production URLs:**
- Login: https://kaaykostore.web.app/admin/login.html
- Dashboard: https://kaaykostore.web.app/admin/kortex.html
- API: https://us-central1-kaaykostore.cloudfunctions.net/api

---

## 🛠️ Development

### Environment Setup

```bash
# Required environment variables
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"

# Optional (for local testing)
export FIRESTORE_EMULATOR_HOST="localhost:8080"
export FIREBASE_AUTH_EMULATOR_HOST="localhost:9099"
```

### Code Style

- Node.js 22
- Firebase Functions v2
- Express.js for routing
- ES6+ JavaScript
- JSDoc comments

### Adding New Endpoints

1. Create router in `api/<module>/`
2. Add authentication middleware if needed
3. Register in `index.js`
4. Update documentation
5. Test locally
6. Deploy

---

## 📞 Quick Commands

```bash
# View logs
firebase functions:log --only api

# Deploy functions only
firebase deploy --only functions

# Deploy Firestore rules
firebase deploy --only firestore:rules

# Create admin user
node scripts/initFirstAdmin.js email@domain.com password

# Check function status
firebase functions:list
```

---

## 🆘 Troubleshooting

**Common issues:**
- **401 Unauthorized:** Check token in localStorage
- **CORS errors:** Verify `cors: true` in function config
- **Permission denied:** Deploy Firestore rules
- **Function timeout:** Increase timeout in index.js

**Full troubleshooting:** [DEPLOYMENT_GUIDE.md](./docs/admin/DEPLOYMENT_GUIDE.md)

---

## 📝 Maintenance

**Weekly:**
- Check Firebase Console for errors
- Review admin user activity
- Monitor function invocations

**Monthly:**
- Update dependencies (`npm update`)
- Review security logs
- Check Firebase quotas

**Quarterly:**
- Full security audit
- Update Firebase SDKs
- Review and optimize rules

---

**Last Updated:** November 9, 2025  
**Version:** 1.0  
**Status:** ✅ Production Ready

**For complete documentation, see:** [`docs/admin/`](./docs/admin/)
