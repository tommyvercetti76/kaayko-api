/**
 * KaleKutz — suggest
 *
 * POST /api/kutz/suggest
 *
 * Real-time, today-aware meal suggestions.
 * Reads:
 *   1. Today's food log (what's been eaten + remaining macros)
 *   2. Last 14 days of history (pattern learning)
 *   3. Frequent foods (quick-add favorites)
 *   4. Weight log (last 14 entries → adaptive calorie hint)
 */

const admin      = require('firebase-admin');
const { callAI } = require('./aiClient');

const db = admin.firestore();

// ─── Weight trend helper ──────────────────────────────────────────────────────
async function getWeightTrend(uid) {
  try {
    const snap = await db
      .collection('users').doc(uid)
      .collection('kutzWeightLog')
      .orderBy('date', 'asc')
      .limit(14)
      .get();

    if (snap.size < 3) return null;

    const entries = snap.docs.map(d => ({ date: d.data().date, kg: Number(d.data().kg) || 0 }));
    const mid     = Math.floor(entries.length / 2);
    const first   = entries.slice(0, mid);
    const second  = entries.slice(mid);

    const avgFirst  = first.reduce((s, e) => s + e.kg, 0)  / first.length;
    const avgSecond = second.reduce((s, e) => s + e.kg, 0) / second.length;

    const daySpan      = Math.max(1, (new Date(entries[entries.length - 1].date) - new Date(entries[0].date)) / 86_400_000);
    const weeklyRateKg = ((avgSecond - avgFirst) / daySpan) * 7;

    return { weeklyRateKg: Math.round(weeklyRateKg * 100) / 100, dataPoints: entries.length };
  } catch {
    return null;
  }
}

// ─── Adaptive calorie hint ────────────────────────────────────────────────────
function buildWeightHint(trend, targets) {
  if (!trend) return '';
  const { weeklyRateKg } = trend;
  if (weeklyRateKg < -0.6) {
    const surplusKcal = Math.round(Math.abs(weeklyRateKg + 0.5) * 7700 / 7);
    return `\n⚠️ WEIGHT TREND: Losing ${Math.abs(weeklyRateKg).toFixed(1)} kg/wk — too fast. Consider adding ~${surplusKcal} kcal/day to stay sustainable.`;
  }
  if (weeklyRateKg > 0.1) {
    return `\n⚠️ WEIGHT TREND: Gaining ${weeklyRateKg.toFixed(1)} kg/wk despite target deficit — check adherence or recalculate targets.`;
  }
  if (weeklyRateKg >= -0.6 && weeklyRateKg <= -0.15) {
    return `\n✓ WEIGHT TREND: On track — losing ${Math.abs(weeklyRateKg).toFixed(1)} kg/wk sustainably.`;
  }
  return '';
}

async function suggest(req, res) {
  const uid = req.user.uid;

  try {
    // ── 1. Profile + targets ─────────────────────────────────────────────────
    const profileSnap = await db
      .collection('users').doc(uid)
      .collection('kutzProfile').doc('data')
      .get();
    const profile = profileSnap.exists ? profileSnap.data() : {};
    const targets = {
      calories: profile.targets?.calories ?? 1650,
      protein:  profile.targets?.protein  ?? 110,
      carbs:    profile.targets?.carbs    ?? 200,
      fat:      profile.targets?.fat      ?? 55,
      fiber:    profile.targets?.fiber    ?? 25,
    };
    const dietType = profile.dietType || 'lacto-ovo-vegetarian';

    // ── 2. Today's log ───────────────────────────────────────────────────────
    const todayKey  = new Date().toISOString().slice(0, 10);
    const todaySnap = await db
      .collection('users').doc(uid)
      .collection('kutzDays').doc(todayKey)
      .get();

    const todayTotals = todaySnap.exists
      ? todaySnap.data().totals || {}
      : { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

    const todayFoodsSnap = await db
      .collection('users').doc(uid)
      .collection('kutzDays').doc(todayKey)
      .collection('foods')
      .get();

    const todayFoods = todayFoodsSnap.docs
      .map(d => d.data())
      .filter(f => !f.auto)
      .map(f => `${f.name} (${f.meal}, ${f.calories} kcal, ${f.protein}g prot)`)
      .join('; ') || 'nothing logged yet';

    const remaining = {
      calories: Math.max(0, targets.calories - Math.round(todayTotals.calories || 0)),
      protein:  Math.max(0, targets.protein  - Math.round(todayTotals.protein  || 0)),
      carbs:    Math.max(0, targets.carbs    - Math.round(todayTotals.carbs    || 0)),
      fat:      Math.max(0, targets.fat      - Math.round(todayTotals.fat      || 0)),
      fiber:    Math.max(0, targets.fiber    - Math.round(todayTotals.fiber    || 0)),
    };

    // ── 3. History (last 14 days) ────────────────────────────────────────────
    const historySnap = await db
      .collection('users').doc(uid)
      .collection('kutzDays')
      .orderBy('date', 'desc')
      .limit(15)
      .get();

    const mealPatterns = { breakfast: [], lunch: [], dinner: [], snacks: [] };
    const macroHistory = [];

    for (const dayDoc of historySnap.docs) {
      const day = dayDoc.data();
      if (day.date === todayKey) continue;

      if (day.totals) {
        macroHistory.push({
          calories: Math.round(day.totals.calories || 0),
          protein:  Math.round(day.totals.protein  || 0),
          fiber:    Math.round(day.totals.fiber    || 0),
        });
      }

      const foodsSnap = await dayDoc.ref.collection('foods').get();
      foodsSnap.docs.forEach(fd => {
        const f = fd.data();
        if (!f.auto && f.meal && mealPatterns[f.meal]) {
          mealPatterns[f.meal].push(f.name);
        }
      });
    }

    // Top foods per meal
    const topPerMeal = {};
    for (const [meal, foods] of Object.entries(mealPatterns)) {
      const freq = {};
      foods.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
      topPerMeal[meal] = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name)
        .join(', ') || 'no data yet';
    }

    const n           = macroHistory.length || 1;
    const avgProtein  = Math.round(macroHistory.reduce((s, d) => s + d.protein,  0) / n);
    const avgCalories = Math.round(macroHistory.reduce((s, d) => s + d.calories, 0) / n);
    const daysHitProt = macroHistory.filter(d => d.protein >= targets.protein).length;

    // ── 4. Frequent foods ────────────────────────────────────────────────────
    const freqSnap = await db
      .collection('users').doc(uid)
      .collection('kutzFrequentFoods')
      .orderBy('useCount', 'desc')
      .limit(12)
      .get();

    const frequentFoods = freqSnap.docs
      .map(d => {
        const f = d.data();
        return `${f.name} (${f.calories} kcal, ${f.protein}g prot, ${f.carbs ?? 0}g carbs, ${f.fat ?? 0}g fat)`;
      })
      .join('\n') || 'none yet';

    // ── 5. Weight trend ──────────────────────────────────────────────────────
    const weightTrend = await getWeightTrend(uid);
    const weightHint  = buildWeightHint(weightTrend, targets);

    // ── 6. Time context (IST) ────────────────────────────────────────────────
    const utcHour  = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
    const istHour  = Math.floor((utcHour + 5.5) % 24);
    const nextMeal = istHour < 10 ? 'breakfast'
                   : istHour < 14 ? 'lunch'
                   : istHour < 19 ? 'snacks'
                   : 'dinner';

    // ── 7. Claude (Haiku — high-frequency, advisory only) ────────────────────
    const DIET_LABELS = {
      'lacto-ovo-vegetarian': 'lacto-ovo vegetarian (no meat/fish — dairy and eggs OK)',
      'lacto-vegetarian':     'lacto vegetarian (no meat/fish/eggs — dairy OK)',
      'vegan':                'vegan (no animal products of any kind)',
      'non-vegetarian':       'non-vegetarian (all foods including meat, poultry, seafood)',
    };
    const dietLabel    = DIET_LABELS[dietType] || DIET_LABELS['lacto-ovo-vegetarian'];
    const systemPrompt = `You are a data-driven nutrition coach in a food tracker app. You analyze a user's actual eating history and give hyper-specific, actionable meal suggestions — not generic advice. No motivation language. Just food, quantities, and macros.

CRITICAL: The user is ${dietLabel}. ALL suggestions MUST strictly respect this diet. Never suggest foods outside this diet.`;

    const userMessage = `DAILY TARGETS: ${targets.calories} kcal | ${targets.protein}g protein | ${targets.carbs}g carbs | ${targets.fat}g fat | ${targets.fiber}g fiber

TODAY SO FAR:
Eaten: ${todayFoods}
Consumed: ${Math.round(todayTotals.calories || 0)} kcal | ${Math.round(todayTotals.protein || 0)}g prot | ${Math.round(todayTotals.carbs || 0)}g carbs | ${Math.round(todayTotals.fat || 0)}g fat | ${Math.round(todayTotals.fiber || 0)}g fiber
Remaining: ${remaining.calories} kcal | ${remaining.protein}g prot | ${remaining.carbs}g carbs | ${remaining.fat}g fat | ${remaining.fiber}g fiber
Current meal time: ${nextMeal} (IST)

HISTORICAL AVERAGES (last ${n} days):
Avg: ${avgCalories} kcal | ${avgProtein}g protein
Hit protein target: ${daysHitProt}/${n} days

Typical foods by meal:
- Breakfast: ${topPerMeal.breakfast}
- Lunch: ${topPerMeal.lunch}
- Dinner: ${topPerMeal.dinner}
- Snacks: ${topPerMeal.snacks}

MOST-USED FOODS:
${frequentFoods}
${weightHint}
Return ONLY a JSON object:
{
  "insights": ["string", "string"],
  "suggestions": [
    {
      "meal": "${nextMeal}",
      "label": "short name",
      "foods": "specific foods + quantities",
      "calories": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "fiber": number,
      "reason": "one sentence: what gap this fills"
    }
  ]
}

Rules:
- insights: 2 short data-backed statements (e.g. "45g protein remaining", "Fiber on track at 18/25g")
- suggestions: 2-3 options for ${nextMeal} using foods from her history where possible
- All macros must be accurate and internally consistent
- Suggestions should fit within remaining macros
- Respond ONLY with the JSON. No markdown, no backticks.`;

    const raw     = await callAI({
      task:     'suggest',
      system:   systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1000,
    });
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned);

    return res.json({
      success: true,
      data: {
        insights:    Array.isArray(parsed.insights)    ? parsed.insights    : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      },
    });

  } catch (e) {
    console.error('[kutz/suggest] Error:', e.message);
    return res.status(500).json({
      success: false,
      error:   'Suggest failed',
      message: 'Unable to generate suggestions. Please try again.',
      code:    'SUGGEST_ERROR',
    });
  }
}

module.exports = suggest;
