/**
 * KaleKutz — parseFoods
 *
 * POST /api/kutz/parseFoods
 * Body: { text: string }
 *
 * Sends natural language food description to Claude API and returns
 * structured food entries with macro estimates for Indian vegetarian diet.
 */

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are a nutrition parser for a vegetarian, high-protein Indian diet tracker.

The user will describe what they ate in natural language — often Indian home-cooked food, sometimes with approximate quantities.

Return ONLY a JSON array of food items. Each item:
{"name": string, "quantity": string, "calories": number, "protein": number, "fiber": number, "meal": "breakfast"|"lunch"|"dinner"|"snacks"}

Rules:
- Use USDA/IFCT (Indian Food Composition Tables) reference values
- For Indian foods (dal, sabzi, roti, rice, curd, paneer, poha, upma, idli, dosa, etc.), use standard Indian serving sizes (katori, roti, medium bowl)
- If quantity is vague ("some", "a little", "a bowl"), use a reasonable default portion
- Round calories to nearest 5, protein/fiber to nearest 1
- Infer the meal from context or time cues. Default to "snacks" if unclear
- Never include whey protein — user is vegetarian and avoids it
- For packaged foods with known labels, use label values
- If truly unable to estimate, set calories/protein/fiber to 0 and add "(estimate needed)" to name
- Respond with ONLY the JSON array. No markdown. No explanation. No backticks.`;

const VALID_MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

async function parseFoods(req, res) {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid input',
      message: 'text field is required',
      code: 'INVALID_INPUT'
    });
  }

  if (text.length > 2000) {
    return res.status(400).json({
      success: false,
      error: 'Input too long',
      message: 'text must be 2000 characters or fewer',
      code: 'INPUT_TOO_LONG'
    });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text.trim() }],
    });

    const raw = message.content.map(c => c.text || '').join('').trim();
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      throw new Error('Claude returned non-array response');
    }

    const foods = parsed.map(f => ({
      name: String(f.name || 'Unknown food'),
      quantity: String(f.quantity || '1 serving'),
      calories: Math.max(0, Math.round(Number(f.calories) || 0)),
      protein: Math.max(0, Math.round(Number(f.protein) || 0)),
      fiber: Math.max(0, Math.round(Number(f.fiber) || 0)),
      meal: VALID_MEALS.includes(f.meal) ? f.meal : 'snacks',
    }));

    return res.json({ success: true, data: { foods } });
  } catch (e) {
    console.error('[kutz/parseFoods] Error:', e.message);
    return res.status(500).json({
      success: false,
      error: 'Parse failed',
      message: 'Unable to parse food description. Please try again.',
      code: 'PARSE_ERROR'
    });
  }
}

module.exports = parseFoods;
