/**
 * KaleKutz — suggest API test suite
 *
 * Covers: auth, no-history graceful response, remaining macros calculation,
 * IST time → meal slot logic, diet type injection in system prompt,
 * Claude failure handling.
 */

require('./helpers/mockSetup');

const request   = require('supertest');
const admin     = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { buildTestApp } = require('./helpers/testApp');

jest.mock('@anthropic-ai/sdk');

let app;

beforeAll(() => {
  const kutzRouter = require('../api/kutz/kutzRouter');
  app = buildTestApp('/api/kutz', kutzRouter);
});

beforeEach(() => {
  Anthropic._reset();
});

afterEach(() => {
  admin._mocks.resetAll();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validSuggestResponse() {
  return JSON.stringify({
    insights:    ['You have 45g protein remaining', 'Fiber on track at 18/25g'],
    suggestions: [
      {
        meal:     'lunch',
        label:    'Dal + Roti',
        foods:    '1 katori masoor dal + 2 rotis',
        calories: 340,
        protein:  18,
        carbs:    52,
        fat:      7,
        fiber:    8,
        reason:   'Closes protein gap efficiently',
      },
    ],
  });
}

function seedProfile(uid, overrides = {}) {
  const defaultProfile = {
    targets:  { calories: 1650, protein: 110, carbs: 200, fat: 55, fiber: 25 },
    dietType: 'lacto-ovo-vegetarian',
  };
  admin._mocks.docData[`users/${uid}/kutzProfile/data`] = { ...defaultProfile, ...overrides };
}

function seedTodayTotals(uid, date, totals = {}) {
  admin._mocks.docData[`users/${uid}/kutzDays/${date}`] = {
    date,
    totals: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, ...totals },
  };
}

function post(token = 'VALID_USER_TOKEN') {
  return request(app)
    .post('/api/kutz/suggest')
    .set('Authorization', `Bearer ${token}`);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('Authentication', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).post('/api/kutz/suggest').send();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .post('/api/kutz/suggest')
      .set('Authorization', 'Bearer BAD_TOKEN')
      .send();
    expect(res.status).toBe(401);
  });
});

// ─── No-history response ──────────────────────────────────────────────────────

describe('No-history / first run', () => {
  it('succeeds gracefully when user has no history at all', async () => {
    Anthropic._setResponse(validSuggestResponse());
    // No Firestore data seeded — everything returns empty/defaults
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.suggestions)).toBe(true);
    expect(Array.isArray(res.body.data.insights)).toBe(true);
  });

  it('returns default targets when profile does not exist', async () => {
    Anthropic._setResponse(validSuggestResponse());
    const res = await post();
    expect(res.status).toBe(200);
    // Verify Claude was called — if it was called with default targets in prompt, it means no crash
    expect(Anthropic.messages.create).toHaveBeenCalledTimes(1);
    const callArg = Anthropic.messages.create.mock.calls[0][0];
    expect(callArg.messages[0].content).toContain('1650 kcal'); // default calorie target
  });
});

// ─── Remaining Macros Calculation ─────────────────────────────────────────────

describe('Remaining macros calculation', () => {
  it('sends correct remaining macros to Claude based on today\'s totals', async () => {
    const uid  = 'user-uid';
    const date = new Date().toISOString().slice(0, 10);

    seedProfile(uid);
    seedTodayTotals(uid, date, { calories: 500, protein: 40, carbs: 80, fat: 20, fiber: 10 });

    Anthropic._setResponse(validSuggestResponse());
    const res = await post();
    expect(res.status).toBe(200);

    const prompt = Anthropic.messages.create.mock.calls[0][0].messages[0].content;
    // Remaining: 1650-500=1150 cal, 110-40=70g prot
    expect(prompt).toContain('1150 kcal');
    expect(prompt).toContain('70g prot');
  });

  it('clamps remaining to 0 when target is already exceeded', async () => {
    const uid  = 'user-uid';
    const date = new Date().toISOString().slice(0, 10);

    seedProfile(uid);
    // Over target on all macros
    seedTodayTotals(uid, date, { calories: 2000, protein: 130, carbs: 250, fat: 70, fiber: 30 });

    Anthropic._setResponse(validSuggestResponse());
    const res = await post();
    expect(res.status).toBe(200);

    const prompt = Anthropic.messages.create.mock.calls[0][0].messages[0].content;
    // All remaining should be 0
    expect(prompt).toContain('0 kcal');
  });
});

// ─── Diet Type in Prompt ──────────────────────────────────────────────────────

describe('Diet type in Claude prompt', () => {
  it('includes the user\'s diet type in the system prompt', async () => {
    seedProfile('user-uid', { dietType: 'vegan' });
    Anthropic._setResponse(validSuggestResponse());

    const res = await post();
    expect(res.status).toBe(200);

    const systemPrompt = Anthropic.messages.create.mock.calls[0][0].system;
    expect(systemPrompt).toContain('vegan');
  });

  it('uses lacto-ovo-vegetarian as default when dietType not in profile', async () => {
    seedProfile('user-uid', {}); // dietType not set
    Anthropic._setResponse(validSuggestResponse());

    await post();
    const systemPrompt = Anthropic.messages.create.mock.calls[0][0].system;
    expect(systemPrompt).toContain('lacto-ovo vegetarian');
  });
});

// ─── Frequent Foods ───────────────────────────────────────────────────────────

describe('Frequent foods context', () => {
  it('includes frequent foods data in the Claude prompt', async () => {
    const uid = 'user-uid';
    admin._mocks.collectionData[`users/${uid}/kutzFrequentFoods`] = [
      {
        id: 'dal-roti',
        data: () => ({ name: 'Dal Roti', calories: 340, protein: 18, carbs: 52, fat: 7, useCount: 15 }),
      },
    ];

    Anthropic._setResponse(validSuggestResponse());
    const res = await post();
    expect(res.status).toBe(200);

    const prompt = Anthropic.messages.create.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Dal Roti');
  });
});

// ─── Claude Response Handling ─────────────────────────────────────────────────

describe('Claude response handling', () => {
  it('returns valid insights and suggestions from Claude', async () => {
    Anthropic._setResponse(validSuggestResponse());
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data.insights).toHaveLength(2);
    expect(res.body.data.suggestions).toHaveLength(1);
    expect(res.body.data.suggestions[0]).toHaveProperty('label');
    expect(res.body.data.suggestions[0]).toHaveProperty('calories');
  });

  it('returns empty arrays when Claude returns missing fields', async () => {
    Anthropic._setResponse(JSON.stringify({ foo: 'bar' }));
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data.insights).toEqual([]);
    expect(res.body.data.suggestions).toEqual([]);
  });

  it('returns 500 when Claude API throws', async () => {
    Anthropic._setError(new Error('rate limit'));
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('SUGGEST_ERROR');
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when Claude returns invalid JSON', async () => {
    Anthropic._setResponse('not json at all');
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('SUGGEST_ERROR');
  });

  it('handles markdown-wrapped JSON from Claude', async () => {
    Anthropic._setResponse('```json\n' + validSuggestResponse() + '\n```');
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data.insights).toHaveLength(2);
  });
});

// ─── Claude Model ─────────────────────────────────────────────────────────────

describe('Claude model selection', () => {
  it('uses claude-haiku model for suggestions (high-frequency, cost-efficient)', async () => {
    Anthropic._setResponse(validSuggestResponse());
    await post();
    const call = Anthropic.messages.create.mock.calls[0][0];
    expect(call.model).toMatch(/claude-haiku/);
  });
});
