# Kaayko API — Agent Deployment Guide

## What This Project Is

Backend API and scheduled functions for **kaayko.com** — implemented as **Firebase Cloud Functions**
(not Cloud Run). Handles API requests routed from Firebase Hosting and scheduled forecast jobs.

---

## Architecture

```
kaayko.com/api/**
      │  (Firebase Hosting rewrite)
      ▼
Firebase Function: api        (kaaykostore project, nodejs22)
      │
      ▼
Firestore / Firebase Auth     (kaaykostore project)

Scheduled functions (also in kaaykostore):
  earlyMorningForecast
  morningForecastUpdate
  afternoonForecastUpdate
  eveningForecastUpdate
  emergencyForecastRefresh
  forecastSchedulerHealth
```

---

## GCP Project

| Component | GCP Project | Runtime |
|---|---|---|
| All Firebase Functions | `kaaykostore` | nodejs22 |
| Firestore | `kaaykostore` | — |

Firebase project default: `kaaykostore` (set in `.firebaserc`)

---

## Deploy Commands

### API function only (most common)
```bash
# From /Users/Rohan/Kaayko_v6/kaayko-api

bash deployment/deploy-api-only.sh
```
Deploys only `functions:api`. This is the HTTP API handler for all `/api/**` routes.

### All functions (API + all scheduled forecast jobs)
```bash
bash deployment/deploy-firebase-functions.sh
```
Deploys: `api`, `earlyMorningForecast`, `morningForecastUpdate`, `afternoonForecastUpdate`,
`eveningForecastUpdate`, `emergencyForecastRefresh`, `forecastSchedulerHealth`

### Override Firebase project (if needed)
```bash
FIREBASE_PROJECT=kaaykostore bash deployment/deploy-api-only.sh
```

---

## What Each Script Does

Both scripts:
1. Run `npm --prefix functions run predeploy:check` — TypeScript type-check + lint
2. `firebase deploy --config firebase.json --only functions:api[,...]`

**Pre-deploy check must pass before deploy proceeds.** Fix TS errors first.

---

## Key Files

| File | Purpose |
|---|---|
| `functions/src/` | TypeScript source for all functions |
| `functions/package.json` | Function dependencies + `predeploy:check` script |
| `firebase.json` | Functions config: source=functions, runtime=nodejs22 |
| `.firebaserc` | Firebase project: `kaaykostore` |
| `deployment/deploy-api-only.sh` | Deploy HTTP API function only |
| `deployment/deploy-firebase-functions.sh` | Deploy all functions |
| `firestore.rules` | Firestore security rules |
| `firestore.indexes.json` | Firestore composite indexes |

---

## Firebase Function: `api`

- Handles all HTTP requests to `kaayko.com/api/**`
- Routed via Firebase Hosting rewrite in `/Users/Rohan/Kaayko_v6/kaayko/firebase.json`
- Runtime: nodejs22

---

## Firestore Indexes

If you add a new Firestore query with compound `orderBy` or `where` + `orderBy`, you MUST
add the composite index to `firestore.indexes.json` and deploy it:

```bash
firebase deploy --only firestore:indexes --project kaaykostore
```

Missing indexes cause 500 errors at runtime with a Firestore exception.

---

## When Things Go Wrong

### "Pre-deploy check fails"
- TypeScript compile error or lint failure in `functions/src/`
- Fix the TS error, then retry the deploy script

### "Function cold start / timeout"
- Firebase Functions (Gen 1) have a cold start delay
- Consider increasing timeout or memory in `firebase.json` under `functions`

### "API returning 500"
- Check Firebase Function logs:
  `firebase functions:log --project kaaykostore --only api`
- Most common cause: Firestore query missing a composite index

### "Deploy fails with 'functions predeploy error'"
- Run manually: `npm --prefix functions run predeploy:check`
- Fix all TypeScript errors before retrying

---

## What NOT to Do

- Do not deploy individual functions by hand with `firebase deploy --only functions:someFunction`
  without running the predeploy check first
- Do not change `runtime` in `firebase.json` without testing locally — nodejs version changes
  can break existing function behaviour
- Do not confuse this with the **CoolSchools API** (`cool-schools-api` Cloud Run in
  `coolschools-72426`) — that is a completely separate service
- Do not run `gcloud` commands for this project — it uses Firebase Functions, not Cloud Run
