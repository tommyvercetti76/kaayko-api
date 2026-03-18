/**
 * KaleKutz — weeklyReport
 *
 * POST /api/kutz/weeklyReport
 *
 * Reads last 7 days of nutrition data for the authenticated user,
 * sends to Claude for factual analysis, returns report + raw data.
 */

const admin        = require('firebase-admin');
const { callAI }   = require('./aiClient');

const db = admin.firestore();

const DEFAULT_TARGETS = { calories: 1650, protein: 110, carbs: 200, fat: 55, fiber: 25 };

async function weeklyReport(req, res) {
  const uid = req.user.uid;

  try {
    // ── Load user profile ──────────────────────────────────────────────────────
    const profileSnap = await db
      .collection('users').doc(uid)
      .collection('kutzProfile').doc('data')
      .get();

    const profile  = profileSnap.exists ? profileSnap.data() : {};
    const targets  = profile.targets  || DEFAULT_TARGETS;
    const dietType = profile.dietType || 'lacto-ovo-vegetarian';
    const gender   = profile.gender   || 'not specified';

    // ── Load last 7 days ──────────────────────────────────────────────────────
    const daysSnap = await db
      .collection('users').doc(uid)
      .collection('kutzDays')
      .orderBy('date', 'desc')
      .limit(7)
      .get();

    if (daysSnap.empty) {
      return res.json({
        success: true,
        data: { report: 'No data logged yet. Start tracking your meals to see your weekly report.', weekData: [] }
      });
    }

    const weekData = [];

    for (const dayDoc of daysSnap.docs) {
      const day       = dayDoc.data();
      const foodsSnap = await dayDoc.ref.collection('foods').get();
      const foods     = foodsSnap.docs.map(d => d.data());

      const totals = foods.reduce((acc, f) => ({
        calories: acc.calories + (Number(f.calories) || 0),
        protein:  acc.protein  + (Number(f.protein)  || 0),
        carbs:    acc.carbs    + (Number(f.carbs)     || 0),
        fat:      acc.fat      + (Number(f.fat)       || 0),
        fiber:    acc.fiber    + (Number(f.fiber)     || 0),
      }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

      weekData.push({
        date:      day.date,
        calories:  Math.round(totals.calories),
        protein:   Math.round(totals.protein),
        carbs:     Math.round(totals.carbs),
        fat:       Math.round(totals.fat),
        fiber:     Math.round(totals.fiber),
        steps:     day.steps || 0,
        locked:    day.locked || false,
        foodCount: foods.filter(f => !f.auto).length,
      });
    }

    const prompt = `Here is ${weekData.length} days of nutrition data for a ${gender} (diet: ${dietType}) targeting ${targets.calories} kcal, ${targets.protein}g protein, ${targets.carbs}g carbs, ${targets.fat}g fat, ${targets.fiber}g fiber per day:\n\n${JSON.stringify(weekData, null, 2)}\n\nProvide a brief factual analysis:\n- Adherence to calorie target (days over/under)\n- Protein consistency (days below ${Math.round(targets.protein * 0.9)}g)\n- Carb and fat trends vs targets\n- Any suspicious entries (unusually high/low days)\n- Estimated weekly deficit in kcal\n\nBe precise. No motivational language. No coaching.`;

    const report = await callAI({
      task:      'report',
      system:    [],
      messages:  [{ role: 'user', content: prompt }],
      maxTokens: 1000,
    });

    return res.json({ success: true, data: { report, weekData } });

  } catch (e) {
    console.error('[kutz/weeklyReport] Error:', e.message);
    return res.status(500).json({
      success:  false,
      error:    'Report failed',
      message:  'Unable to generate weekly report. Please try again.',
      code:     'REPORT_ERROR',
    });
  }
}

module.exports = weeklyReport;
