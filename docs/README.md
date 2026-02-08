# 📚 Technical Documentation

Reference guides for architecture, ML integration, system design, and deployment.

For **API endpoint docs**, see [`../functions/api/README.md`](../functions/api/README.md).

---

## 📖 Documents

### Architecture & System Design

| Document | Description |
|----------|-------------|
| [GOLD_STANDARD_IMPLEMENTATION.md](GOLD_STANDARD_IMPLEMENTATION.md) | ML model integration (v3), 57-feature pipeline, 99.98% R² accuracy |
| [HOW_SCHEDULED_FUNCTIONS_WORK.md](HOW_SCHEDULED_FUNCTIONS_WORK.md) | Cron-based forecast warming — 6 scheduled functions, cache architecture |
| [FIREBASE_API.md](FIREBASE_API.md) | Firebase optimization, cache-first architecture, 97% faster responses |
| [WHY_OVERPASS_IS_PERFECT.md](WHY_OVERPASS_IS_PERFECT.md) | Overpass API rationale for OpenStreetMap water body discovery |
| [SMART_WARNING_SYSTEM_API_DOCS.md](SMART_WARNING_SYSTEM_API_DOCS.md) | Warning generation system — 6 warning types, condition thresholds |
| [ORDER_DATA_STRUCTURE.md](ORDER_DATA_STRUCTURE.md) | Payment intent → order document schema and lifecycle |
| [ORDER_TRACKING_SYSTEM.md](ORDER_TRACKING_SYSTEM.md) | Order status tracking, fulfillment workflow |

### API Specifications

| Document | Description |
|----------|-------------|
| [OPENAPI_KORTEX_V4.yaml](OPENAPI_KORTEX_V4.yaml) | OpenAPI 3.0.3 spec for Kortex (Smart Links) API |
| [Kaayko_Kortex_API_v4.postman_collection.json](Kaayko_Kortex_API_v4.postman_collection.json) | Postman collection for Kortex API testing |
| [kaayko-paddling-api-swagger.yaml](kaayko-paddling-api-swagger.yaml) | OpenAPI spec for Weather/Paddling APIs |
| [API-QUICK-REFERENCE-v2.1.0.md](API-QUICK-REFERENCE-v2.1.0.md) | Quick-reference endpoint list |

### Deployment & Operations

| Document | Description |
|----------|-------------|
| [deployment/DEPLOYMENT_GUIDE.md](deployment/DEPLOYMENT_GUIDE.md) | Production deployment procedures, rollback strategies |
| [STRIPE_EMAIL_SETUP_GUIDE.md](STRIPE_EMAIL_SETUP_GUIDE.md) | Stripe + email notification configuration |

---

## 🗺️ Documentation Map

```
kaayko-api/
├── README.md                        ← Project overview, quick start
├── DOCUMENTATION_INDEX.md           ← Navigation hub
├── docs/                            ← Technical guides (YOU ARE HERE)
│   ├── Architecture & ML docs
│   ├── OpenAPI specs & Postman
│   └── deployment/
└── functions/
    ├── README.md                    ← Functions setup, scripts, testing
    ├── api/README.md                ← Master API endpoint reference
    ├── api/*/README.md              ← Per-module endpoint docs (11 modules)
    └── docs/admin/                  ← Admin authentication system docs
```

---

**Last Updated:** February 2026
