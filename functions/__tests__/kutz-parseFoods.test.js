/**
 * KaleKutz — parseFoods API test suite
 *
 * Covers: auth, rate limiting, input validation, diet type injection,
 * product DB overrides, Claude response parsing, macro sanitisation,
 * and error handling.
 */

require('./helpers/mockSetup');

const request  = require('supertest');
const express  = require('express');
const admin    = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { buildTestApp } = require('./helpers/testApp');

// Activate the manual Anthropic mock
jest.mock('@anthropic-ai/sdk');

// ── App setup ────────────────────────────────────────────────────────────────
let app;
let parseFoodsHandler;

beforeAll(() => {
  const kutzRouter     = require('../api/kutz/kutzRouter');
  parseFoodsHandler    = require('../api/kutz/parseFoods');
  app = buildTestApp('/api/kutz', kutzRouter);
});

// Clear rate limiter and Anthropic mock between every test
beforeEach(() => {
  parseFoodsHandler._rateLimitMap.clear();
  Anthropic._reset();
});

afterEach(() => {
  admin._mocks.resetAll();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validFoodArray(overrides = []) {
  const defaults = [{
    name:     'Dal',
    quantity: '1 katori',
    calories: 140,
    protein:  8,
    carbs:    20,
    fat:      5,
    fiber:    4,
    iron:     3.0,
    calcium:  25,
    b12:      0,
    zinc:     1.0,
    meal:     'lunch',
  }];
  return JSON.stringify(overrides.length ? overrides : defaults);
}

function post(body = {}, token = 'VALID_USER_TOKEN') {
  return request(app)
    .post('/api/kutz/parseFoods')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('Authentication', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).post('/api/kutz/parseFoods').send({ text: 'dal' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .post('/api/kutz/parseFoods')
      .set('Authorization', 'Bearer INVALID_TOKEN')
      .send({ text: 'dal' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with an expired token', async () => {
    const res = await request(app)
      .post('/api/kutz/parseFoods')
      .set('Authorization', 'Bearer EXPIRED_TOKEN')
      .send({ text: 'dal' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_EXPIRED');
  });
});

// ─── Input Validation ─────────────────────────────────────────────────────────

describe('Input validation', () => {
  it('returns 400 when text field is missing', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('returns 400 when text is an empty string', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('returns 400 when text is non-string', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('returns 400 when text exceeds 2000 characters', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INPUT_TOO_LONG');
  });

  it('accepts text at exactly 2000 characters', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: 'a'.repeat(2000) });
    expect(res.status).toBe(200);
  });
});

// ─── Rate Limiting ────────────────────────────────────────────────────────────

describe('Rate limiting', () => {
  it('returns 429 after 10 requests within 60 seconds', async () => {
    Anthropic._setResponse(validFoodArray());

    // First 10 requests should succeed
    for (let i = 0; i < 10; i++) {
      const res = await post({ text: `dal ${i}` });
      expect(res.status).toBe(200);
    }

    // 11th request must be rate-limited
    const res = await post({ text: 'one more dal' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMIT');
  });

  it('rate limit is per-uid (different UIDs are independent)', async () => {
    Anthropic._setResponse(validFoodArray());

    // Fill 'user-uid' quota (VALID_USER_TOKEN → user-uid)
    for (let i = 0; i < 10; i++) {
      await post({ text: `dal ${i}` }, 'VALID_USER_TOKEN');
    }

    // Admin user (different uid) should not be rate limited
    const res = await request(app)
      .post('/api/kutz/parseFoods')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({ text: 'paneer' });
    expect(res.status).toBe(200);
  });
});

// ─── Successful Parsing ───────────────────────────────────────────────────────

describe('Successful parsing', () => {
  it('returns 200 with parsed food array for a valid request', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: 'I had a bowl of dal for lunch' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.foods)).toBe(true);
    expect(res.body.data.foods).toHaveLength(1);
  });

  it('returns all 5 macros + 4 micronutrients for each food item', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: 'dal for lunch' });
    const food = res.body.data.foods[0];
    expect(food).toHaveProperty('name');
    expect(food).toHaveProperty('quantity');
    expect(food).toHaveProperty('calories');
    expect(food).toHaveProperty('protein');
    expect(food).toHaveProperty('carbs');
    expect(food).toHaveProperty('fat');
    expect(food).toHaveProperty('fiber');
    expect(food).toHaveProperty('iron');
    expect(food).toHaveProperty('calcium');
    expect(food).toHaveProperty('b12');
    expect(food).toHaveProperty('zinc');
    expect(food).toHaveProperty('meal');
  });

  it('clamps negative macro values to 0', async () => {
    Anthropic._setResponse(JSON.stringify([{
      name: 'Mystery food', quantity: '1 serving',
      calories: -10, protein: -5, carbs: 20, fat: 0, fiber: 3, meal: 'snacks',
    }]));
    const res = await post({ text: 'mystery food' });
    const food = res.body.data.foods[0];
    expect(food.calories).toBe(0);
    expect(food.protein).toBe(0);
    expect(food.carbs).toBe(20);
  });

  it('rounds micronutrients to 1 decimal place', async () => {
    Anthropic._setResponse(JSON.stringify([{
      name: 'Paneer', quantity: '100g',
      calories: 265, protein: 18, carbs: 3, fat: 20, fiber: 0,
      iron: 0.333, calcium: 480.6, b12: 0.444, zinc: 2.555, meal: 'lunch',
    }]));
    const res = await post({ text: 'paneer' });
    const food = res.body.data.foods[0];
    expect(food.iron).toBe(0.3);
    expect(food.calcium).toBe(480.6);
    expect(food.b12).toBe(0.4);
    expect(food.zinc).toBe(2.6);
  });

  it('normalises invalid meal to "snacks"', async () => {
    Anthropic._setResponse(JSON.stringify([{
      name: 'Roti', quantity: '2 pieces',
      calories: 200, protein: 6, carbs: 40, fat: 2, fiber: 3, meal: 'brunch',
    }]));
    const res = await post({ text: '2 rotis' });
    expect(res.body.data.foods[0].meal).toBe('snacks');
  });

  it('handles Claude returning markdown-wrapped JSON', async () => {
    Anthropic._setResponse('```json\n' + validFoodArray() + '\n```');
    const res = await post({ text: 'dal for lunch' });
    expect(res.status).toBe(200);
    expect(res.body.data.foods).toHaveLength(1);
  });

  it('handles multiple food items in a single parse', async () => {
    const multiFood = JSON.stringify([
      { name: 'Roti',  quantity: '2', calories: 200, protein: 6,  carbs: 40, fat: 2,  fiber: 3,  iron: 1.6, calcium: 20, b12: 0, zinc: 0.8, meal: 'dinner' },
      { name: 'Sabzi', quantity: '1 katori', calories: 120, protein: 3, carbs: 10, fat: 7, fiber: 4, iron: 1.0, calcium: 30, b12: 0, zinc: 0.4, meal: 'dinner' },
      { name: 'Curd',  quantity: '150g',     calories: 90,  protein: 5, carbs: 7,  fat: 4,  fiber: 0, iron: 0.1, calcium: 180, b12: 0.4, zinc: 0.8, meal: 'dinner' },
    ]);
    Anthropic._setResponse(multiFood);
    const res = await post({ text: '2 rotis sabzi and curd for dinner' });
    expect(res.status).toBe(200);
    expect(res.body.data.foods).toHaveLength(3);
  });
});

// ─── Diet Type Injection ──────────────────────────────────────────────────────

describe('Diet type injection', () => {
  it('passes dietType in request body without erroring', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: 'paneer for lunch', dietType: 'lacto-ovo-vegetarian' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('uses default diet type when none provided', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: 'dal for lunch' }); // no dietType
    expect(res.status).toBe(200);
  });

  it('accepts all 4 valid diet types', async () => {
    const dietTypes = ['lacto-ovo-vegetarian', 'lacto-vegetarian', 'vegan', 'non-vegetarian'];
    for (const dietType of dietTypes) {
      parseFoodsHandler._rateLimitMap.clear(); // reset per call since we loop
      Anthropic._reset();
      Anthropic._setResponse(validFoodArray());
      const res = await post({ text: 'dal for lunch', dietType });
      expect(res.status).toBe(200);
    }
  });

  it('falls back to default when dietType is an unknown value', async () => {
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: 'dal for lunch', dietType: 'pescatarian' });
    expect(res.status).toBe(200); // should not crash
  });
});

// ─── Product DB Overrides ─────────────────────────────────────────────────────

describe('Product DB overrides', () => {
  it('injects matching product label data into system prompt context', async () => {
    // Seed a branded product
    const uid = 'user-uid';
    admin._mocks.collectionData[`users/${uid}/kutzProductDB`] = [
      {
        id: 'epigamia-greek-yogurt',
        data: () => ({
          name:     'Epigamia Greek Yogurt',
          calories: 92,
          protein:  9,
          carbs:    6,
          fat:      3,
          fiber:    0,
          per:      '90g',
        }),
      },
    ];

    Anthropic._setResponse(JSON.stringify([{
      name: 'Epigamia Greek Yogurt', quantity: '90g',
      calories: 92, protein: 9, carbs: 6, fat: 3, fiber: 0, meal: 'breakfast',
    }]));

    const res = await post({ text: 'I had Epigamia Greek Yogurt for breakfast' });
    expect(res.status).toBe(200);
    // Verify Claude was called (product context was built)
    expect(Anthropic.messages.create).toHaveBeenCalledTimes(1);
    const callArg = Anthropic.messages.create.mock.calls[0][0];
    // Product context moves to the user message prefix (keeps system cache stable)
    expect(callArg.messages[0].content).toContain('label-verified');
  });

  it('does not error if kutzProductDB is empty', async () => {
    // collectionData for product DB returns empty array by default (not seeded)
    Anthropic._setResponse(validFoodArray());
    const res = await post({ text: 'dal for lunch' });
    expect(res.status).toBe(200);
  });
});

// ─── Claude Response Error Handling ──────────────────────────────────────────

describe('Claude response error handling', () => {
  it('returns 500 when Claude throws an API error', async () => {
    Anthropic._setError(new Error('API connection error'));
    const res = await post({ text: 'dal for lunch' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PARSE_ERROR');
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when Claude returns invalid JSON', async () => {
    Anthropic._setResponse('This is not valid JSON at all');
    const res = await post({ text: 'dal for lunch' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PARSE_ERROR');
  });

  it('returns 500 when Claude returns a JSON object (not array)', async () => {
    Anthropic._setResponse(JSON.stringify({ foods: [] }));
    const res = await post({ text: 'dal for lunch' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PARSE_ERROR');
  });

  it('returns empty foods array when Claude returns an empty array', async () => {
    Anthropic._setResponse('[]');
    const res = await post({ text: 'something obscure' });
    expect(res.status).toBe(200);
    expect(res.body.data.foods).toEqual([]);
  });
});

// ─── Claude Prompt Content ────────────────────────────────────────────────────

describe('Claude prompt construction', () => {
  it('sends user text to Claude as user message content', async () => {
    Anthropic._setResponse(validFoodArray());
    const text = 'I had paneer butter masala for dinner';
    await post({ text });
    const call = Anthropic.messages.create.mock.calls[0][0];
    expect(call.messages[0].content).toBe(text.trim());
  });

  it('includes diet type rules in the system prompt', async () => {
    Anthropic._setResponse(validFoodArray());
    await post({ text: 'dal', dietType: 'vegan' });
    const call = Anthropic.messages.create.mock.calls[0][0];
    // system is now an array of cache blocks — check the text property
    const systemText = Array.isArray(call.system)
      ? call.system.map(b => b.text || '').join('\n')
      : call.system;
    expect(systemText).toContain('VEGAN');
    expect(systemText).toContain('ALL animal products');
  });

  it('uses claude-sonnet model', async () => {
    Anthropic._setResponse(validFoodArray());
    await post({ text: 'dal' });
    const call = Anthropic.messages.create.mock.calls[0][0];
    expect(call.model).toMatch(/claude-sonnet/);
  });
});
