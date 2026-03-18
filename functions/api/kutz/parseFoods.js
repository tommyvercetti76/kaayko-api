/**
 * KaleKutz — parseFoods
 *
 * POST /api/kutz/parseFoods
 * Body: { text: string, dietType?: string }
 *
 * 1. Rate-limits 10 requests / minute per uid (in-memory).
 * 2. Loads branded product overrides from kutzProductDB (label-accurate values).
 * 3. Sends text + product context + diet rules to Claude → structured food items.
 * 4. Returns sanitized JSON array including carbs + fat.
 */

const admin    = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

const db = admin.firestore();

// ─── Rate limiter (in-memory, resets on cold start) ───────────────────────────
const rateLimitMap = new Map(); // uid -> { count, windowStart }
const RATE_WINDOW  = 60_000;   // 1 minute
const RATE_MAX     = 10;       // requests per window

function checkRateLimit(uid) {
  const now   = Date.now();
  const entry = rateLimitMap.get(uid) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW) {
    rateLimitMap.set(uid, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  rateLimitMap.set(uid, { ...entry, count: entry.count + 1 });
  return true;
}

// ─── System prompt ────────────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `You are a precise macro-nutrition parser for a high-protein Indian diet tracker.

Parse EVERY food and supplement the user mentions — including protein powders, shakes, seeds, oils, and packaged products.

Return ONLY a valid JSON array. Every item MUST have ALL fields with accurate non-zero values where appropriate:
{"name": string, "quantity": string, "calories": number, "protein": number, "carbs": number, "fat": number, "fiber": number, "meal": "breakfast"|"lunch"|"dinner"|"snacks"}

━━━ CRITICAL: FAT MUST NEVER BE ZERO unless the food genuinely contains no fat ━━━
The following foods ALWAYS have significant fat — use these reference values:
• Full-fat milk / whole milk (1 cup / 240ml): 150 kcal, 8g protein, 12g carbs, 8g fat
• Toned milk / 2% milk (1 cup / 240ml): 120 kcal, 8g protein, 12g carbs, 3g fat
• Skim / low-fat milk (1 cup): 85 kcal, 8g protein, 12g carbs, 1g fat
• Curd / dahi full-fat (1 katori / 150g): 90 kcal, 5g protein, 7g carbs, 4g fat
• Paneer (100g): 265 kcal, 18g protein, 3g carbs, 20g fat
• Ghee (1 tsp / 5g): 45 kcal, 0g protein, 0g carbs, 5g fat
• Ghee (1 tbsp / 14g): 125 kcal, 0g protein, 0g carbs, 14g fat
• Mustard / sunflower / coconut oil (1 tsp): 40 kcal, 0g protein, 0g carbs, 4g fat
• Almonds (10 pieces / 14g): 80 kcal, 3g protein, 3g carbs, 7g fat
• Peanuts (1 tbsp / 15g): 90 kcal, 4g protein, 3g carbs, 8g fat
• Sabzi / dry vegetable dish (1 katori): add ~5-7g fat from cooking oil if not specified
• Dal tadka / dal fry (1 katori / 180ml): add ~6-8g fat from tempering
• Plain roti / chapati (1, ~35g, no ghee): 100 kcal, 3g protein, 20g carbs, 1g fat
• Paratha (1 plain, ~60g): 200 kcal, 4g protein, 30g carbs, 8g fat
• Poha (1 plate / 200g cooked): 250 kcal, 4g protein, 45g carbs, 6g fat
• Upma (1 plate / 200g): 230 kcal, 5g protein, 35g carbs, 7g fat
• ISOPure Zero Carb protein (1 scoop / 31g): 100 kcal, 25g protein, 0g carbs, 0g fat
• ON Gold Standard Whey (1 scoop / 30g): 120 kcal, 24g protein, 3g carbs, 1g fat
• MuscleBlaze Raw Whey (1 scoop / 30g): 120 kcal, 25g protein, 2g carbs, 1g fat

━━━ RULES ━━━
- Use USDA / IFCT (Indian Food Composition Tables) reference values
- Include ALL foods and supplements mentioned — protein powders, shakes, seeds, every ingredient
- If a cooked dish is mentioned without specifying oil/ghee, assume 1 tsp cooking fat was used
- Standard Indian sizes: 1 katori ≈ 150-180ml, 1 medium bowl ≈ 250ml, 1 glass ≈ 200ml
- If quantity is vague ("some", "a bowl", "a little"), use a sensible standard portion
- Round calories to nearest 5; protein / carbs / fat / fiber to nearest 1 (use 1 for trace amounts, never 0 for foods that have inherent fat)
- Infer meal from time cues or context. Default: "snacks"
- For packaged / branded foods, use label values when known
- If truly unable to estimate a food, set all macros to 0 and append " (estimate needed)" to name
- Respond with ONLY the JSON array. No markdown, no explanation, no backticks.`;

// ─── Diet-specific prompt rules ───────────────────────────────────────────────
const DIET_PROMPTS = {
  'lacto-ovo-vegetarian': `
━━━ DIET: LACTO-OVO VEGETARIAN ━━━
The user follows a lacto-ovo vegetarian diet.
- Include: dairy (milk, paneer, curd, cheese, butter, ghee), eggs, all plant foods, honey
- Exclude: meat, poultry, fish, seafood, and products made from them (gelatin, lard, tallow)
- If the user mentions meat or fish, flag by appending " (non-veg — skipped?)" to the name`,

  'lacto-vegetarian': `
━━━ DIET: LACTO VEGETARIAN ━━━
The user follows a lacto-vegetarian diet.
- Include: dairy (milk, paneer, curd, cheese, butter, ghee), all plant foods, honey
- Exclude: meat, poultry, fish, seafood, eggs, and products containing them (mayo with egg, etc.)
- If the user mentions meat, fish, or eggs, flag by appending " (excluded — skipped?)" to the name`,

  'vegan': `
━━━ DIET: VEGAN ━━━
The user follows a strictly vegan diet.
- Include: all plant foods, plant-based milks, plant-based proteins (tofu, tempeh, seitan, legumes)
- Exclude: ALL animal products — meat, poultry, fish, eggs, dairy (milk, paneer, curd, ghee, butter, cheese), honey, gelatin, whey protein
- If the user mentions any animal product, flag by appending " (animal product — skipped?)" to the name
- For protein shakes/powders, assume plant-based (pea, rice, hemp) unless stated otherwise`,

  'non-vegetarian': `
━━━ DIET: NON-VEGETARIAN ━━━
The user eats all foods including meat, poultry, seafood, eggs, and dairy.
- Parse ALL foods as described — no restrictions apply
- Use accurate USDA/IFCT values for chicken, fish, eggs, mutton, etc.
- Common Indian non-veg portions: 1 chicken breast (~120g) = 200 kcal, 36g protein, 0g carbs, 4g fat`,
};

const DEFAULT_DIET = 'lacto-ovo-vegetarian';
const VALID_MEALS  = ['breakfast', 'lunch', 'dinner', 'snacks'];

// ─── Branded product lookup ───────────────────────────────────────────────────
async function getProductContext(uid, text) {
  try {
    const snap = await db
      .collection('users').doc(uid)
      .collection('kutzProductDB')
      .get();

    if (snap.empty) return '';

    const textLower = text.toLowerCase();
    const matches   = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.name && textLower.includes(p.name.toLowerCase().slice(0, 12)));

    if (matches.length === 0) return '';

    const lines = matches.map(p =>
      `- "${p.name}": ${p.calories} kcal, ${p.protein}g protein, ${p.carbs ?? 0}g carbs, ${p.fat ?? 0}g fat, ${p.fiber}g fiber per ${p.per || '100g'} [label-verified]`
    );
    return `\n\nProduct label overrides — use these EXACT values (higher priority than IFCT estimates):\n${lines.join('\n')}`;
  } catch (e) {
    console.warn('[parseFoods] kutzProductDB lookup failed:', e.message);
    return '';
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
async function parseFoods(req, res) {
  const uid      = req.user.uid;
  const { text, dietType = DEFAULT_DIET } = req.body;

  // Rate limit
  if (!checkRateLimit(uid)) {
    return res.status(429).json({
      success: false,
      error:   'Rate limit exceeded',
      message: 'Too many requests — please wait a moment before trying again.',
      code:    'RATE_LIMIT',
    });
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error:   'Invalid input',
      message: 'text field is required',
      code:    'INVALID_INPUT',
    });
  }

  if (text.length > 2000) {
    return res.status(400).json({
      success: false,
      error:   'Input too long',
      message: 'text must be 2000 characters or fewer',
      code:    'INPUT_TOO_LONG',
    });
  }

  try {
    const productContext = await getProductContext(uid, text);
    const dietRule       = DIET_PROMPTS[dietType] || DIET_PROMPTS[DEFAULT_DIET];
    const systemPrompt   = BASE_SYSTEM_PROMPT + dietRule + productContext;

    const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 1200,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: text.trim() }],
    });

    const raw     = message.content.map(c => c.text || '').join('').trim();
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) throw new Error('Claude returned non-array response');

    const foods = parsed.map(f => ({
      name:     String(f.name     || 'Unknown food'),
      quantity: String(f.quantity || '1 serving'),
      calories: Math.max(0, Math.round(Number(f.calories) || 0)),
      protein:  Math.max(0, Math.round(Number(f.protein)  || 0)),
      carbs:    Math.max(0, Math.round(Number(f.carbs)    || 0)),
      fat:      Math.max(0, Math.round(Number(f.fat)      || 0)),
      fiber:    Math.max(0, Math.round(Number(f.fiber)    || 0)),
      meal:     VALID_MEALS.includes(f.meal) ? f.meal : 'snacks',
    }));

    return res.json({ success: true, data: { foods } });

  } catch (e) {
    console.error('[kutz/parseFoods] Error:', e.message);
    return res.status(500).json({
      success: false,
      error:   'Parse failed',
      message: 'Unable to parse food description. Please try again.',
      code:    'PARSE_ERROR',
    });
  }
}

module.exports = parseFoods;

// Exposed for testing only — allows resetting in-memory rate limit state between tests
module.exports._rateLimitMap = rateLimitMap;
