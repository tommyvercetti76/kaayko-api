/**
 * PublicReportDTO — everything a share link discloses, and nothing else.
 *
 * Built field by field from an allowlist: no document and no owner response
 * is ever spread into it. Cohort thresholds are applied here, on the server:
 * under ten observed scans the report carries only the link's identity and
 * the window; a breakdown category under five is folded into 'other'; a
 * breakdown under ten in total is withheld. Findings pass only when the
 * insight engine marks them public and the key is on this module's own list —
 * two locks, because a public page is not the place to trust one.
 *
 * @module api/kortex/publicReport
 */

'use strict';

const { placementDisplay } = require('./linkFields');

const MIN_OBSERVED = 10;
const MIN_CATEGORY = 5;
const DAY_MS = 86400000;
const QR_BASE = 'https://kaayko.com/qr';
const OTHER = 'other';
const PUBLIC_FINDING_KEYS = new Set(['qrSplit', 'trend', 'bestWindow', 'placement', 'campaignLift', 'qualityScore', 'missed']);

const PUBLIC_REPORT_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer'
});

function iso(ms) { return new Date(ms).toISOString(); }

function countOf(row) { return Number(row.clicks) || 0; }

function publicLinkIdentity(link) {
  return {
    code: link.code,
    title: link.title || '',
    shortUrl: link.shortUrl || null,
    qrUrl: `${QR_BASE}/${link.code}.png`,
    placement: placementDisplay(link)
  };
}

function publicWindow(analytics, nowMs) {
  const days = analytics.window.retentionDays;
  return { days, timeZone: analytics.timeZone, from: iso(nowMs - days * DAY_MS), to: iso(nowMs) };
}

function publicTotals(totals) {
  return {
    observed: totals.observed,
    useful: totals.useful,
    delivered: totals.delivered,
    rescued: totals.rescued,
    lost: totals.lost,
    usefulRate: totals.usefulRate
  };
}

/** Scans of the printed code against taps on the link, from the source breakdown. */
function publicQrSplit(sourceRows) {
  const rows = Array.isArray(sourceRows) ? sourceRows : [];
  const qr = rows.filter(r => r.value === 'qr').reduce((sum, r) => sum + countOf(r), 0);
  const tap = rows.filter(r => r.value !== 'qr').reduce((sum, r) => sum + countOf(r), 0);
  const total = qr + tap;
  return { qr, tap, qrShare: total ? +(qr / total).toFixed(3) : 0 };
}

/** Date-level only: no hours, no visitor counts. */
function publicTimeline(timeline) {
  return (Array.isArray(timeline) ? timeline : []).map(day => ({ date: day.date, useful: countOf(day) }));
}

/**
 * A breakdown fit for strangers: null under MIN_OBSERVED in total; every
 * category under MIN_CATEGORY (and every unknown value) folded into 'other'.
 */
function cohort(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.reduce((sum, r) => sum + countOf(r), 0);
  if (total < MIN_OBSERVED) return null;
  const shown = list
    .filter(r => r.value != null && r.value !== OTHER && countOf(r) >= MIN_CATEGORY)
    .map(r => ({ value: String(r.value), count: countOf(r) }));
  const merged = total - shown.reduce((sum, r) => sum + r.count, 0);
  if (merged > 0) shown.push({ value: OTHER, count: merged });
  return shown;
}

/** Before / during / after rates, only once the lift finding has enough data to exist. */
function publicCampaign(finding) {
  if (!finding || finding.status === 'none' || !finding.detail) return null;
  return { during: finding.detail.during, before: finding.detail.before, after: finding.detail.after };
}

function isPublicFinding(finding) {
  return !!finding && PUBLIC_FINDING_KEYS.has(finding.key) && finding.shareClass === 'public';
}

/**
 * `missed` is public as counts only: the owner's headline names the reasons a
 * scan was lost (`held`, `blocked`, `paused`), which is moderation history and
 * stays with the owner. Rebuilt from the metrics so no owner advice rides along.
 */
function publicMissedHeadline(finding) {
  const lost = Number(finding.metrics && finding.metrics.lost) || 0;
  const observed = Number(finding.metrics && finding.metrics.observed) || 0;
  return lost ? `${lost} of ${observed} scans in this window reached nothing.` : finding.headline;
}

function publicHeadline(finding) {
  return finding.key === 'missed' ? publicMissedHeadline(finding) : finding.headline;
}

function publicFindings(insights) {
  return Object.values(insights || {})
    .filter(isPublicFinding)
    .map(f => ({ key: f.key, title: f.title, status: f.status, headline: publicHeadline(f) }));
}

/**
 * @param {{ link: object, analytics: object, grant: { createdAtMs: number, expiresAtMs: number|null }, nowMs?: number }} p
 *   `link` is the short_links document (with `code`), `analytics` the owner
 *   analytics response, `grant` the verified token.
 */
function buildPublicReport({ link, analytics, grant, nowMs = Date.now() }) {
  const observed = Number(analytics.totals.observed) || 0;
  const enough = observed >= MIN_OBSERVED;
  const breakdowns = analytics.breakdowns || {};
  const insights = analytics.insights || {};
  return {
    success: true,
    report: {
      link: publicLinkIdentity(link),
      window: publicWindow(analytics, nowMs),
      notEnoughActivity: !enough,
      totals: enough ? publicTotals(analytics.totals) : null,
      qrSplit: enough ? publicQrSplit(breakdowns.source) : null,
      timeline: enough ? publicTimeline(analytics.timeline) : null,
      devices: enough ? cohort(breakdowns.deviceType) : null,
      countries: enough ? cohort(breakdowns.country) : null,
      campaign: enough ? publicCampaign(insights.campaignLift) : null,
      findings: enough ? publicFindings(insights) : [],
      sharedAtMs: grant.createdAtMs,
      expiresAtMs: grant.expiresAtMs
    }
  };
}

module.exports = { buildPublicReport, PUBLIC_REPORT_HEADERS };
