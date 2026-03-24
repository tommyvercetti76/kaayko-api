/**
 * GET /api/kutz/searchFoods?q=yogurt
 *
 * Runs Open Food Facts + USDA FoodData Central in parallel, merges results.
 * OFf is strong on packaged/branded items; USDA has 700k+ verified entries.
 * Both are queried server-side (avoids CORS; USDA requires API key server-side anyway).
 *
 * Returns { success: true, data: { foods: [...] } }
 */

const OFF_SEARCH  = 'https://world.openfoodfacts.org/cgi/search.pl';
const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const UA          = 'KaleKutz/1.0 (kaayko.com)';

// USDA FoodData Central nutrient IDs
const NID = {
  kcal:    1008,
  protein: 1003,
  carbs:   1005,
  fat:     1004,
  fiber:   1079,
  iron:    1089,
  calcium: 1087,
  b12:     1178,
  zinc:    1095,
};

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeOFF(p) {
  const n        = p.nutriments || {};
  const servingG = parseFloat(p.serving_size) || 100;
  const scale    = servingG / 100;
  return {
    name:     p.product_name,
    quantity: p.serving_size || '100g',
    calories: Math.round((n['energy-kcal_100g']  ?? 0) * scale),
    protein:  Math.round((n['proteins_100g']      ?? 0) * scale * 10) / 10,
    carbs:    Math.round((n['carbohydrates_100g'] ?? 0) * scale * 10) / 10,
    fat:      Math.round((n['fat_100g']           ?? 0) * scale * 10) / 10,
    fiber:    Math.round((n['fiber_100g']         ?? 0) * scale * 10) / 10,
    iron:     Math.round((n['iron_100g']    ?? 0) * scale * 1000 * 10) / 10,
    calcium:  Math.round((n['calcium_100g'] ?? 0) * scale * 1000 * 10) / 10,
    zinc:     Math.round((n['zinc_100g']    ?? 0) * scale * 1000 * 10) / 10,
    b12:      0,
    meal:     'snacks',
    source:   'search',
  };
}

function normalizeUSDA(item) {
  // Build a quick nutrient map by ID
  const nuts = {};
  (item.foodNutrients || []).forEach(n => { nuts[n.nutrientId] = n.value || 0; });

  const servingG = item.servingSize || 100;
  const unit     = (item.servingSizeUnit || 'g').toLowerCase();
  const scale    = servingG / 100;

  return {
    name:     item.description,
    quantity: `${Math.round(servingG)}${unit}`,
    calories: Math.round((nuts[NID.kcal]    || 0) * scale),
    protein:  Math.round((nuts[NID.protein] || 0) * scale * 10) / 10,
    carbs:    Math.round((nuts[NID.carbs]   || 0) * scale * 10) / 10,
    fat:      Math.round((nuts[NID.fat]     || 0) * scale * 10) / 10,
    fiber:    Math.round((nuts[NID.fiber]   || 0) * scale * 10) / 10,
    iron:     Math.round((nuts[NID.iron]    || 0) * scale * 10) / 10,
    calcium:  Math.round((nuts[NID.calcium] || 0) * scale * 10) / 10,
    b12:      Math.round((nuts[NID.b12]     || 0) * scale * 10) / 10,
    zinc:     Math.round((nuts[NID.zinc]    || 0) * scale * 10) / 10,
    meal:     'snacks',
    source:   'search',
  };
}

// ─── Individual searches ──────────────────────────────────────────────────────

async function fetchOFF(q) {
  const url =
    `${OFF_SEARCH}?search_terms=${encodeURIComponent(q)}` +
    `&json=1&page_size=8&action=process&search_simple=1` +
    `&fields=product_name,nutriments,serving_size`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) return [];
  const json = await resp.json();
  return (json.products || [])
    .filter(p => p.product_name && (p.nutriments?.['energy-kcal_100g'] ?? 0) > 0)
    .slice(0, 5)
    .map(normalizeOFF);
}

async function fetchUSDA(q) {
  const key  = process.env.USDA_API_KEY || 'DEMO_KEY';
  const url  = `${USDA_SEARCH}?query=${encodeURIComponent(q)}&pageSize=6&api_key=${key}&dataType=Foundation,SR%20Legacy,Branded`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) return [];
  const json = await resp.json();
  return (json.foods || [])
    .filter(f => {
      const kcal = (f.foodNutrients || []).find(n => n.nutrientId === NID.kcal);
      return f.description && kcal && kcal.value > 0;
    })
    .slice(0, 5)
    .map(normalizeUSDA);
}

// ─── Merge — USDA first (more reliable), OFf fills remainder ─────────────────

function mergeResults(usda, off) {
  // Deduplicate OFf entries whose name is very similar to a USDA entry
  const seen = new Set(usda.map(f => f.name.toLowerCase().slice(0, 22)));
  const uniqueOff = off.filter(f => !seen.has(f.name.toLowerCase().slice(0, 22)));
  return [...usda, ...uniqueOff].slice(0, 10);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function searchFoods(req, res) {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.json({ success: true, data: { foods: [] } });
  }

  try {
    // Run both sources in parallel; if one fails, use the other
    const [usdaResult, offResult] = await Promise.allSettled([
      fetchUSDA(q),
      fetchOFF(q),
    ]);

    const usda  = usdaResult.status  === 'fulfilled' ? usdaResult.value  : [];
    const off   = offResult.status   === 'fulfilled' ? offResult.value   : [];
    const foods = mergeResults(usda, off);

    return res.json({ success: true, data: { foods } });
  } catch (e) {
    console.error('[kutz/searchFoods] error:', e.message);
    return res.status(500).json({
      success: false,
      error:   'Search failed',
      message: 'Food search unavailable. Try voice or manual entry.',
    });
  }
}

module.exports = searchFoods;
