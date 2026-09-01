"""Expert-rule score, safety floor, and contributing-factor reasons.

Ported from paddle-llm src/paddle_llm/labels/hybrid.py (the labeling rubric's
deterministic half). Two production uses:

1. Safety floor: when the rule score says conditions are bad (<= 2.5), the ML
   prediction is capped at the rule score — defense-in-depth for any consumer
   of the raw model, mirroring the JS penalty gate downstream.
2. reasons[]: human-readable contributing factors ("strong wind", "cold water")
   attached to every prediction as *condition attribution*, not model
   explanation.

Inputs use the ml-service flat feature names (temperature degC, windSpeed mph,
gustSpeed mph, waveHeight m, waterTemp degC, visibility km, precipMM,
precipChance pct, uvIndex). Missing values simply skip their rule.
"""

import hashlib

SAFETY_FLOOR_THRESHOLD = 2.5


def _f(features, key, default=None):
    v = features.get(key)
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def expert_rule(features: dict) -> dict:
    score = 4.5
    reasons = []

    def penalty(amount, reason):
        nonlocal score
        score -= amount
        reasons.append(reason)

    wind = _f(features, 'windSpeed', 0.0)
    gust = _f(features, 'gustSpeed', wind)
    wave = _f(features, 'waveHeight')
    water = _f(features, 'waterTemp')
    temp = _f(features, 'temperature', 20.0)
    vis = _f(features, 'visibility', 10.0)
    precip = _f(features, 'precipMM', 0.0)
    pchance = _f(features, 'precipChance', 0.0)
    uv = _f(features, 'uvIndex', 0.0)

    if wind >= 25:
        penalty(2.0, 'dangerous wind')
    elif wind >= 20:
        penalty(1.5, 'strong wind')
    elif wind >= 15:
        penalty(1.0, 'moderate wind')
    elif wind >= 11:
        penalty(0.5, 'noticeable wind')

    if gust is not None and wind is not None:
        if gust - wind >= 10:
            penalty(1.0, 'large gust spread')
        elif gust - wind >= 6:
            penalty(0.5, 'gusty conditions')

    if wave is not None:
        if wave >= 1.5:
            penalty(1.0, 'large waves')
        elif wave >= 0.8:
            penalty(0.5, 'choppy waves')

    if water is not None:
        if water <= 5:
            penalty(1.0, 'very cold water')
        elif water <= 10:
            penalty(0.5, 'cold water')

    if temp <= 0 or temp >= 35:
        penalty(1.0, 'extreme air temperature')
    elif temp <= 5 or temp >= 30:
        penalty(0.5, 'uncomfortable air temperature')

    if vis <= 3:
        penalty(1.0, 'poor visibility')
    elif vis <= 6:
        penalty(0.5, 'reduced visibility')

    if precip >= 6 or (pchance or 0) >= 80:
        penalty(1.0, 'heavy precipitation risk')
    elif precip >= 2 or (pchance or 0) >= 60:
        penalty(0.5, 'moderate precipitation risk')

    if uv >= 10:
        penalty(0.5, 'dangerous uv')

    final = round(max(1.0, min(5.0, score)) * 2) / 2
    return {
        'score': final,
        'reasons': reasons or ['favorable conditions'],
    }


def apply_safety_floor(result: dict, features: dict) -> dict:
    """Cap the ML rating at the expert-rule score when the rules say <= 2.5.

    Mutates and returns `result`, attaching reasons + provenance either way.
    """
    rule = expert_rule(features)
    result['reasons'] = rule['reasons']
    result['expertRuleScore'] = rule['score']
    try:
        rating = float(result.get('rating'))
    except (TypeError, ValueError):
        return result
    if rule['score'] <= SAFETY_FLOOR_THRESHOLD and rating > rule['score']:
        result['rating'] = rule['score']
        result['safetyFloorApplied'] = True
    return result


def features_hash(features: dict) -> str:
    """Stable short hash of the input vector, for lineage on prediction logs."""
    keys = sorted(k for k in features.keys() if not k.startswith('_'))
    canon = '|'.join(f'{k}:{features.get(k)}' for k in keys)
    return hashlib.sha1(canon.encode('utf-8')).hexdigest()[:16]


def weather_bucket(features: dict) -> str:
    """Coarse 6-class condition bucket for per-bucket monitoring."""
    temp = _f(features, 'temperature', 20.0)
    wind = _f(features, 'windSpeed', 0.0)
    if wind >= 20:
        return 'severe_wind'
    if temp <= 0:
        return 'freezing'
    if temp <= 10:
        return 'cold'
    if temp >= 32:
        return 'hot'
    if wind >= 12:
        return 'breezy'
    return 'mild'
