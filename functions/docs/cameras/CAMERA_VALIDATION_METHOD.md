# Camera Validation Method

This is the operating procedure for turning the camera API from a lightweight catalog into a defensible recommendation system.

## 1. Official Source Baseline

Every body and lens record should have:

- `sourceUrls`: manufacturer-owned product, lineup, launch, firmware, or specification URLs
- `verifiedAt`: the last date the record was checked against those sources
- `verifiedBy`: the reviewer or script version that performed the check

Rules:

- Prefer official manufacturer product pages, official lineup pages, official spec PDFs, and official firmware release notes.
- Do not promote third-party summaries over manufacturer data when the question is pure capability coverage.
- When official storefront metadata is contradictory, preserve the contradiction in notes and fall back to lineup or support documentation.

## 2. Science Validation

Recommendations must be constrained by photography fundamentals, not only by genre heuristics.

Validate against:

- Exposure math: APEX / EV100 relationships must stay coherent across aperture, shutter, and ISO.
- Handheld shutter guidance: start from focal-length-based baselines, then treat IBIS and lens OIS as bounded risk reducers, not guarantees.
- Flash behavior: respect mechanical vs electronic shutter limits, X-sync boundaries, HSS requirements, and rolling-shutter caveats.
- Astrophotography: use NPF or focal-length and pixel-pitch-aware limits instead of a blanket 500-rule assumption.
- Diffraction and depth of field: avoid recommending apertures that are technically possible but predictably soft for the sensor class without explaining the tradeoff.
- Crop behavior: account for RF-S and APS-C lens crop implications on full-frame bodies and equivalent field of view.

## 3. Community Review

Scientific correctness is necessary but not sufficient. The presets also need field validation from working photographers.

Minimum panel:

- portrait / wedding
- sports / action
- wildlife / birding
- landscape / travel
- commercial product / food
- real estate / architecture
- concert / event
- astro / night

Review protocol:

- Ask each reviewer to mark presets as "usable", "usable with caveat", or "incorrect".
- Record the body, lens, subject, lighting, and failure mode when a preset is rejected.
- Treat disagreements as data-model gaps first, not reviewer error.
- Use `COMMUNITY_REVIEW_PACKET.md` as the review handout and log outcomes in `COMMUNITY_REVIEW_LOG_TEMPLATE.csv`.

## 4. Release Gate

Do not treat a body, lens, or preset as fully verified until:

- the catalog record has official source provenance
- the capability fields needed by the preset engine are populated
- at least one science pass has cleared the recommendation logic
- at least one relevant working-photographer review has been logged for that genre

## 5. Current Automation

The repository now ships these support commands:

- `npm run catalog:cameras`: normalizes catalog records and fills provenance metadata
- `npm run audit:cameras`: regenerates the audit baseline
- `npm run reviewpacket:cameras`: generates the reviewer handout and review log template
- `npm run validate:cameras`: enforces provenance coverage and required review artifacts
- `npm run predeploy:check`: runs the full catalog and API gate before deploy
