#!/usr/bin/env node
// functions/scripts/replay-labels.js
//
// Regression canary: replay Rohan's 187 human labels (paddle-llm-private,
// read-only) through the CURRENT production scoring pipeline — real ML service,
// real calibration, real penalties — and report MAE, tier agreement, and the
// safety metrics that matter (dangerous-condition recall, over-optimism rate).
//
// Directional check, not calibration: 23 "Careful"-band labels is not enough to
// re-derive thresholds (see docs/EVALS.md). Never used as training data.
//
// Usage: node scripts/replay-labels.js [path/to/ratings.jsonl]
// Requires ML_SERVICE_URL in functions/.env (real model) — falls back to rules.

require('dotenv').config();
const fs = require('fs');
const { standardizeForMLModel } = require('../api/weather/dataStandardization');
const { scoreFromFeatures } = require('../api/weather/scoringPipeline');
const { getInterpretation } = require('../api/weather/scoringConstants');

const LABELS = process.argv[2] || '/Users/Rohan/Kaayko_v6/paddle-llm-private/human-ratings/ratings.jsonl';

function tierOf(x) { return getInterpretation(x); }
function labelTier(r) { return r >= 4 ? 'Worth it' : r >= 3 ? 'Careful' : 'Hard pass'; }

async function main() {
  const rows = fs.readFileSync(LABELS, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  console.log(`Replaying ${rows.length} labels through the live pipeline…`);

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const w = r.weatherSnapshot || {};
    const hour = parseInt(String(r.time || '12:00').split(':')[0], 10) || 12;

    // Marine-shaped hour from the snapshot's estimated water/wave context
    const marineHour = {
      water_temp_c: w.estimated_water_temp_c,
      sig_ht_mt: w.estimated_wave_height_m,
      swell_ht_mt: w.swell_height_m,
      swell_period_secs: w.swell_period_s,
      swell_dir: w.swell_dir
    };

    const mlFeatures = standardizeForMLModel({
      temperature: w.temp_c,
      windSpeedKph: w.wind_kph,
      gustSpeedKph: w.gust_kph,
      humidity: w.humidity,
      cloudCover: w.cloud,
      uvIndex: w.uv,
      visibility: w.vis_km,
      precipMm: w.precip_mm,
      hasWarnings: false,             // alerts not captured in snapshots
      hour,
      month: w.month,
      latitude: w.latitude,
      longitude: w.longitude
    }, null, marineHour);

    try {
      const score = await scoreFromFeatures({
        mlFeatures, marineHour, forecast: null,
        loc: { lat: w.latitude, lng: w.longitude },
        includeWarnings: false
      });
      if (score) {
        results.push({
          lake: r.lake, label: r.rating,
          pipeline: score.rating, precise: score.ratingPrecise,
          labelTier: labelTier(r.rating), pipelineTier: tierOf(score.rating),
          mlUsed: score.mlModelUsed
        });
      }
    } catch (err) {
      console.warn(`row ${i} (${r.lake}): ${err.message}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${rows.length}…`);
  }

  const n = results.length;
  const mae = results.reduce((s, x) => s + Math.abs(x.label - x.precise), 0) / n;
  const bias = results.reduce((s, x) => s + (x.precise - x.label), 0) / n;
  const tierAgree = results.filter(x => x.labelTier === x.pipelineTier).length / n;

  // Safety: of days Rohan labeled dangerous/bad (<=2), how many does the
  // pipeline keep out of "Worth it"? And how often is the pipeline a full tier
  // more optimistic than the label?
  const dangerous = results.filter(x => x.label <= 2);
  const dangerousRecall = dangerous.filter(x => x.pipelineTier !== 'Worth it').length / Math.max(dangerous.length, 1);
  const TIERS = ['Hard pass', 'Careful', 'Worth it'];
  const overOptimistic = results.filter(x => TIERS.indexOf(x.pipelineTier) - TIERS.indexOf(x.labelTier) >= 2).length / n;

  const confusion = {};
  for (const t1 of TIERS) { confusion[t1] = {}; for (const t2 of TIERS) confusion[t1][t2] = 0; }
  results.forEach(x => confusion[x.labelTier][x.pipelineTier]++);

  const mlShare = results.filter(x => x.mlUsed).length / n;

  const report = {
    replayedAt: new Date().toISOString(),
    n, mlServiceShare: +mlShare.toFixed(3),
    mae: +mae.toFixed(3), bias: +bias.toFixed(3),
    tierAgreement: +tierAgree.toFixed(3),
    dangerousConditionRecall: +dangerousRecall.toFixed(3),
    twoTierOverOptimismRate: +overOptimistic.toFixed(4),
    confusion_labelRows_pipelineCols: confusion
  };
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(`${__dirname}/../docs/label-replay-latest.json`, JSON.stringify(report, null, 2) + '\n');
  console.log('Saved to functions/docs/label-replay-latest.json');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
