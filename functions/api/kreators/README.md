# Kreator API

Enterprise-grade API for managing Kreators (Creators) in the Kaayko platform.

## Overview

The Kreator API handles the complete creator lifecycle:
1. **Application** - Public form submission
2. **Admin Review** - Approve/reject workflow
3. **Onboarding** - Magic link → Password setup
4. **Authentication** - Password + Google OAuth
5. **Profile Management** - Settings & preferences

## Endpoints

### Public Endpoints (No Auth Required)

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| `GET` | `/kreators/health` | Health check | None |
| `POST` | `/kreators/apply` | Submit application | 5/hour |
| `GET` | `/kreators/applications/:id/status?email=` | Check status | 10/min |
| `POST` | `/kreators/onboarding/verify` | Verify magic link | 20/min |
| `POST` | `/kreators/onboarding/complete` | Set password | 5/min |

### Authenticated Endpoints (Kreator Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/kreators/me` | Get profile |
| `PUT` | `/kreators/me` | Update profile |
| `POST` | `/kreators/auth/google/connect` | Link Google |
| `POST` | `/kreators/auth/google/disconnect` | Unlink Google |

### Admin Endpoints (Admin Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/kreators/admin/applications` | List applications |
| `GET` | `/kreators/admin/applications/:id` | Get application |
| `PUT` | `/kreators/admin/applications/:id/approve` | Approve |
| `PUT` | `/kreators/admin/applications/:id/reject` | Reject |
| `GET` | `/kreators/admin/list` | List kreators |
| `GET` | `/kreators/admin/:uid` | Get kreator |
| `POST` | `/kreators/admin/:uid/resend-link` | Resend magic link |
| `GET` | `/kreators/admin/stats` | Get statistics |

## Request/Response Examples

### Submit Application

```bash
POST /api/kreators/apply
Content-Type: application/json

{
  "email": "creator@example.com",
  "displayName": "John Creator",
  "applicationNote": "I create content about outdoor adventures and kayaking...",
  "brandName": "Adventure Studio",
  "website": "https://adventurestudio.com",
  "socialLinks": {
    "instagram": "@adventurestudio",
    "youtube": "adventurestudio"
  },
  "consent": {
    "dataProcessing": true,
    "marketingEmails": false
  }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "app_xYz789AbCd",
    "email": "creator@example.com",
    "status": "pending",
    "submittedAt": "2025-01-26T10:30:00Z",
    "expiresAt": "2025-02-25T10:30:00Z",
    "message": "Your application has been submitted successfully..."
  }
}
```

### Approve Application (Admin)

```bash
PUT /api/kreators/admin/applications/app_xYz789AbCd/approve
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "notes": "Strong portfolio, active community"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "applicationId": "app_xYz789AbCd",
    "kreatorId": "kreator_uid_123",
    "kreatorEmail": "creator@example.com",
    "magicLinkCode": "ml_AbCdEfGhIjKl",
    "magicLinkUrl": "https://kaayko.com/l/ml_AbCdEfGhIjKl",
    "expiresAt": "2025-01-27T10:30:00Z"
  }
}
```

### Complete Onboarding

```bash
POST /api/kreators/onboarding/complete
Content-Type: application/json

{
  "token": "ml_AbCdEfGhIjKl",
  "password": "SecureP@ssw0rd123"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "kreatorId": "kreator_uid_123",
    "email": "creator@example.com",
    "status": "active",
    "message": "Account setup complete! You can now log in."
  }
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `DUPLICATE_APPLICATION` | 409 | Email already has pending/approved app |
| `NOT_FOUND` | 404 | Resource not found |
| `ALREADY_CONSUMED` | 410 | Magic link already used |
| `EXPIRED` | 410 | Magic link expired |
| `INVALID_PASSWORD` | 400 | Password doesn't meet requirements |
| `KREATOR_PENDING_PASSWORD` | 403 | Account setup incomplete |
| `KREATOR_SUSPENDED` | 403 | Account suspended |
| `PASSWORD_REQUIRED` | 400 | Need password to disconnect Google |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |

## Password Requirements

- Minimum 8 characters
- Maximum 128 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- At least 1 special character (!@#$%^&*...)

## Magic Link Behavior

1. **Single Use**: Each link can only be used once
2. **24 Hour Expiry**: Links expire 24 hours after creation
3. **Token Hashing**: Tokens stored as scrypt hashes (security)
4. **Click Tracking**: Clicks tracked before consumption
5. **Resend Capability**: Admins can resend (invalidates previous links)

## Testing with Emulator

```bash
# Start Firebase emulator
cd api/kaayko-api
firebase emulators:start --only functions,firestore

# Health check
curl http://localhost:5001/kaaykostore/us-central1/api/kreators/health

# Submit application
curl -X POST http://localhost:5001/kaaykostore/us-central1/api/kreators/apply \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","displayName":"Test Creator","applicationNote":"This is my test application...","consent":{"dataProcessing":true}}'
```

## Files

```
api/kreators/
├── README.md                  # This file
└── kreatorRoutes.js           # Main router

services/
├── kreatorApplicationService.js  # Application CRUD + approval
└── kreatorService.js             # Kreator CRUD + magic links

middleware/
└── kreatorAuthMiddleware.js      # Auth middleware
```
