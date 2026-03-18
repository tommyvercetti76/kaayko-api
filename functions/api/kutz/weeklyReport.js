/**
 * KaleKutz — weeklyReport
 *
 * POST /api/kutz/weeklyReport
 *
 * Reads last 7 days of nutrition data for the authenticated user,
 * sends to Claude for factual analysis, returns report + raw data.
 */

const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

const db = admin.firestore();

async function weeklyReport(req, res) {
  const uid = req.user.uid;

  try {
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
      const day = dayDoc.data();
      const foodsSnap = await dayDoc.ref.collection('foods').get();
      const foods = foodsSnap.docs.map(d => d.data());

      const totals = foods.reduce((acc, f) => ({
        calories: acc.calories + (Number(f.calories) || 0),
        protein: acc.protein + (Number(f.protein) || 0),
        fiber: acc.fiber + (Number(f.fiber) || 0),
      }), { calories: 0, protein: 0, fiber: 0 });

      weekData.push({
        date: day.date,
        calories: Math.round(totals.calories),
        protein: Math.round(totals.protein),
        fiber: Math.round(totals.fiber),
        steps: day.steps || 0,
        locked: day.locked || false,
        foodCount: foods.filter(f => !f.auto).length,
      });
    }

    const prompt = `Here is ${weekData.length} days of nutrition data for a vegetarian female on a fat loss phase targeting ~1650 cal, 110g protein, 25g fiber:\n\n${JSON.stringify(weekData, null, 2)}\n\nProvide a brief factual analysis:\n- Adherence to calorie target (days over/under)\n- Protein consistency (days below 100g)\n- Any suspicious entries (unusually high/low days)\n- Estimated weekly deficit in kcal\n\nBe precise. No motivational language. No coaching.`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const report = message.content.map(c => c.text || '').join('').trim();

    return res.json({ success: true, data: { report, weekData } });
  } catch (e) {
    console.error('[kutz/weeklyReport] Error:', e.message);
    return res.status(500).json({
      success: false,
      error: 'Report failed',
      message: 'Unable to generate weekly report. Please try again.',
      code: 'REPORT_ERROR'
    });
  }
}

module.exports = weeklyReport;
