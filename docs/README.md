# 📚 Technical Documentation

**Deep-dive technical implementation guides**

---

## 📖 What's Here

This folder contains **technical implementation documentation** - architectural decisions, system designs, and integration guides. For **API endpoint documentation**, see [`../functions/api/README.md`](../functions/api/README.md).

---

## 🏗️ Core Architecture

### ML & Data Processing
- **[GOLD_STANDARD_IMPLEMENTATION.md](GOLD_STANDARD_IMPLEMENTATION.md)**  
  ML model integration (v3), 99.98% R² accuracy, 57-feature pipeline

- **[SMART_WARNING_SYSTEM_API_DOCS.md](SMART_WARNING_SYSTEM_API_DOCS.md)**  
  Warning generation system, 6 warning types, condition thresholds

### System Design
- **[HOW_SCHEDULED_FUNCTIONS_WORK.md](HOW_SCHEDULED_FUNCTIONS_WORK.md)**  
  Cron job architecture, cache warming (4x daily), scheduled pre-computation

- **[FIREBASE_API.md](FIREBASE_API.md)**  
  Firebase optimization, cache architecture, 97% faster response times

- **[WHY_OVERPASS_IS_PERFECT.md](WHY_OVERPASS_IS_PERFECT.md)**  
  Overpass API integration rationale, OpenStreetMap water discovery

---

## 📋 API References

### Quick Reference
- **[API-QUICK-REFERENCE-v2.1.0.md](API-QUICK-REFERENCE-v2.1.0.md)**  
  All endpoints, request/response examples, authentication

### OpenAPI Specification
- **[kaayko-paddling-api-swagger.yaml](kaayko-paddling-api-swagger.yaml)**  
  Complete OpenAPI 3.0.3 spec (2,392 lines), all 33 endpoints

---

## 🧪 Testing & Quality

- **[MASTER_TEST_INDEX.md](MASTER_TEST_INDEX.md)**  
  Test organization, test cases, coverage documentation

---

## 🚀 Deployment

- **[deployment/DEPLOYMENT_GUIDE.md](deployment/DEPLOYMENT_GUIDE.md)**  
  Production deployment procedures, rollback strategies

---

## 🗺️ Documentation Map

```
📚 Documentation Hierarchy:

api/
├── README.md                          ← Main entry point
├── DOCUMENTATION_INDEX.md             ← Navigation hub
│
├── docs/                              ← TECHNICAL GUIDES (YOU ARE HERE)
│   ├── README.md                      ← This file
│   ├── Architecture & Implementation
│   ├── API Specifications
│   └── Deployment Guides
│
└── functions/api/                     ← API ENDPOINT DOCS
    ├── README.md                      ← API overview
    ├── weather/README.md              ← Weather APIs (5 endpoints)
    ├── smartLinks/README.md           ← Smart Links (12 endpoints)
    ├── ai/README.md                   ← PaddleBot + GPT (7 endpoints)
    ├── products/README.md             ← Products (3 endpoints)
    ├── deepLinks/README.md            ← Universal Links (3 endpoints)
    └── core/README.md                 ← API docs (3 endpoints)
```

---

## 🎯 Navigation Guide

### I want to...

**Build an API feature:**
→ [`../functions/api/README.md`](../functions/api/README.md) - API endpoint documentation

**Understand ML integration:**
→ [`GOLD_STANDARD_IMPLEMENTATION.md`](GOLD_STANDARD_IMPLEMENTATION.md)

**See scheduled jobs:**
→ [`HOW_SCHEDULED_FUNCTIONS_WORK.md`](HOW_SCHEDULED_FUNCTIONS_WORK.md)

**Deploy to production:**
→ [`deployment/DEPLOYMENT_GUIDE.md`](deployment/DEPLOYMENT_GUIDE.md)

**Quick API reference:**
→ [`API-QUICK-REFERENCE-v2.1.0.md`](API-QUICK-REFERENCE-v2.1.0.md)

**OpenAPI spec:**
→ [`kaayko-paddling-api-swagger.yaml`](kaayko-paddling-api-swagger.yaml)

---

## 📊 Document Index

| Document | Purpose | Audience |
|----------|---------|----------|
| **GOLD_STANDARD_IMPLEMENTATION.md** | ML model integration | Developers |
| **HOW_SCHEDULED_FUNCTIONS_WORK.md** | Cron job architecture | Developers/DevOps |
| **FIREBASE_API.md** | Firebase optimization | Architects |
| **WHY_OVERPASS_IS_PERFECT.md** | Overpass API rationale | Product/Dev |
| **SMART_WARNING_SYSTEM_API_DOCS.md** | Warning system | Product/Dev |
| **API-QUICK-REFERENCE-v2.1.0.md** | API reference guide | All |
| **kaayko-paddling-api-swagger.yaml** | OpenAPI 3.0.3 spec | All |
| **MASTER_TEST_INDEX.md** | Test organization | QA/Dev |
| **deployment/DEPLOYMENT_GUIDE.md** | Deployment procedures | DevOps |

---

**Need endpoint docs?** See [`../functions/api/README.md`](../functions/api/README.md)  
**Need project overview?** See [`../README.md`](../README.md)
