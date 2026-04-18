# Kaayko API — Local Model Loop Dashboard

- Generated at: 2026-04-18T16:30:06.959Z
- Total runs: 8
- Learnings snapshots: 0
- Approved runs: 2
- Training-eligible runs: 0
- Suggestions surfaced: 6
- Vulnerabilities surfaced: 0
- Rejected rewrites: 0
- Guided products across runs: 7
- Primary-focus products across runs: 4
- Portfolio profiles configured: 7
- Engine: ollama (ollama / deepseek-coder-v2:16b)
- Gate pass rate: 25%

## Queue

- Pending: 0
- Processing: 0
- Done: 0
- Failed: 0

## Tracks

- commerce: 1 runs, 0 approved, 0 gold, 0 suggestions, 0 vulnerabilities, avg accuracy 0
- kortex: 4 runs, 2 approved, 0 gold, 6 suggestions, 0 vulnerabilities, avg accuracy 40
- shared: 1 runs, 0 approved, 0 gold, 0 suggestions, 0 vulnerabilities, avg accuracy 0
- weather: 2 runs, 0 approved, 0 gold, 0 suggestions, 0 vulnerabilities, avg accuracy 0

## Model Signal

- configured-model: 6 runs, 0 suggestions, 0 vulnerabilities, 0 applied edits, 0 rejected rewrites
- deepseek-coder-v2:16b: 2 runs, 6 suggestions, 0 vulnerabilities, 0 applied edits, 0 rejected rewrites

## Portfolio Coaching

- Commerce & Checkout API: guided in 2 run(s), primary focus in 1 run(s). Protect the products catalog, voting, image serving, Stripe payment intent creation, and order-completion flow as a paired, transaction-critical surface.
- Kamera Quest API: guided in 1 run(s), primary focus in 0 run(s). Keep camera catalog integrity, skill-level-aware preset generation, lens data, and predeploy validation stable as a contract-driven catalog service.
- KORTEX Platform API: guided in 5 run(s), primary focus in 4 run(s). Protect smart-link CRUD, tenant auth claims, redirect handling, analytics recording, billing visibility, and QR flows as a security-critical multi-tenant surface.
- Kreator Program API: guided in 1 run(s), primary focus in 0 run(s). Maintain creator application intake, onboarding state transitions, Google OAuth flows, and admin review as a gated, stateful program.
- Kutz Nutrition API: guided in 1 run(s), primary focus in 0 run(s). Maintain nutrition food parsing, meal suggestion ranking, Fitbit OAuth integration, and food search as a reliable, privacy-sensitive service.
- Shared API Infrastructure: guided in 8 run(s), primary focus in 3 run(s). Protect the middleware stack, auth guards, error handling, CORS, Firebase Admin initialization, and rate limiting that all routes depend on.
- Weather & Forecast API: guided in 3 run(s), primary focus in 2 run(s). Maintain forecast scheduling, paddle score computation, nearby water search, and cache behavior as a reliable, latency-sensitive service.

## Latest Agent Run

- Run: kortex-fix-the-following-low-severity-issue-redundant-error-messages-in-auth-middleware-20260418-162956z
- Model: unknown / configured-model
- Area: kortex
- Guided products: KORTEX Platform API, Shared API Infrastructure
- Primary focus: KORTEX Platform API, Shared API Infrastructure
- Files inspected: 0
- Safe edits applied: 0
- Summary: No agent summary recorded.

## Suggestion Board

- [low] kortex/kortex kortex-fix-the-following-low-severity-issue-redundant-error-messages-in-auth-middleware-20260418-160351z: Redundant Error Messages in Auth Middleware
- [low] kortex/kortex kortex-find-auth-bypass-vulnerabilities-20260418-155725z: Redundant Error Messages in Auth Middleware
- [low] kortex/kortex kortex-find-auth-bypass-vulnerabilities-20260418-155725z: Firestore Query Handling in Tenant Context Management

## Vulnerability Board

- No vulnerability findings were recorded.

## Recent Runs

- kortex-fix-the-following-low-severity-issue-redundant-error-messages-in-auth-middleware-20260418-162956z | kortex/kortex | agent_selecting | pending | focus=KORTEX Platform API, Shared API Infrastructure | suggestions=0 | vulnerabilities=0 | eligible=false
- kortex-fix-the-following-low-severity-issue-firestore-query-handling-in-tenant-context--20260418-160721z | kortex/kortex | agent_failed | pending | focus=KORTEX Platform API | suggestions=0 | vulnerabilities=0 | eligible=false
- weather-audit-auth-and-access-control-gaps-20260418-160440z | weather/weather | agent_failed | pending | focus=Weather & Forecast API | suggestions=0 | vulnerabilities=0 | eligible=false
- commerce-audit-checkout-and-payment-flows-for-security-issues-20260418-160446z | commerce/commerce | agent_failed | pending | focus=Commerce & Checkout API | suggestions=0 | vulnerabilities=0 | eligible=false
- kortex-fix-the-following-low-severity-issue-redundant-error-messages-in-auth-middleware-20260418-160351z | kortex/kortex | reviewed | approved | focus=KORTEX Platform API, Shared API Infrastructure | suggestions=2 | vulnerabilities=0 | eligible=false
- kortex-find-auth-bypass-vulnerabilities-20260418-155725z | kortex/kortex | reviewed | approved | focus=KORTEX Platform API | suggestions=4 | vulnerabilities=0 | eligible=false
- shared-audit-middleware-and-auth-modules-for-input-validation-gaps-and-missing-error-ha-20260418-154347z | shared/shared | agent_failed | pending | focus=Shared API Infrastructure | suggestions=0 | vulnerabilities=0 | eligible=false
- weather-find-all-vulnerabilities-in-weather-endpoints-20260418-154827z | weather/weather | agent_failed | pending | focus=Weather & Forecast API | suggestions=0 | vulnerabilities=0 | eligible=false

## Top Open Findings

- [low] kortex kortex-fix-the-following-low-severity-issue-redundant-error-messages-in-auth-middleware-20260418-160351z: Redundant Error Messages in Auth Middleware
- [low] kortex kortex-find-auth-bypass-vulnerabilities-20260418-155725z: Redundant Error Messages in Auth Middleware
- [low] kortex kortex-find-auth-bypass-vulnerabilities-20260418-155725z: Firestore Query Handling in Tenant Context Management
