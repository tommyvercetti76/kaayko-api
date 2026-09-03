/**
 * Time-of-day routing for a link.
 *
 * A link may carry a schedule:
 *   { timezone: 'Asia/Kolkata',
 *     windows: [ { label: 'day',   start: '06:00', end: '18:00', url: 'https://…' },
 *                { label: 'night', start: '18:00', end: '06:00', url: 'https://…' } ] }
 *
 * At redirect time the SERVER clock is converted to the link's own timezone
 * (ICU rules, so daylight-saving changes are handled) and the first window
 * containing that local time wins for every platform. No window → the link's
 * normal destinations apply. Nothing about the current time is ever read from
 * the request, so a visitor cannot pick a different destination by lying.
 *
 * Windows may wrap midnight (start > end). A window with start === end is
 * rejected rather than treated as "all day" — that would be a silent trap.
 *
 * @module api/kortex/linkSchedule
 */

'use strict';

const MAX_WINDOWS = 8;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LABEL_MAX = 40;
const URL_MAX = 2048;

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64 || !/^[A-Za-z_+\-/0-9]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

function toMinutes(hhmm) {
  const m = TIME_RE.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function cleanUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > URL_MAX) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch (_) {
    return null;
  }
}

/**
 * Validate and normalise a client-supplied schedule.
 * @returns {null|{timezone:string, windows:Array, version:number}} null clears the schedule
 */
function normalizeSchedule(input) {
  if (input === null || input === undefined || input === false || input === '') return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw validationError('schedule must be an object');

  const windowsIn = Array.isArray(input.windows) ? input.windows : [];
  if (!windowsIn.length) return null;
  if (windowsIn.length > MAX_WINDOWS) throw validationError(`A schedule may have at most ${MAX_WINDOWS} windows`);

  const timezone = String(input.timezone || '').trim();
  if (!isValidTimeZone(timezone)) throw validationError('schedule.timezone must be a valid IANA time zone, e.g. Asia/Kolkata');

  const windows = windowsIn.map((win, i) => {
    if (!win || typeof win !== 'object') throw validationError(`schedule.windows[${i}] must be an object`);
    const start = String(win.start || '').trim();
    const end = String(win.end || '').trim();
    if (toMinutes(start) === null || toMinutes(end) === null) {
      throw validationError(`schedule.windows[${i}] needs start and end as HH:MM (24-hour)`);
    }
    if (toMinutes(start) === toMinutes(end)) {
      throw validationError(`schedule.windows[${i}] start and end must differ`);
    }
    const url = cleanUrl(win.url);
    if (!url) throw validationError(`schedule.windows[${i}].url must be a valid http(s) address`);
    const label = String(win.label || '').trim().slice(0, LABEL_MAX) || `${start}-${end}`;
    return { label, start, end, url };
  });

  return { timezone, windows, version: 1 };
}

/** Minutes since local midnight in the given zone, for a given instant. */
function localMinutes(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(now);
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'hour') hour = Number(part.value) % 24;
    if (part.type === 'minute') minute = Number(part.value);
  }
  return hour * 60 + minute;
}

function windowMatches(win, minutes) {
  const start = toMinutes(win.start);
  const end = toMinutes(win.end);
  if (start === null || end === null || start === end) return false;
  return start < end ? (minutes >= start && minutes < end) : (minutes >= start || minutes < end);
}

/**
 * Pick the destination for an instant. Returns null when no window applies.
 * @param {Object|null} schedule - stored schedule
 * @param {Date} [now] - defaults to the server clock; tests inject instants
 */
function pickScheduledDestination(schedule, now = new Date()) {
  if (!schedule || !Array.isArray(schedule.windows) || !schedule.windows.length) return null;
  if (!isValidTimeZone(schedule.timezone)) return null;
  let minutes;
  try {
    minutes = localMinutes(now, schedule.timezone);
  } catch (_) {
    return null;
  }
  for (const win of schedule.windows) {
    if (windowMatches(win, minutes)) {
      return { url: win.url, label: win.label || `${win.start}-${win.end}`, localMinutes: minutes, timezone: schedule.timezone };
    }
  }
  return null;
}

/** URLs referenced by a schedule, for the safety assessment. */
function scheduleUrls(schedule) {
  return (schedule && Array.isArray(schedule.windows) ? schedule.windows : []).map(w => w.url).filter(Boolean);
}

module.exports = { MAX_WINDOWS, normalizeSchedule, pickScheduledDestination, scheduleUrls, isValidTimeZone, localMinutes, windowMatches, toMinutes };
