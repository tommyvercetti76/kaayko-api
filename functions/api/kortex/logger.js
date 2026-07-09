/**
 * Minimal structured logger for Kortex.
 *
 * Emits single-line JSON with a severity field so Google Cloud Logging parses it
 * into structured entries and log-based metrics/alerts can be derived (e.g. alert
 * on severity=ERROR spikes on the redirect path). Falls back cleanly in tests.
 *
 * Usage:
 *   const log = require('./logger');
 *   log.info('redirect', { code, platform });
 *   log.error('redirect_failed', { code, err: err.message });
 */

function emit(severity, event, fields = {}) {
  const entry = { severity, event, component: 'kortex', ...fields };
  const line = (() => { try { return JSON.stringify(entry); } catch { return `${severity} ${event}`; } })();
  if (severity === 'ERROR') console.error(line);
  else if (severity === 'WARNING') console.warn(line);
  else console.log(line);
}

module.exports = {
  info: (event, fields) => emit('INFO', event, fields),
  warn: (event, fields) => emit('WARNING', event, fields),
  error: (event, fields) => emit('ERROR', event, fields),
};
