# Paddle Score Algorithm Changelog

## v2.7.0 — 2026-09-19

### The calibration layer was making the published score worse. Measured.

Every offline experiment scored the MODEL. Users receive
`penalties(calibrate(model))`. Nobody had ever measured the published number —
so audit finding #15 ("V2 fails the recall gate at 0.875") was a statement about
an intermediate value no surface ever shows.

Measured out-of-fold on the 187-row human corpus, grouped-by-lake 5-fold
(`paddle-llm/experiments/009_calibration_layer.js`; both layers are
hand-written and fit nothing, so running them on out-of-fold input leaks
nothing):

| pipeline | MAE | bias | dangerous recall | over-optimism |
|---|---|---|---|---|
| V2 out-of-fold | 0.6267 | +0.043 | 0.846 | 0.241 |
| + calibration | 0.6203 | +0.193 | 0.865 | 0.203 |
| **+ calibration + penalty gates (what was live)** | **0.5802** | −0.286 | 0.933 | 0.075 |
| **+ penalty gates, NO positive calibration** | 0.6043 | −0.412 | **0.962** | **0.043** |

Across the corpus the layer handed out **+31.68 of optimism against −3.75 of
caution — 8.5 to 1** — from three terms, none of which was ever fitted against
a label:

| term | rows | total |
|---|---|---|
| seasonal | 77 | +12.85 |
| wind_pattern | 90 | +10.00 |
| location | 32 | +6.45 |

The penalty gates downstream then spend their effort clawing that optimism back.

**Positive calibration adjustments are now suppressed.** Cost: 0.024 MAE. Bought:
dangerous recall 0.933 → **0.962** (gate needs 0.90) and over-optimism
0.075 → **0.043** (gate needs 0.05). This is the first configuration in the
project's history to pass BOTH safety gates. For a product whose failure mode is
telling somebody a bad day is a good one, that is the right side of the trade.

Negative adjustments are untouched. An unvalidated reason to be more cautious
costs a paddler an outing; an unvalidated reason to be optimistic can cost more.

The terms are not deleted — the hemisphere-correct seasonal logic from v2.5.0 is
still there and still tested. `PADDLE_ALLOW_POSITIVE_CALIBRATION=true` restores
the old behaviour in one environment variable, and the full accuracy/safety
frontier (positive-scale 0.0 → 1.0) is in
`experiments/results/009_calibration_layer.json`. A positive term may return when
it is fitted against labels and shown to improve the PUBLISHED score.

### Corrections to the audit ledger

- **Finding #15 was measured on the wrong thing.** The published score's
  dangerous recall was 0.933, not 0.875; it now stands at 0.962. The over-
  optimism gate was the one genuinely failing (0.075), and it now passes.
- **Finding #14's conclusion was wrong.** A learning curve
  (`experiments/006_learning_curve.py`) shows MAE flattening — 0.923, 0.714,
  0.659, 0.641, 0.627 — with a fitted asymptote of 0.596 and 10× the labels
  projected to reach 0.597. The 55%-unlabelled measurement stands; "labelling is
  the accuracy ceiling" does not follow.


## v2.6.0 — 2026-09-18

Round 2+3 of the production audit (`AUDIT-2026-09-18.md`). Every item here either
moves a published score or changes what the API claims about one.

### 1. The model now actually runs — in-process, not over the network

13 of 17 live spots were silently scored by `calculateFallbackRating`, a rule
heuristic, because Cloud Run cold starts exceeded the 10 s ML timeout
(`Cloud Run ML prediction failed: ML service request timed out after 10000ms`
in production logs). The published score said nothing about it.

- `localModel.js` evaluates the gradient-boosted ensemble **in process** from a
  JSON artifact (`data/models/paddle-score-model-v1.json`,
  `direct-hgb-mono-v2-2026-09-18`, 400 trees, 19 features, nested
  grouped-by-lake 5-fold out-of-fold MAE **0.6026**, 95% CI [0.514, 0.696],
  n=187). No network call, no cold start.
- Monotonic constraints are fitted into the model: score never rises as wind or
  precipitation rises. Verified through the JS evaluator over 0–40 mph.
- python→JS parity checked on 12 random rows: max divergence **0.00e+0**.
- `PADDLE_LOCAL_MODEL_PATH` is now an EXCLUSIVE override. It used to be merely
  the first candidate, so a wrong path silently loaded a different artifact.

Measured against the labelled corpus, this replaces a 0.947 MAE scorer with a
0.619 one (Wilcoxon **p = 1.6e-08**).

### 2. A fallback is now loud, and declared in the response

When the model cannot be evaluated the response carries `degraded: true` and
`degradedReason`, and a structured `ERROR` log records that the published score
came from the unevaluated rule heuristic. One retry is attempted first. The
flag survives cache reuse — a cached degraded score does not come back clean.

### 3. Missing data no longer reads as good weather

`modelCalibration.js` treated absent wind / visibility / precipitation as
benign, so a weather outage RAISED the score. Missing severity inputs now
suppress every positive term. This is the single change with the largest
effect on the numbers: on the labelled corpus the expert rule's MAE moved
1.281 → **1.045** and its dangerous-condition recall 0.337 → **0.538**.

### 4. One water-temperature policy, end to end

MEASURED OR NOTHING, applied consistently for the first time:
- `waterTempPublished` is the measured marine reading or `null`. Never an
  air-derived estimate.
- `waterTempMeasured` is published alongside it, so a client can tell "cold"
  from "unknown".
- `dataStandardization.js` uses `??`, not `||` — 0.0 °C is a real reading and
  was being discarded as falsy.
- This closes the screenshot contradiction: the hero said "no sensor" while the
  expanded heatmap showed a temperature. Both now read the same field.

The model still receives an air-derived water temperature as an INPUT, declared
in `FEATURE_CAVEATS`. Input estimation and published measurement are different
claims and are now kept apart.

### 5. Low-flow gate

`FLOW_LOW`: 0.5 penalty when a gauged river sits below the 10th percentile for
the spot-local month — dragging over shallows and portaging. Fail-closed:
no gauge, stale reading or missing normals means no gate, never a free pass.
Paired with a staleness guard on the flow TIP, which previously kept telling
paddlers about a 3-day-old reading the penalty gate had already refused.

### 6. Hydrology normals use the spot's month, not Greenwich's

Same bug class as v2.5.0's clock fix. `resolveNormalsMonth()` prefers the
spot's local wall clock, falls back to mean solar time from longitude
(worst case ~3 h of error instead of up to 14 h), and declares which it used
in `normalsMonthSource`. Both callers now pass the spot's longitude.

### 7. `feels_like_c` is computed in production

The model's most important feature was never being computed on the serving
path at all. Added, with `gust_delta_mph` and `marine_available`.

### 8. Response consistency

`confidence` is consistently typed. Penalties expose structured
`penaltyDetails` rather than pre-formatted strings for the client to parse
back.

### Known and NOT fixed in this release

- The model **saturates at 2.42 from ~15 mph upward** — there is no training
  data above that, so it cannot distinguish 15 mph from 40 mph. The wind
  penalty gates carry that range, which is why they are not removed.
- V2 misses two project gates: dangerous-condition recall 0.875 (target 0.90)
  and over-optimism 0.193 (target 0.05). Shipped as a deliberate owner
  decision, because the alternative live today is materially worse on both.
- 55% of real lake-hours fall in feature cells with **zero** human labels, and
  the unlabelled mass is the common warm/calm case. This is the accuracy
  ceiling and no code change moves it.
- The flow gate cannot fire on any current spot: none carries `hydrologyMeta`
  with a gauge id.


## v2.5.0 — 2026-09-18 — DEPLOYED (verified live: `algorithmVersion: 2.5.0` on all 18 spots)

### Calibration read the server's clock, not the water's

Three bugs in `modelCalibration.js`, all the same shape: a rule about time or
season read `new Date()` on a Cloud Functions instance (UTC) rather than the
local clock of the hour being scored.

1. **Season came from the server's UTC month.** `isSummer` was true everywhere
   on earth in June–August, so a southern-hemisphere lake collected a summer
   bonus in the middle of its winter and lost it in its summer; a forecast hour
   three days out was scored against today's month. Season is now derived from
   the **scored hour's local month and the signed latitude**, with a single
   hemisphere-corrected month rule set.
   - Tropical latitudes (|lat| < 23.44°) get **no** seasonal term: between the
     tropics the annual cycle is wet/dry, not warm/cold, and there is no wet/dry
     climatology in this pipeline to key off.
   - Polar latitudes (|lat| > 66.56°) likewise.
   - The **South Asian southwest monsoon** (IMD season, June–September, over
     5–35 °N / 65–95 °E) stands the bonus down. A large part of India sits above
     the Tropic of Cancer, so the tropical gate alone did not cover it: Indian
     lakes were collecting a "summer" bonus through the wettest, windiest
     months of their year.

2. **Forecast-trend hour comparison was off by the UTC offset.** The server's
   UTC hour was compared against **location-local** forecast hour strings —
   5.5 h out in IST. It now takes the scored hour's local hour.
   Also fixed: the window was `slice(0, 6)` **then** filter, i.e. hours
   00:00–05:00 of the day filtered to "at or after the current hour", so outside
   the small hours the list emptied and the term silently never fired at all.
   Now filters first, then takes six — "the next six hours" as documented.

3. **The water-temperature bonus is gone.** `calibrateWaterTemperature()`
   awarded up to **+0.3** from an air-derived water-temperature estimate.
   v2.4.0 had already adopted MEASURED OR NOTHING for water temperature
   (`waterTempC = null` when no sensor exists; every water rule stands down),
   but this calibrator kept moving the **published** score on the strength of
   the very estimate that had been refused. Removed, not reduced. If a
   water-temperature term returns it must fire only on a measured reading and
   be fitted against labels rather than hand-chosen.

Also: missing coordinates defaulted to `(40, -100)` — the middle of Kansas —
which quietly placed unknown-location scores inside the "Great Lakes" and
"Southern US" bonus boxes. No coordinates now means no location adjustment.

**Stand-down is the new default.** Every one of these rules returns a zero
adjustment with a stated reason when it cannot read what it needs, rather than
falling back to a plausible value. `scoreFromFeatures` gained a `localTime`
parameter; `paddleScoreCompute` passes `weatherData.location.localTime` and
`fastForecast` passes each hour's own `hourData.time`.

### Isotonic recalibration (new: `scoreCalibration.js`)

Measured 2026-09-18 against 187 human labels over 93 lakes (grouped-by-lake
5-fold out-of-fold, seed 42), the expert rule is **biased optimistic**:

| | MAE | bias | over-optimistic |
|---|---|---|---|
| expert rule (as published) | 1.045 | +0.869 | 0.513 |
| rule + isotonic | 0.682 | −0.001 | 0.262 |

A fitted non-decreasing map score → score, applied **between the score
generator and the safety gate**: after the heuristic adjustments (the curve is
fitted against the whole rule stack's output) and before the penalties (which
are absolute safety subtractions and must not be recalibrated away).

Failure policy: missing file, unparseable JSON, non-monotone table, a curve on
a different output scale, or a prediction source the curve was not fitted on →
**identity**, plus a machine-readable reason. Never a default curve. The
artifact is produced in `paddle-llm` and must be copied to
`functions/data/models/isotonic-calibrator-v1.json` as a release step.

Responses now carry `calibrationVersion`, a `scoreCalibration` block
(applied / version / reason / before / after) and `localClock`, so every
published number is traceable to the artifact and the clock that produced it.

### In-process model evaluation (new: `localModel.js`)

`mlService` POSTs every spot-hour to Cloud Run with a 10 s timeout; the
arithmetic is microseconds and the network is hundreds of milliseconds.
`localModel.js` loads a versioned JSON tree-ensemble artifact once per function
instance and evaluates it in pure JS. **Additive** — with no artifact on disk
(the state today) it returns null and the existing remote path runs unchanged.
`PADDLE_LOCAL_MODEL=off` forces remote. An artifact without an `uncertainty`
block is refused: a safety number with no error bar is a bug. Residual models
are refused until the composition order is decided.

### Version drift

`ALGORITHM_VERSION` read `2.0.0` while this changelog had already reached
v2.4.0 — every response has been reporting a version that did not describe the
algorithm serving it. Realigned to this file, which the constant itself names
as the source of truth.

### Expected effect on published scores

Modelled over 12 000 synthetic spot-hours (8 real lakes on five continents ×
12 months × 5 local hours × 5 temperatures × 5 wind speeds), holding the model
prediction at 3.0 and with **no** isotonic artifact present:

- mean published score **3.26 → 3.03** (mean change **−0.23**)
- **77.4%** of spot-hours score lower, 19.5% unchanged, **3.1%** higher
- 5th percentile −0.50, median −0.20, 95th percentile +0.00

The 3.1% that rise (max +0.35) are dominated by southern-hemisphere summer —
Lake Wakatipu in December–February — which is the fix working, not a regression.
Shipping the isotonic artifact on top of this moves scores **further down**
again: on the fitted curve a 3.0 maps to 1.89, a tier change from "Careful" to
"Hard pass".


## v2.4.0 — 2026-09-01

### Water temperature: measured where possible, physically-modelled where not

v2.3.0 removed fabricated marine data but fell back to `todayAvgAir − 8`, which
is not how lakes work and produced a second class of false alarm: **Lake Union
on 31 August estimated 9.2 °C (49 °F) against an actual ~21 °C (70 °F)**, raising
a "Very cold water" alert and telling paddlers to wear a drysuit on a warm
summer lake. Over-warning is not free — it trains people to ignore the warning
that matters.

Three changes:

1. **Measured first.** `hydrologyService.getWaterTemp()` reads USGS parameter
   00010 from a per-spot, hand-reviewed sensor (30-min cache per gauge, stale
   readings >24 h rejected). Requires `USGS_API_KEY` (free); populate with
   `scripts/match-water-temp.js`, reviewing each candidate — proximity is not
   identity (the nearest 00010 site to Diablo Lake is a creek 8.4 km away).

2. **A real climate window when there's no sensor.** Lake surface temperature
   integrates heat over weeks, so the estimate now uses a genuine **30-day mean
   air temperature** (Open-Meteo, free, no key), cached 24 h per ~11 km cell,
   and **serves the last known good value for up to 14 days if the upstream
   call fails** — a transient failure must not silently revert to the bad
   formula. Portfolio effect: alpine lakes 60–62 °F, Seattle 65 °F, Texas
   lakes ~90 °F — all physically plausible, versus a fabricated flat 28.8 °C or
   an air-derived 49 °F before.

3. **Honest thresholds.** The 18 °C "cool water — wear thermal protection"
   warning tier is removed: 16–18 °C is ordinary comfortable paddling water.
   Estimated values say "(estimated)" in the warning text, and the drysuit tip
   requires ≤12 °C on an estimate (vs ≤15 °C measured), because a drysuit is a
   serious instruction and the estimate carries several degrees of error.

`conditions.waterTempEstimated` and `conditions.waterTempSource` (naming the
gauge) ride on every score; the UI marks the reading "· measured" or "· est".

**Result across the 17 curated spots: cold-water warnings 1 → 0**, with every
remaining value physically defensible.

**Eval:** unchanged from v2.3.0 (MAE 0.727, dangerous-recall 0.952) — the
187-label replay supplies its own snapshot water temperatures, so it does not
exercise the estimator. The portfolio check above is the relevant verification.

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
