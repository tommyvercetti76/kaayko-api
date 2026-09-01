# Paddle Score Algorithm Changelog

## v2.3.0 — 2026-09-01

### Marine data removed on inland water (accuracy — this was publishing fiction)

WeatherAPI's marine endpoint does **not** error, and does not snap to the ocean,
when asked about a landlocked point — it returns a complete, plausible-looking
marine record. Verified live:

| queried point | returned |
|---|---|
| Antero Reservoir, CO (alpine, ~8,900 ft) | 1.4 m waves, 0.7 m swell @ 5.2 s, 28.8 °C water |
| Jenny Lake, WY (small alpine lake) | 0.7 m waves, 0.8 m swell, 13.3 °C water |
| White Rock Lake, TX (urban lake) | 0.3 m waves, 0.2 m swell |

Consequences in production: `WAVE_MOD` / `WAVE_LARGE` / `SWELL_STEEP_*` /
`WIND_CROSS_SWELL` penalties fired on lakes and **rivers** (the Merrimack was
carrying `SWELL_STEEP_MAJOR`); eight inland spots across Texas, Utah and
Colorado all reported an identical 28.8 °C water temperature; and the UI told
users "Moderate waves (4.6 ft)" on an alpine reservoir.

**Marine is now off unless a spot is explicitly coastal** (`marineApplicable`,
default false; no curated spot sets it). Wave/swell rules simply cannot fire on
inland water, which is consistent with the pipeline's existing rule: never
penalize for data we don't have. Also removes one external API call per score.

### Water temperature is an estimate, and now says so
With marine gone, inland water temperature comes from the documented estimator.
Two changes: it is derived from the **day's average air temperature** rather
than the current hour (water has large thermal mass — instantaneous air made an
alpine lake read 2 °C at night purely because the air had dropped), and
responses carry `conditions.waterTempEstimated: true` so no surface presents an
estimate as a reading. River flow and stage remain real, named-gauge USGS data.

### Daylight-only night gate
`conditions.isDay` and a `night: { isNight, nextDaylight }` block now ride the
score; hourly forecast rows carry `isDay`. A `NIGHT` tip outranks everything
else after dark. The forecast page stands the score numeral down at night and
shows the next daylight window's score instead — nobody should read a green
"Worth it" at midnight. Methodology and Terms now state plainly that Kaayko
scores daylight only and does not condone night paddling, and that a daytime
score never implies the same water is acceptable after dark.

### ML service redeployed with the harvested safety layer
`expert_rules.py` is live on Cloud Run (revision 00017): the ≤2.5 expert-rule
safety floor caps the model, `reasons[]` ship with every prediction, and
prediction logs carry `featuresHash` + `weatherBucket`. Deployed via the
canary pattern (no traffic → smoke test → migrate). The first attempt failed
closed with `ModuleNotFoundError` because the Dockerfile copies runtime files by
name and the new module wasn't listed — production never saw it, and the
Dockerfile now documents the requirement.

Measured effect at the model boundary: on a genuinely dangerous input
(26 mph wind, 38 mph gusts, 4 °C water, 2 km visibility) the raw model returned
**3.0**; the floored service returns **1.0** with explicit reasons. Benign days
are unchanged.

**Eval (protocol per EVALS.md, run against the deployed pipeline):** MAE 0.727
(was 0.728), bias −0.056, dangerous-condition recall 0.952, two-tier
over-optimism 2.7% — no regression on any gate.

## v2.2.1 — 2026-09-01

**Display policy: half-point steps everywhere (product decision, Rohan).**
One-decimal display (introduced v2.0.0) retracted after seeing it live — arbitrary
decimals (1.9, 2.2) read as pseudo-precision on a paddling decision. `rating`
(0.5-snapped) is the displayed number on every surface; the verdict label now
derives from the SNAPPED rating (server `interpretation` included), so label,
color, and number can never disagree. User-facing tier boundaries are therefore
4.0 / 3.0 as displayed. `ratingPrecise` remains in every API response for
evaluation, research, and the craft layer's internal math — it is simply not
rendered. Also in this release: methodology page gains the craft-adjustment
table, trip-prep/spot-facts provenance, and corrected pipeline copy (offset
suppression); privacy page discloses card-style + boat-type preferences and the
craft request parameter; terms add an explicit informational-guidance bullet
for tips/craft/spot notes.

Versioned record of every scoring-semantics change. The running version is
`ALGORITHM_VERSION` in `functions/api/weather/scoringConstants.js` and rides on
every score response and cache doc as `algorithmVersion`.

---

## v2.0.0 — 2026-08-31/09-01

The correctness release. Precedes any feature work (craft layer, tips, hydrology)
because a 20-agent adversarial audit found the pipeline publishing wrong numbers
on its most common inputs.

### Bug fixes that change published scores
- **Beaufort table (mph) used knots boundaries** (`dataStandardization.js`). 7/11/16/22/28
  → correct 8/13/19/25/32. Effect: scores in the 11–25 mph band RISE (a 12 mph day
  loses a spurious −1.0 WIND_MODERATE; 16–19 mph −1.5→−1.0; 22–25 mph −2.0→−1.5).
  This also removes train/serve skew — training used the correct table.
- **Government weather alerts now reach the score.** The score path fetches
  `forecast.json` (`alerts=yes`); `_standardizeWeatherResponse` sets
  `current.hasWarnings` explicitly. The designed WARNINGS −1.0 penalty (and the
  ML `hasWarnings` feature, and the rules-fallback −0.8) were dead: alerts were
  never requested. Effect: scores DROP under active advisories.
- **Per-spot feedback offset can no longer cancel the safety gate.** Positive
  `dynamicOffset` is suppressed whenever any major (≥1.0) penalty fires; feedback
  aggregation is time-windowed to 90 days; offset cap is now asymmetric [−1.0, +0.5].
- **Hourly heatmap (fastForecast) finally receives marine data** — the location
  argument was dropped at the call site, so `getMarineData(undefined)` threw
  (swallowed) on every request. Effect: coastal/large-lake hourly scores gain real
  wave/water-temp inputs; spurious summer cold-water penalties from the air−8 °C
  estimate disappear where marine data exists.
- **Marine data is indexed by local hour** (current path) and by matching
  date+time (hourly path) instead of midnight-of-day-0.
- **Swell/steepness/thunder-code penalties can now fire**: the marine object is
  reshaped (`rawMarineHour`, `swellHeight`, …) into the form `pickValue` expects.
  They previously fired in NO path.
- **PoP (chance of rain) now feeds the current-conditions score** — sourced from
  the current local hour of the forecast (current.json has no PoP field; the
  `precipitation.chancePct` read was always undefined).
- **Forecast-trend calibration + deteriorating-conditions warnings are live** —
  both analyzers now accept the standardized forecast array (previously a shape
  mismatch made them dead code in every path).
- **Hourly visibility uses `??` not `||`** — zero-visibility fog hours no longer
  read as "10 km" (VIS_POOR applies again).
- **ML response validation** — a malformed ML service response falls back to the
  rules rating instead of publishing a hard 1.0 at confidence 0.99.
- **forecast_cache coordinate hash kept the digits but stripped the minus sign**,
  colliding east/west hemisphere mirrors. Negative signs are now encoded (`m`).

### Semantics / contract
- **Canonical tiers everywhere: ≥3.7 Worth it / ≥2.7 Careful / else Hard pass**
  (server previously used ≥4.0/≥3.0 — invisible only because 0.5-snapped values
  cross 3.7 exactly when they cross 4.0; the snap removal below made unification
  mandatory).
- **`ratingPrecise` (0.1 steps)** ships beside the legacy 0.5-snapped `rating`.
  The verdict label derives from `ratingPrecise`. Clients display one decimal.
- **One pipeline**: `scoringPipeline.scoreFromFeatures` is the single
  predict→calibrate→penalize→offset→interpret core used by /paddleScore,
  /paddlingOut (via warmer), /fastForecast per-hour, and /forecast. The third
  divergent path (`forecast.js generatePaddleSummary` — which scored hardcoded
  default features and used a 4-tier `excellent/good/fair/poor` vocabulary) was
  deleted along with the 5-function scheduler pipeline whose cache writes used a
  key scheme no endpoint read (~470 wasted external calls/day).
- **Responses now carry** `ratingPrecise`, `riskClass` + `explanations` (parsed
  from the paddle-llm adapter but previously dropped; null for the sklearn path),
  `penaltyDetails` (structured codes), `modelType`, `algorithmVersion`.
- **Coordinate requests within 300 m of a curated spot resolve to that spot** —
  same cache doc, same calibration offset (same water scored identically across
  /paddleScore, /batch and the list).
- **Warmer reuses the ML prediction when inputs are unchanged** (`mlInputsHash`)
  — the 15-min cadence against a 2 h weather cache recomputed identical inputs
  ~75–87% of the time.
- Forecast cache TTL 4 h → 2 h (forecast responses now carry the score path's
  current conditions + alerts).

### Abuse containment (no score change)
- `/feedback`: per-client daily dedup (deterministic doc id), 5/IP/day cap, and
  `predictedScore` is server-authoritative from cache — closes the calibration-
  poisoning vector.
- `/batch`: 100/IP/day, finite-coordinate validation, known-spot short-circuit,
  3-decimal coordinate caching, capped weather-fallback chain.
- Geocode proxy: query cap + 30/min/IP; `/fastForecast/cache/stats` admin-gated.
- `unified_weather_cache` coordinate keys rounded to 3 dp (cache version v3).

### Validation
- Emulator: fresh + cached `/paddleScore`, `/paddleScore/batch`, `/fastForecast`
  (incl. `?spotId=` which never worked before), `/forecast` (200 live / 502 on
  failure) all verified; feedback dedup + server-predictedScore verified against
  live Firestore.
- PENDING before deploy: 187-label offline replay (tier-confusion old vs new;
  expected shift: higher scores in the 11–25 mph band from the Beaufort fix) —
  see EVALS.md (Phase 7).
