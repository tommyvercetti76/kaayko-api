/**
 * GET /api/kutz/searchFoods?q=yogurt
 *
 * Proxies Open Food Facts text search server-side to avoid CORS.
 * The OFf CGI search endpoint does not set Access-Control-Allow-Origin,
 * so browser-direct calls are blocked. Server-to-server has no such restriction.
 *
 * Returns { success: true, data: { foods: [...] } }
 */

const OFF_SEARCH = 'https://world.openfoodfacts.org/cgi/search.pl';
const UA         = 'KaleKutz/1.0 (kaayko.com)';

function normalize(p) {
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
    // OFf stores iron/calcium/zinc in g/100g → convert to mg
    iron:     Math.round((n['iron_100g']    ?? 0) * scale * 1000 * 10) / 10,
    calcium:  Math.round((n['calcium_100g'] ?? 0) * scale * 1000 * 10) / 10,
    zinc:     Math.round((n['zinc_100g']    ?? 0) * scale * 1000 * 10) / 10,
    b12:      0,
    meal:     'snacks',
    source:   'search',
  };
}

async function searchFoods(req, res) {
  const q = (req.query.q || '').trim();

  if (!q || q.length < 2) {
    return res.json({ success: true, data: { foods: [] } });
  }

  try {
    const url =
      `${OFF_SEARCH}?search_terms=${encodeURIComponent(q)}` +
      `&json=1&page_size=10&action=process&search_simple=1` +
      `&fields=product_name,nutriments,serving_size`;

    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!resp.ok) {
      return res.json({ success: true, data: { foods: [] } });
    }

    const json  = await resp.json();
    const foods = (json.products || [])
      .filter(p => p.product_name && (p.nutriments?.['energy-kcal_100g'] ?? 0) > 0)
      .slice(0, 8)
      .map(normalize);

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
