# Paddle Score Evaluation Protocol & Results

How scoring changes are validated, what the numbers mean, and where the guardrails
are. Companion to `ALGORITHM_CHANGELOG.md`. Latest machine-readable results:
`docs/label-replay-latest.json`.

## The 187-label canary

The ground-truth set is 187 human ratings (single expert rater, kayak baseline —
confirmed: 186/187 rows carry `boatType: kayak`) over real historical weather
rows, stored read-only in `paddle-llm-private/human-ratings/ratings.jsonl`.
Label distribution: 1★×73 · 2★×31 · 3★×23 · 4★×45 · 5★×15 → tiers: Hard pass 104 /
Careful 23 / Worth it 60.

**Replay:** `node scripts/replay-labels.js` runs every row through the CURRENT
production pipeline — real standardization, the real Cloud Run ML model, real
calibration and penalties (marine context synthesized from each row's snapshot).
It is a **directional regression canary, not a calibration source**: 23 rows in
the Careful band is a ±~18 pp confidence interval, far too thin to re-derive tier
thresholds. Labels are never used as training data (locked decision).

### Results — algorithm v2.2.1, replayed 2026-09-01 (n=187, 100% real ML service)

| Metric | Value | Reading |
|---|---|---|
| MAE (precise rating vs label) | **0.728** | typical miss under ¾ star |
| Bias (mean signed error) | **−0.055** | essentially unbiased, slightly cautious |
| Tier agreement | **63.6%** | see confusion below — misses skew conservative |
| **Dangerous-condition recall** | **95.2%** | of the 104 days labeled ≤2★, only 5 published as "Worth it" |
| Two-tier over-optimism | **2.7%** | "Worth it" published on a "Hard pass" day: 5/187 |

Confusion (label rows → pipeline columns): Hard pass 85/14/5 · Careful 7/10/6 ·
Worth it 16/20/24. The dominant error mode is **conservatism** — 36 of 60
"Worth it" days scored lower than the label, while only 5 dangerous days scored
high. That asymmetry is the intended safety posture.

**Context:** the parked paddle-llm RandomForest failed its own promotion gate on
dangerous-condition recall (0.818 < 0.90). The production rules-gated pipeline
clears that same bar at 0.952 — the layered penalties, not the regressor alone,
carry the safety property.

### Known replay limitations (hold these when comparing runs)
- Seasonal/trend calibration adjusters read the runtime clock, not each row's
  date — up to ±0.2 fidelity drift on out-of-season rows.
- `hasWarnings` is not captured in label snapshots (replayed as false), so the
  alerts penalty never fires in replay.
- Snapshot water temp / wave height are the trainer's estimates, not marine API
  readings.

## Per-change protocol

1. Any change to scoring semantics bumps `ALGORITHM_VERSION` and gets a
   changelog entry (rationale + citations).
2. Run the replay before deploy; compare MAE / dangerous-recall / over-optimism
   against the previous `label-replay-latest.json`. Dangerous recall may not
   drop below 0.90; over-optimism may not rise above 5%.
3. Post-deploy, watch the live guardrail for a week: `paddle_model_metrics`
   (MAE/RMSE/bias from real-user feedback via `aggregatePaddleFeedback`) and the
   `enrichment` block on `GET /paddleScore/metrics`.
4. The craft layer is expert-rules-with-citations (no per-craft labels exist).
   It is monitored through craft-tagged public ratings (`sanitizeProfile`
   stores craft) until per-craft samples justify formal evaluation.

## Un-parking the paddle-llm model

Per the audit verdict: revisit only at ≥500 labels across ≥25 cohort lakes AND
7/7 promotion gates passing on the fixed holdout (`paddle-llm/pipeline/
gate_check.py`). Until then the JS pipeline + Cloud Run sklearn model is the
production system of record, and `paddleLlmClient.js` stays dormant behind an
unset `PADDLE_LLM_URL`.
