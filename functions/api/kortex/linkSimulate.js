/**
 * linkSimulate.js — "what would this code do, for this phone, at this time?"
 *
 * The same order redirectHandler uses, written down so the owner can see the
 * chosen destination and the exact reason before anything is printed:
 *   workspace switched off → safety status → paused → cap or end date
 *   (fallback if set) → device destination → time window → default.
 * Pure: no reads, no writes. The link's own time zone decides the window.
 */
const { evaluateLimits, expiryDate } = require('./linkRules');
const { pickScheduledDestination } = require('./linkSchedule');

const PLATFORMS = new Set(['ios', 'android', 'web']);

function simulate(link, { platform = 'web', at = Date.now(), gate = { enabled: true } } = {}) {
  const p = PLATFORMS.has(platform) ? platform : 'web';
  const now = new Date(Number.isFinite(Number(at)) ? Number(at) : Date.parse(at) || Date.now());
  const steps = [];
  const stop = (outcome, destination, why) => { steps.push({ rule: outcome, hit: true, why }); return { platform: p, at: now.toISOString(), outcome, destination, steps, timeZone: link.schedule && link.schedule.timezone || null }; };

  if (gate && gate.enabled === false) return stop('workspace_off', null, 'The workspace is switched off; every code in it stops.');
  steps.push({ rule: 'workspace', hit: false, why: 'Workspace is on.' });
  if (link.status === 'blocked') return stop('blocked', null, 'The destination failed the safety check.');
  if (link.status === 'held') return stop('held', null, 'The destination is waiting for a review.');
  steps.push({ rule: 'safety', hit: false, why: 'Destination passed the safety check.' });
  if (link.enabled === false) return stop('paused', null, 'The code is paused.');
  steps.push({ rule: 'paused', hit: false, why: 'The code is live.' });

  const lim = evaluateLimits(link, now);
  if (lim.over) {
    const why = lim.reason === 'expired' ? `Past the end date (${expiryDate(link).toISOString().slice(0, 10)}).` : `Reached the scan cap (${link.limits.maxClicks}).`;
    if (lim.fallbackUrl) return stop('fallback', lim.fallbackUrl, `${why} Sent to the fallback.`);
    return stop('capped', null, `${why} No fallback set, so the visitor sees a closed page.`);
  }
  steps.push({ rule: 'limits', hit: false, why: link.limits && (link.limits.maxClicks || expiryDate(link)) ? 'Under the cap and before the end date.' : 'No cap or end date.' });

  const d = link.destinations || {};
  let destination = d.web || null, chosen = 'default';
  if (p === 'ios' && d.ios) { destination = d.ios; chosen = 'ios'; }
  else if (p === 'android' && d.android) { destination = d.android; chosen = 'android'; }
  steps.push({ rule: 'device', hit: chosen !== 'default', why: chosen === 'default' ? `No ${p === 'web' ? 'device' : p} destination; the main address applies.` : `${p === 'ios' ? 'iPhone' : 'Android'} destination applies.` });

  if (link.schedule) {
    const pick = pickScheduledDestination(link.schedule, now);
    if (pick) { steps.push({ rule: 'window', hit: true, why: `Inside the "${pick.label}" window (${link.schedule.timezone || 'UTC'}).` }); return stop('delivered', pick.url, `Time window "${pick.label}" wins.`); }
    steps.push({ rule: 'window', hit: false, why: `Outside every time window (${link.schedule.timezone || 'UTC'}).` });
  }
  return stop('delivered', destination, chosen === 'default' ? 'The main address.' : `The ${chosen === 'ios' ? 'iPhone' : 'Android'} address.`);
}

module.exports = { simulate, PLATFORMS };
