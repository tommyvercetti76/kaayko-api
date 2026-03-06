/**
 * evCalc.js — Exposure Value calculations
 *
 * EV = log2(N² / t) at ISO 100
 * where N = aperture f-number, t = shutter speed in seconds
 */

function parseShutterToSeconds(shutterStr) {
  if (!shutterStr) return 0;
  const s = String(shutterStr).trim();
  if (s.includes('/')) {
    const [num, den] = s.split('/').map(Number);
    return num / den;
  }
  return parseFloat(s);
}

function computeEV(aperture, shutterStr, iso = 100) {
  const t = parseShutterToSeconds(shutterStr);
  if (t <= 0 || aperture <= 0) return null;
  // EV at given ISO, normalised to ISO 100
  const evBase = Math.log2((aperture * aperture) / t);
  const isoCorrection = Math.log2(iso / 100);
  return evBase - isoCorrection;
}

function applyIBISBonus(shutterStr, stops) {
  if (!stops || stops <= 0) return shutterStr;
  const seconds = parseShutterToSeconds(shutterStr);
  if (seconds <= 0) return shutterStr;
  // IBIS allows slower shutter by `stops` number of stops
  const newSeconds = seconds * Math.pow(2, stops);
  if (newSeconds >= 1) {
    return String(Math.round(newSeconds));
  }
  // Express as fraction
  const denom = Math.round(1 / newSeconds);
  return `1/${denom}`;
}

function parseMaxShutter(shutterRangeStr) {
  // Parses "30 sec – 1/8000 sec" → returns fastest speed as string "1/8000"
  if (!shutterRangeStr) return '1/4000';
  // Try to find the fastest speed (shortest exposure)
  const parts = shutterRangeStr.split(/[–\-—]/);
  for (const part of parts.map(p => p.trim())) {
    const clean = part.replace(/\s*sec/i, '').trim();
    if (clean.includes('/') && parseInt(clean.split('/')[1]) > 100) {
      return clean;
    }
  }
  return '1/4000';
}

module.exports = { computeEV, applyIBISBonus, parseShutterToSeconds, parseMaxShutter };
