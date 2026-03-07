# Kamera Quest Backend

## Scope

Kamera Quest is Kaayko's camera and photography recommendation system. It serves camera and lens catalogs, preset generation, skill-level-specific briefings, and session-optimization guidance.

## Mounted routes on `main`

- `GET /cameras/:brand`
- `GET /cameras/:brand/:modelName`
- `GET /cameras/:brand/:modelName/lenses`
- `GET /lenses/:brand`
- `GET /lenses/:brand/:lensName`
- `GET /presets/meta`
- `POST /presets/classic`
- `POST /presets/smart`

Primary route and engine files:

- [`functions/api/cameras/camerasRoutes.js`](../../functions/api/cameras/camerasRoutes.js)
- [`functions/api/cameras/lensesRoutes.js`](../../functions/api/cameras/lensesRoutes.js)
- [`functions/api/cameras/presetsRoutes.js`](../../functions/api/cameras/presetsRoutes.js)
- [`functions/api/cameras/smartRoutes.js`](../../functions/api/cameras/smartRoutes.js)
- [`functions/api/cameras/engine/presetEngine.js`](../../functions/api/cameras/engine/presetEngine.js)
- [`functions/api/cameras/engine/sessionAdvisor.js`](../../functions/api/cameras/engine/sessionAdvisor.js)

## Data and validation assets

- Catalog data lives under [`functions/api/cameras/data_cameras`](../../functions/api/cameras/data_cameras) and [`functions/api/cameras/data_lenses`](../../functions/api/cameras/data_lenses).
- Audit inputs live under [`functions/api/cameras/audit`](../../functions/api/cameras/audit).
- Research and review docs live under [`functions/docs/cameras`](../../functions/docs/cameras).
- Maintenance scripts live under [`functions/scripts`](../../functions/scripts) with `catalog:cameras`, `audit:cameras`, `reviewpacket:cameras`, and `validate:cameras`.

## Frontend consumers

- `src/karma.html`
- `src/karma/kameras/index.html`
- `src/karma/kameras/assets/kamera-enhancer.js`
- `src/karma/kameras/assets/kamera-enhancer.css`

## Quality model

- This is the one product in the repo with an active checked-in smoke suite on `main`.
- The predeploy chain regenerates docs and validation artifacts before deploy.
- Output fidelity is stronger on gear constraints than on subjective composition or aesthetic judgment; that distinction is explicitly modeled inside the engine.

## Quality and maintenance notes

- Keep route contracts, catalog scripts, and research docs in lockstep. Changing only the data or only the frontend weakens trust fast.
- Professional automation for this product should run catalog generation, audit, validation, smoke tests, and live sample-response snapshots per skill level.
