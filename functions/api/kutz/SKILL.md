---
description: Use when working on KaleKutz — voice-first nutrition tracker at kaayko.com/kutz. Trigger for any file under functions/api/kutz/, kaayko/kutz/src/, or kutzProfile/kutzDays/kutzFrequentFoods Firestore collections. Also trigger for parseFoods, suggest, weeklyReport, fitbit integration, diet type system, barcode scanner, macro rings, meal logging, weight log, or test files prefixed kutz-.
---

# KaleKutz — Developer Runbook

## Purpose

KaleKutz is a private, voice-first nutrition tracker built for high-protein fat loss on an Indian vegetarian diet. The core insight: Indian food is almost entirely absent from Western nutrition databases (dal, sabzi, roti, katori portions), so we use Claude Sonnet with IFCT reference values instead of a lookup database. Accessible at kaayko.com/kutz — auth-gated via Google sign-in + optional email allowlist.

**Targets:** 1650 kcal / 110g protein / 200g carbs / 55g fat / 25g fiber

---

## Architecture

```
kaayko/kutz/           → React 18 + Vite frontend (builds to kaayko/src/kutz/)
kaayko-api/functions/api/kutz/  → Express backend routes (mounted at /api/kutz/)
Firebase project: kaaykostore   → same Auth + Firestore as main kaayko app
```

---

## Key Backend Files

| File | Responsibility |
|------|---------------|
| `kutzRouter.js` | Express router — mounts all /api/kutz/* endpoints |
| `parseFoods.js` | POST /parseFoods — text/voice → Claude Sonnet → structured food array. Rate-limited 10/min/uid. Injects diet type rules + product DB overrides into system prompt. |
| `suggest.js` | POST /suggest — reads today's log + 14-day history + frequent foods → Claude Sonnet → 2 insights + 2-3 personalised meal suggestions |
| `weeklyReport.js` | POST /weeklyReport — 7-day aggregation → Claude Sonnet → factual weekly analysis |
| `fitbit.js` | GET /fitbit/initiate, GET /fitbit/callback, POST /fitbit/sync, GET /fitbit/status, POST /fitbit/disconnect — full OAuth 2.0 + token auto-refresh |

---

## Key Frontend Files

| File | Responsibility |
|------|---------------|
| `src/components/VoiceInput.jsx` | Mic (Web Speech API) + text field + barcode scanner + auto-parse + preview cards. Reads `dietType` from ProfileContext and passes to parseFoods. |
| `src/components/Cockpit.jsx` | SVG macro rings: calories (outer), protein + fiber (inner) + carbs/fat progress row |
| `src/components/MealGroup.jsx` | Collapsible meal groups (Breakfast/Lunch/Dinner/Snacks) with all 5 macros |
| `src/components/SuggestPanel.jsx` | Expandable AI panel — tapping a suggestion pre-fills VoiceInput via `kutz:suggest` custom event |
| `src/components/EnergySection.jsx` | Steps, Fitbit calories, exercise log (add/delete), Fitbit connect + sync button |
| `src/components/FoodModal.jsx` | Manual food entry for all 5 macros |
| `src/components/SettingsView.jsx` | BMR/TDEE calculator, macro targets, diet pattern (4 options), weight log, auto-entries, product DB overrides, CSV export |
| `src/components/BarcodeScanner.jsx` | ZXing-based barcode scanner → OpenFoodFacts lookup → preview card |
| `src/lib/claude.js` | Frontend API calls: parseFoods(text, dietType), getSuggestions(), fitbit helpers |
| `src/lib/firestore.js` | All Firestore ops: getOrCreateDay, addFood, deleteFood, logWeight, saveProduct, exercise CRUD |
| `src/lib/calculations.js` | calcBMR (Mifflin-St Jeor, gender-aware), calcTDEE, stepBurn, correctedFitbit |
| `src/context/ProfileContext.jsx` | Provides: profile, targets, dietType (derived), updateProfile. Falls back to defaults if not loaded. |
| `src/lib/constants.js` | TARGETS, MEALS, MEAL_COLORS, COLORS, DIET_TYPES, ACTIVITY_LEVELS, DEFAULT_AUTO_ENTRIES |

---

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/kutz/parseFoods` | requireAuth | Voice/text → food items |
| POST | `/api/kutz/suggest` | requireAuth | Today-aware meal suggestions |
| POST | `/api/kutz/weeklyReport` | requireAuth | 7-day macro analysis |
| GET | `/api/kutz/fitbit/initiate` | requireAuth | Returns `{ authUrl }` for frontend redirect |
| GET | `/api/kutz/fitbit/callback` | **public** | Fitbit OAuth callback — exchanges code for tokens |
| POST | `/api/kutz/fitbit/sync` | requireAuth | Sync today's steps + calories from Fitbit |
| GET | `/api/kutz/fitbit/status` | requireAuth | Check if Fitbit connected + token state |
| POST | `/api/kutz/fitbit/disconnect` | requireAuth | Delete stored Fitbit tokens |

---

## Firestore Schema (`users/{uid}/`)

| Collection / Doc | Fields |
|-----------------|--------|
| `kutzProfile/data` | `targets` (5 macros), `bmr`, `gender`, `activity`, `weight`, `height`, `age`, `dietType`, `autoEntries[]` |
| `kutzProfile/fitbit` | `accessToken`, `refreshToken`, `expiresAt`, `connectedAt`, `fitbitUserId` |
| `kutzDays/{YYYY-MM-DD}` | `date`, `locked`, `steps`, `fitbitCalories`, `activeMinutes`, `restingHeartRate`, `totals` (5 macros) |
| `kutzDays/{date}/foods/{id}` | `name`, `quantity`, `calories`, `protein`, `carbs`, `fat`, `fiber`, `meal`, `source`, `auto` |
| `kutzDays/{date}/exercises/{id}` | `type`, `durationMin`, `caloriesBurned`, `notes`, `addedAt` |
| `kutzFrequentFoods/{key}` | `name`, `calories`, `protein`, `carbs`, `fat`, `fiber`, `useCount`, `defaultQuantity` |
| `kutzProductDB/{key}` | `name`, `calories`, `protein`, `carbs`, `fat`, `fiber`, `per` (e.g. `100g`) |
| `kutzWeightLog/{YYYY-MM-DD}` | `weight`, `date`, `loggedAt` |

---

## Diet Type System

4 options stored in `kutzProfile/data.dietType`, defaulting to `lacto-ovo-vegetarian`:

| Value | Label | What's allowed |
|-------|-------|---------------|
| `lacto-ovo-vegetarian` | Vegetarian (eggs OK) | Dairy, eggs, all plant foods |
| `lacto-vegetarian` | Vegetarian (no eggs) | Dairy, all plant foods |
| `vegan` | Vegan | Plant foods only |
| `non-vegetarian` | Non-vegetarian | All foods |

`DIET_TYPES` constant in `constants.js`. ProfileContext exposes `dietType`. VoiceInput passes it to `parseFoods(text, dietType)` → body → `parseFoods.js` backend appends `DIET_PROMPTS[dietType]` to Claude system prompt. `suggest.js` reads from Firestore profile and injects diet label into system prompt so AI suggestions are always diet-compliant.

---

## parseFoods System Prompt Highlights

- **Model**: `claude-sonnet-4-5` (not Haiku — accuracy is critical)
- **Fat reference table**: Explicit kcal/protein/carbs/fat values for milk types, paneer, ghee, oils, dal, sabzi, rotis, protein powders (ISOPure Zero Carb, ON Gold Standard, MuscleBlaze Raw Whey)
- **Cooking oil assumption**: If a cooked dish is mentioned without oil, assume 1 tsp cooking fat
- **Indian portion sizes**: 1 katori ≈ 150-180ml, 1 glass ≈ 200ml, 1 medium bowl ≈ 250ml
- **Rate limit**: 10 req/min per uid (in-memory Map, resets on cold start)
- **Product DB override**: Firestore `kutzProductDB` injected as `[label-verified]` lines → Claude uses these over IFCT estimates
- **Diet rule injection**: Appended per `dietType` — includes/excludes + flagging instructions

---

## Suggest System

`POST /api/kutz/suggest` reads:
1. Profile targets + `dietType`
2. Today's food log (eaten items, totals, remaining macros)
3. Last 14 days of history → top 5 foods per meal slot, avg protein hit rate
4. Frequent foods list (top 12 by useCount)
5. Current IST time → determines `nextMeal` (breakfast <10h, lunch <14h, snacks <19h, dinner otherwise)

All sent to Claude Sonnet → returns `{ insights: [2 strings], suggestions: [2-3 objects] }`. Each suggestion has: `meal`, `label`, `foods`, `calories`, `protein`, `carbs`, `fat`, `fiber`, `reason`. Tapping a suggestion fires `kutz:suggest` custom event → VoiceInput pre-fills + auto-parses after 600ms.

---

## Fitbit Integration

Full OAuth 2.0 PKCE-style server flow:
1. Frontend calls `GET /fitbit/initiate` → receives `{ authUrl }`
2. Frontend does `window.location.href = authUrl`
3. User approves → Fitbit redirects to `/api/kutz/fitbit/callback?code=...&state={base64url(uid)}`
4. Backend exchanges code for tokens → stores in `kutzProfile/fitbit`
5. Redirects to `/kutz?fitbit=connected`
6. Sync: `POST /fitbit/sync` → Fitbit activities API → updates day doc (steps, fitbitCalories, activeMinutes, restingHeartRate)
7. Token auto-refresh: if `Date.now() >= expiresAt - 60_000` → refresh before sync

**Env vars required** (in `functions/.env`):
```
FITBIT_CLIENT_ID=...
FITBIT_CLIENT_SECRET=...
FITBIT_REDIRECT_URI=https://api-vwcc5j4qda-uc.a.run.app/kutz/fitbit/callback
```

---

## Test Suite (`npm run test:kutz`)

**Command**: `node ./node_modules/jest/bin/jest.js --runInBand __tests__/kutz-parseFoods.test.js __tests__/kutz-suggest.test.js __tests__/kutz-fitbit.test.js --forceExit --detectOpenHandles`

| File | Tests | What's covered |
|------|-------|---------------|
| `kutz-parseFoods.test.js` | ~30 | Auth (401/expired), rate limit (10/min, per-uid isolation), input validation (empty/long/non-string), successful parsing, all 5 macros, negative clamping, invalid meal normalisation, markdown JSON unwrapping, multi-item, diet type (all 4 values + unknown fallback), product DB injection, Claude error / invalid JSON / non-array, prompt construction |
| `kutz-suggest.test.js` | ~21 | Auth, no-history graceful, default targets, remaining macros calculation (correct + clamped), diet type in system prompt, frequent foods in prompt, insights/suggestions shape, Claude failure / invalid JSON / markdown wrap, model check |
| `kutz-fitbit.test.js` | ~18 | Auth on all protected endpoints, callback public, status (not connected / connected / expired), initiate (authUrl + state encoding), callback (success redirect / error param / missing code / token exchange failure), sync (not connected, valid, near-expiry refresh, refresh failure → 401, Fitbit API → 502, network → 500), disconnect (idempotent) |

**Mocks**:
- `__mocks__/@anthropic-ai/sdk.js` — manual mock with `_setResponse(text)`, `_setError(err)`, `_reset()`
- `__mocks__/firebase-admin.js` — existing Firestore/Auth mock; `admin._mocks.docData[path] = data` to seed
- `global.fetch` — mocked per test in fitbit suite
- `parseFoods._rateLimitMap.clear()` in `beforeEach` for test isolation

---

## BarcodeScanner Error Handling

`NotFoundException`, `ChecksumException`, `FormatException` from `@zxing/browser` are **not exported** by the library. Do **not** `import { NotFoundException }` — it throws "right hand side of instanceof is not an object". Instead use string comparison:

```js
const SILENT_ERRORS = new Set(['NotFoundException', 'ChecksumException', 'FormatException']);
if (SILENT_ERRORS.has(err?.name)) return; // suppress — normal scanning loop errors
```

---

## Build & Deploy

```bash
# Frontend
cd kaayko/kutz && npm run build          # outputs to kaayko/src/kutz/
cd .. && firebase deploy --only hosting

# Backend
cd kaayko-api && firebase deploy --only functions

# Tests only
cd kaayko-api/functions && npm run test:kutz
```

---

## Auth & Access Control

- Google sign-in only (Firebase Auth)
- Data is uid-scoped — naturally private
- Optional allowlist: `VITE_ALLOWED_EMAIL=wife@gmail.com` in `kaayko/kutz/.env.local`
- If set, any non-matching email sees an "Access restricted" screen

---

## Known Limitations / Future Work

| Gap | Impact | Fix |
|-----|--------|-----|
| No food lookup database — pure AI estimation | ±20-30% macro error on non-standard portions | Add IFCT dataset or allow manual gram entry |
| Web Speech API unsupported on iOS Chrome/Firefox | Voice silently fails for non-Safari iOS users | Detect support and show typed input fallback (partially done) |
| No photo logging | Losing to MacroFactor, SnapCalorie, Cal AI | Integrate GPT-4o vision or Gemini 1.5 Flash image API |
| No recipe builder | Multi-ingredient home cooking can't be saved & reused | Add recipe CRUD with per-ingredient breakdown |
| No offline support | Every parse requires internet (Claude API) | Pre-cache frequent foods; allow offline manual entry |
| Static macro targets | No adaptive adjustment from weight trend | Add weekly weight-vs-target → calorie adjustment logic |
| No micronutrients | Iron, calcium, B12 important for vegetarians | Extend parseFoods schema with key micros |
| Single user only | Can't add profiles | Multi-profile support under same uid or sub-accounts |
| PWA only (no native) | Push notifications, background sync limited | React Native wrapper or Capacitor build |
