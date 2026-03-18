/**
 * KaleKutz — suggest
 *
 * POST /api/kutz/suggest
 *
 * Reads 30-day history + frequent foods from Firestore, sends to Claude,
 * returns actionable meal suggestions for tomorrow.
 *
 * Response: {
 *   success: true,
 *   data: {
 *     insights: string[],
 *     suggestions: [{ meal, foods, calories, protein, reason }]
 *   }
 * }
 */

const admin    = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

const db = admin.firestore();

async function suggest(req, res) {
  const uid = req.user.uid;

  try {
    // ── 1. Read profile (for targets) ────────────────────────────────────────
    const profileSnap = await db
      .collection('users').doc(uid)
      .collection('kutzProfile').doc('data')
      .get();
    const profile = profileSnap.exists ? profileSnap.data() : {};
    const targets = {
      calories: profile.targets?.calories ?? 1650,
      protein:  profile.targets?.protein  ?? 110,
      fiber:    profile.targets?.fiber    ?? 25,
    };

    // ── 2. Read last 30 days ─────────────────────────────────────────────────
    const daysSnap = await db
      .collection('users').doc(uid)
      .collection('kutzDays')
      .orderBy('date', 'desc')
      .limit(30)
      .get();

    if (daysSnap.empty) {
      return res.json({
        success: true,
        data: {
          insights: ['No data yet — start logging to get personalised suggestions.'],
          suggestions: [],
        },
      });
    }

    const dayData = [];
    for (const dayDoc of daysSnap.docs) {
      const day = dayDoc.data();

      // Use denormalized totals if available (fast), else aggregate
      if (day.totals) {
        dayData.push({
          date:     day.date,
          calories: Math.round(day.totals.calories || 0),
          protein:  Math.round(day.totals.protein  || 0),
          fiber:    Math.round(day.totals.fiber     || 0),
        });
      } else {
        const foodsSnap = await dayDoc.ref.collection('foods').get();
        const totals = foodsSnap.docs.reduce(
          (acc, d) => {
            const f = d.data();
            return {
              calories: acc.calories + (Number(f.calories) || 0),
              protein:  acc.protein  + (Number(f.protein)  || 0),
              fiber:    acc.fiber    + (Number(f.fiber)     || 0),
            };
          },
          { calories: 0, protein: 0, fiber: 0 }
        );
        dayData.push({ date: day.date, ...totals });
      }
    }

    // ── 3. Read frequent foods ────────────────────────────────────────────────
    const freqSnap = await db
      .collection('users').doc(uid)
      .collection('kutzFrequentFoods')
      .orderBy('useCount', 'desc')
      .limit(15)
      .get();

    const frequentFoods = freqSnap.docs.map(d => {
      const f = d.data();
      return `${f.name} (~${f.calories} kcal, ${f.protein}g protein)`;
    });

    // ── 4. Compute quick stats for context ───────────────────────────────────
    const n = dayData.length;
    const avgProtein  = Math.round(dayData.reduce((s, d) => s + d.protein,  0) / n);
    const avgCalories = Math.round(dayData.reduce((s, d) => s + d.calories, 0) / n);
    const daysHitProtein = dayData.filter(d => d.protein >= targets.protein).length;

    // ── 5. Build Claude prompt ────────────────────────────────────────────────
    const prompt = `You are analyzing ${n} days of nutrition data for a vegetarian female targeting ${targets.calories} kcal, ${targets.protein}g protein, ${targets.fiber}g fiber daily.

Stats over last ${n} days:
- Average daily calories: ${avgCalories} kcal (target: ${targets.calories})
- Average daily protein: ${avgProtein}g (target: ${targets.protein}g)
- Days hitting protein target (≥${targets.protein}g): ${daysHitProtein}/${n}

Foods she eats most often: ${frequentFoods.join(', ') || 'not enough data yet'}

Recent daily data (newest first):
${JSON.stringify(dayData.slice(0, 14), null, 2)}

Return a JSON object with this exact shape:
{
  "insights": ["string", "string"],
  "suggestions": [
    {
      "meal": "breakfast|lunch|dinner|snacks",
      "foods": "specific food description using foods she actually eats",
      "calories": number,
      "protein": number,
      "reason": "one sentence explaining the protein/calorie impact"
    }
  ]
}

Rules:
- insights: 2-3 short factual observations based on the data (no motivation, no coaching)
- suggestions: 3-4 concrete meal ideas for tomorrow
- Use ONLY foods from her frequent foods list or known Indian vegetarian foods
- Focus on closing the protein gap if avgProtein < ${targets.protein}
- Each suggestion must have non-zero calories and protein
- Return ONLY the JSON. No markdown. No explanation.`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-5-20250929',
      max_tokens: 1200,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw     = message.content.map(c => c.text || '').join('').trim();
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
