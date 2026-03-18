/**
 * KaleKutz — parsePhoto
 *
 * POST /api/kutz/parsePhoto
 * Body: { imageBase64: string, mimeType: 'image/jpeg'|'image/png'|'image/webp', dietType?: string }
 *
 * Sends a base64-encoded food photo to Claude vision (Sonnet) and returns
 * the same structured food array as parseFoods.
 *
 * Shares rate limiter, sanitization logic, and system prompt with parseFoods.
 */

const { callAI }     = require('./aiClient');

// Re-use the same rate limiter from parseFoods (same bucket — photo + text share limit)
const parseFoodsModule = require('./parseFoods');
const rateLimitMap     = parseFoodsModule._rateLimitMap;

const RATE_WINDOW = 60_000;
const RATE_MAX    = 10;

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

const VALID_MEALS  = ['breakfast', 'lunch', 'dinner', 'snacks'];
const DEFAULT_DIET = 'lacto-ovo-vegetarian';

// ─── System prompt (same base as parseFoods + diet rule) ─────────────────────
const BASE_SYSTEM_PROMPT = `You are a precise macro- and micronutrient parser. Parse any food from any cuisine or cultural background.

Examine the photo carefully and identify every visible food item.

Return ONLY a valid JSON array. Every item MUST have ALL fields with accurate non-zero values where appropriate:
{"name": string, "quantity": string, "calories": number, "protein": number, "carbs": number, "fat": number, "fiber": number, "iron": number, "calcium": number, "b12": number, "zinc": number, "meal": "breakfast"|"lunch"|"dinner"|"snacks"}

Units for micronutrients: iron (mg), calcium (mg), b12 (mcg), zinc (mg). Use 0 if genuinely absent.

━━━ CRITICAL: FAT MUST NEVER BE ZERO unless the food genuinely contains no fat ━━━
• Full-fat milk / whole milk (1 cup / 240ml): 150 kcal, 8g protein, 12g carbs, 8g fat, Ca 300mg, B12 1.2mcg
• Curd / dahi full-fat (1 katori / 150g): 90 kcal, 5g protein, 7g carbs, 4g fat, Ca 180mg
• Paneer (100g): 265 kcal, 18g protein, 3g carbs, 20g fat, Fe 0.3mg, Ca 480mg, B12 0.4mcg, Zn 2.5mg
• Ghee (1 tsp / 5g): 45 kcal, 0g protein, 0g carbs, 5g fat
• Egg (1 large): 70 kcal, 6g protein, 0g carbs, 5g fat, Fe 0.9mg, Ca 25mg, B12 0.6mcg, Zn 0.5mg
• Dal tadka (1 katori / 180ml): ~200 kcal, 10g protein, 30g carbs, 7g fat, Fe 3.0mg
• Plain roti (1, ~35g): 100 kcal, 3g protein, 20g carbs, 1g fat, Fe 0.8mg
• Paratha (1 plain, ~60g): 200 kcal, 4g protein, 30g carbs, 8g fat
• Rice (1 cup cooked / 180g): 240 kcal, 5g protein, 52g carbs, 0g fat
• Spinach / palak (100g): 23 kcal, 3g protein, 4g carbs, 0g fat, Fe 2.7mg, Ca 99mg

━━━ RULES ━━━
- Use the most accurate available data for the food's cultural origin — IFCT, USDA, CIQUAL, BLS, or regional equivalents
- Estimate portion sizes visually (plate size, serving vessels, density cues)
- Accept any unit — grams, oz, ml, cups, pieces, katori. Preserve descriptive quantity in output.
- If a dish appears to contain cooking oil/ghee that is not visible, include fat from tempering (~1 tsp)
- Round calories to nearest 5; protein/carbs/fat/fiber to nearest 1; micronutrients to 1 decimal place
- Infer meal from visual context (breakfast plate setup, dinner spread, etc.). Default: "snacks"
- If a food is ambiguous or unclear, include it with a note in name (e.g., "Mixed curry (estimate needed)")
- Respond with ONLY the JSON array. No markdown, no explanation, no backticks.`;

const DIET_PROMPTS = {
  'lacto-ovo-vegetarian': `
━━━ DIET: LACTO-OVO VEGETARIAN ━━━
- Include: dairy, eggs, all plant foods
- Exclude: meat, poultry, fish, seafood
- If you see meat or fish, flag by appending " (non-veg — skipped?)" to the name`,

  'lacto-vegetarian': `
━━━ DIET: LACTO VEGETARIAN ━━━
- Include: dairy, all plant foods
- Exclude: meat, poultry, fish, seafood, eggs
- If you see meat, fish, or eggs, flag by appending " (excluded — skipped?)" to the name`,

  'vegan': `
━━━ DIET: VEGAN ━━━
- Include: all plant foods, plant-based milks and proteins
- Exclude: ALL animal products — meat, fish, eggs, dairy, ghee, honey
- If you see any animal product, flag by appending " (animal product — skipped?)" to the name`,

  'non-vegetarian': `
━━━ DIET: NON-VEGETARIAN ━━━
- Parse ALL visible foods — no restrictions apply
- Use accurate values for chicken, fish, eggs, meat, etc.`,
};

// ─── Handler ──────────────────────────────────────────────────────────────────
async function parsePhoto(req, res) {
  const uid = req.user.uid;
  const { imageBase64, mimeType, dietType = DEFAULT_DIET } = req.body;

  // Rate limit (shared bucket with parseFoods)
  if (!checkRateLimit(uid)) {
    return res.status(429).json({
      success: false,
      error:   'Rate limit exceeded',
      message: 'Too many requests — please wait a moment before trying again.',
      code:    'RATE_LIMIT',
    });
  }

  // Validation
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({
      success: false,
      error:   'Invalid input',
      message: 'imageBase64 field is required and must be a string',
      code:    'INVALID_INPUT',
    });
  }

  if (imageBase64.length > 5_000_000) {
    return res.status(400).json({
      success: false,
      error:   'Image too large',
      message: 'Image must be under ~3.5MB (base64)',
      code:    'IMAGE_TOO_LARGE',
    });
  }

  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const mediaType  = validTypes.includes(mimeType) ? mimeType : 'image/jpeg';

  try {
    const dietRule   = DIET_PROMPTS[dietType] || DIET_PROMPTS[DEFAULT_DIET];
    const systemText = BASE_SYSTEM_PROMPT + dietRule;

    // Vision message: image block + text instruction
    const userContent = [
      {
        type:   'image',
        source: {
          type:       'base64',
          media_type: mediaType,
          data:       imageBase64,
        },
      },
      {
        type: 'text',
        text: 'Parse all food visible in this photo. Return the JSON array as instructed.',
      },
    ];

    const raw = await callAI({
      task:     'photo',
      system:   [{ type: 'text', text: systemText }],
      messages: [{ role: 'user', content: userContent }],
    });

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
      iron:     Math.round((Number(f.iron)    || 0) * 10) / 10,
      calcium:  Math.round((Number(f.calcium) || 0) * 10) / 10,
      b12:      Math.round((Number(f.b12)     || 0) * 10) / 10,
      zinc:     Math.round((Number(f.zinc)    || 0) * 10) / 10,
      meal:     VALID_MEALS.includes(f.meal) ? f.meal : 'snacks',
      source:   'photo',
    }));

    return res.json({ success: true, data: { foods } });

  } catch (e) {
    console.error('[kutz/parsePhoto] Error:', e.message);
    return res.status(500).json({
      success: false,
      error:   'Photo parse failed',
      message: 'Unable to parse photo. Please try again or use voice input.',
      code:    'PARSE_ERROR',
    });
  }
}

module.exports = parsePhoto;
