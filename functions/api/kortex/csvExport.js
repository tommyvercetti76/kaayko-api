/**
 * CSV export of click events and workspace summaries.
 * Plain RFC 4180 quoting, UTF-8 with a BOM so spreadsheets open it cleanly,
 * formulas neutralised (a cell starting with = + - @ is prefixed with ')
 * because these files are opened in Excel by people who trust them.
 *
 * @module api/kortex/csvExport
 */

'use strict';

const admin = require('firebase-admin');

const EVENT_COLUMNS = Object.freeze([
  'time', 'link', 'source', 'platform', 'device', 'os', 'browser', 'country',
  'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'window', 'sent_to'
]);

function cell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map(c => cell(row[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function eventRow(code, e) {
  const ms = e.timestampMs || (e.timestamp?.toMillis ? e.timestamp.toMillis() : null);
  return {
    time: ms ? new Date(ms).toISOString() : '',
    link: code,
    source: e.metadata?.source === 'qr' ? 'qr' : 'link',
    platform: e.platform || '',
    device: e.deviceInfo?.deviceType || '',
    os: e.deviceInfo?.os || '',
    browser: e.deviceInfo?.browser || '',
    country: e.geo?.country || '',
    referrer: e.referrer || '',
    utm_source: e.utm?.utm_source || '',
    utm_medium: e.utm?.utm_medium || '',
    utm_campaign: e.utm?.utm_campaign || '',
    utm_term: e.utm?.utm_term || '',
    utm_content: e.utm?.utm_content || '',
    window: e.metadata?.scheduleWindow || '',
    sent_to: e.redirectedTo || ''
  };
}

/**
 * Click events for one link inside a window, newest first.
 */
async function linkEventsCsv(code, { windowDays = 30, maxRows = 50000 } = {}) {
  const db = admin.firestore();
  const snap = await db.collection('click_events').where('linkCode', '==', code).get();
  const startMs = Date.now() - windowDays * 86400000;
  const rows = snap.docs
    .map(d => d.data())
    .filter(e => { const ms = e.timestampMs || (e.timestamp?.toMillis ? e.timestamp.toMillis() : 0); return ms >= startMs; })
    .sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0))
    .slice(0, maxRows)
    .map(e => eventRow(code, e));
  return { csv: toCsv(EVENT_COLUMNS, rows), rows: rows.length };
}

const LINK_COLUMNS = Object.freeze(['code', 'short_url', 'title', 'status', 'enabled', 'points_to', 'ios', 'android', 'night_url', 'clicks', 'max_clicks', 'expires', 'created']);

function workspaceCsv(links) {
  const rows = links.map(l => ({
    code: l.code,
    short_url: l.shortUrl || '',
    title: l.title || '',
    status: l.status || 'active',
    enabled: l.enabled === false ? 'paused' : 'live',
    points_to: l.destinations?.web || '',
    ios: l.destinations?.ios || '',
    android: l.destinations?.android || '',
    night_url: (l.schedule?.windows || []).map(w => w.url).join(' '),
    clicks: l.clickCount || 0,
    max_clicks: l.limits?.maxClicks || '',
    expires: l.expiresAt?.toDate ? l.expiresAt.toDate().toISOString() : (l.expiresAt || ''),
    created: l.createdAt?.toDate ? l.createdAt.toDate().toISOString() : (l.createdAt || '')
  }));
  return { csv: toCsv(LINK_COLUMNS, rows), rows: rows.length };
}

function sendCsv(res, filename, csv) {
  res.status(200)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`)
    .set('Cache-Control', 'no-store')
    .send(csv);
}

module.exports = { toCsv, cell, linkEventsCsv, workspaceCsv, sendCsv, EVENT_COLUMNS, LINK_COLUMNS };
