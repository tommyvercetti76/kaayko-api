// functions/api/weather/paddleTips.js
//
// Preparation-tips engine: actionable "what to bring / what to do" advice,
// distinct from hazard warnings (smartWarnings) which say "what could hurt you".
// Pure function over cached conditions + spot enrichment + craft — computed
// post-cache at request time, never stored.
//
// Every tip is grounded in real data on hand; no data → no tip. Values ride in
// a structured `values` object (metric) so the client formats per units pref
// via KaaykoPrefs — no unit strings are baked into tip text server-side.

const { CRAFT_PROFILES, sanitizeCraft } = require('./craftAdjustments');

const KPH_TO_MPH = 0.621371;

/**
 * NWS Rothfusz heat index (input/output °F) — applied above 80°F.
 */
function heatIndexF(tF, rh) {
  if (tF < 80 || rh < 40) return tF;
  let hi = -42.379 + 2.04901523 * tF + 10.14333127 * rh
    - 0.22475541 * tF * rh - 0.00683783 * tF * tF - 0.05481717 * rh * rh
    + 0.00122874 * tF * tF * rh + 0.00085282 * tF * rh * rh - 0.00000199 * tF * tF * rh * rh;
  return hi;
}

/** Craft-specific wind advice — practical technique, not restatement of the number. */
const CRAFT_WIND_ADVICE = {
  kayak:      'Start your paddle upwind so the return leg is the easy one',
  canoe:      'Trim bow-heavy and hug the windward shore — an open hull catches gusts',
  sup:        'Kneel in gusts, start upwind, and stay near the lee shore',
  row:        'Set up so the wind pushes you home, not out',
  pedal:      'Stay within easy return distance — upwind progress is poor in a pedal boat',
  inflatable: 'Stay close to shore — a light hull drifts fast when you stop paddling'
};

/**
 * @param {object} params
 * @param {object} params.conditions  Cached score conditions (temperature °C, windSpeed/gustSpeed KPH, humidity, uvIndex, cloudCover, waterTemp °C)
 * @param {string} params.craft      Craft id (sanitized internally)
 * @param {object} [params.spot]     Spot doc fields (cellCoverage, localTips)
 * @param {object} [params.hydrology] Live river data (Phase 6: {pctOfNormalBand})
 * @param {Array}  [params.warningMessages] Active warning strings (dedupes the UV tip)
 * @returns {Array<{code, priority, icon, title, detail, values?}>} sorted, max 4
 */
function getPreparationTips({ conditions, craft, spot = null, hydrology = null, warningMessages = [] } = {}) {
  if (!conditions) return [];
  const tips = [];
  const tempC = Number(conditions.temperature);
  const humidity = Number(conditions.humidity);
  const windMph = (Number(conditions.windSpeed) || 0) * KPH_TO_MPH;
  const uv = Number(conditions.uvIndex);
  const cloud = Number(conditions.cloudCover);
  const waterC = Number(conditions.waterTemp);
  const craftId = sanitizeCraft(craft);
  const profile = CRAFT_PROFILES[craftId];

  // NIGHT — Kaayko does not score night paddling (methodology + terms).
  // Always first when it applies: nothing else on the list matters after dark.
  if (conditions.isDay === false) {
    tips.push({
      code: 'NIGHT',
      priority: 1,
      icon: 'alert',
      title: 'After dark — not scored',
      detail: 'Kaayko scores daylight paddling only. Wait for first light; if you are on the water, head in.'
    });
  }

  // HYDRATION — rate from heat index, planned for a 2-hour outing
  if (Number.isFinite(tempC)) {
    const hiC = Number.isFinite(humidity)
      ? (heatIndexF(tempC * 9 / 5 + 32, humidity) - 32) * 5 / 9
      : tempC;
    let litersPerHour = null;
    if (hiC >= 32) litersPerHour = 1.0;
    else if (hiC >= 27) litersPerHour = 0.75;
    else if (tempC >= 20) litersPerHour = 0.5;
    if (litersPerHour) {
      tips.push({
        code: 'HYDRATION',
        priority: hiC >= 32 ? 1 : 2,
        icon: 'droplet',
        title: 'Bring water',
        detail: 'Plan {water} for a 2-hour outing in this heat',
        values: { waterLiters: Math.round(litersPerHour * 2 * 10) / 10 }
      });
    }
  }

  // OFFLINE MAPS — only when FCC-derived coverage says signal is weak
  const grade = spot?.cellCoverage?.grade;
  if (grade === 'patchy' || grade === 'none') {
    tips.push({
      code: 'OFFLINE_MAPS',
      priority: 1,
      icon: 'pin',
      title: grade === 'none' ? 'No signal at the water' : 'Sketchy network out there',
      detail: 'Download offline maps before you leave the trailhead'
    });
  }

  // CRAFT WIND — at this craft's caution band (kayak baseline: 15 mph)
  const caution = profile.identity ? 15 : profile.windCaution;
  const strong = profile.identity ? 20 : profile.windStrong;
  if (Number.isFinite(windMph) && windMph >= caution) {
    tips.push({
      code: 'CRAFT_WIND',
      priority: windMph >= strong ? 1 : 2,
      icon: 'wind',
      title: `Wind plan for your ${profile.label.toLowerCase()}`,
      detail: CRAFT_WIND_ADVICE[craftId]
    });
  }

  // COLD WATER — MEASURED ONLY. `waterC` is null unless a sensor covers this
  // water. Telling someone to wear a drysuit is a serious instruction and it
  // must rest on a reading; we said it on a 70 °F lake once, from a guess.
  if (Number.isFinite(waterC) && waterC < 15) {
    tips.push({
      code: 'COLD_WATER',
      priority: 1,
      icon: 'thermometer',
      title: 'Dress for the water, not the air',
      detail: 'Wetsuit or drysuit, plus a dry bag with a full change of clothes'
    });
  }

  // SUN — suppressed when a UV hazard warning already fired (no double messaging)
  const uvWarned = warningMessages.some(m => /uv/i.test(String(m)));
  if (!uvWarned && Number.isFinite(uv) && uv >= 6 && Number.isFinite(cloud) && cloud <= 40) {
    tips.push({
      code: 'SUN',
      priority: 2,
      icon: 'sun',
      title: 'High UV window',
      detail: 'SPF, a hat, and reapply on the water'
    });
  }

  // RIVER FLOW — Phase 6 wiring; inert until live hydrology exists
  if (hydrology?.pctOfNormalBand === 'high' || hydrology?.pctOfNormalBand === 'above') {
    tips.push({
      code: 'FLOW_HIGH',
      priority: 1,
      icon: 'gauge',
      title: 'River running above normal',
      detail: 'Scout your takeouts before launching — current is stronger than usual'
    });
  } else if (hydrology?.pctOfNormalBand === 'low') {
    tips.push({
      code: 'FLOW_LOW',
      priority: 2,
      icon: 'gauge',
      title: 'Low water',
      detail: 'Expect dragging near put-ins and exposed obstacles'
    });
  }

  // LOCAL — first editorial hazard note not already covered above
  const hazardTip = (spot?.localTips || []).find(t => t && t.category === 'hazard' && t.text);
  if (hazardTip) {
    tips.push({ code: 'LOCAL', priority: 3, icon: 'info', title: 'Local knowledge', detail: String(hazardTip.text) });
  }

  return tips.sort((a, b) => a.priority - b.priority).slice(0, 4);
}

/**
 * Render a tip's detail text with its structured values substituted.
 *
 * Web clients keep the raw `{token}` + metric `values` and format per the
 * viewer's unit preference (KaaykoPrefs). API consumers have no such layer, so
 * server-side surfaces (gptActions, /v1) must render finished text or they ship
 * a literal "{water}" to the caller.
 *
 * @param {object} tip
 * @param {object} [opts]
 * @param {boolean} [opts.imperial=false] render in imperial units
 */
function renderTipDetail(tip, opts = {}) {
  let detail = String(tip?.detail || '');
  const v = tip?.values || {};
  if (v.waterLiters != null) {
    const text = opts.imperial
      ? `~${Math.round(v.waterLiters * 33.814 / 8) * 8} fl oz`
      : `${Number(v.waterLiters).toFixed(1)} L`;
    detail = detail.replace('{water}', text);
  }
  return detail;
}

module.exports = { getPreparationTips, renderTipDetail };
