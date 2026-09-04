/**
 * Workspace-level analytics: every link in a workspace inside its window,
 * one merged point list for the overview charts, and the workspace findings.
 * One implementation for the guest router and the admin router.
 *
 * @module api/kortex/workspaceAnalytics
 */

'use strict';

const admin = require('firebase-admin');
const LinkService = require('./smartLinkService');
const { getLinkAnalytics } = require('./linkAnalytics');
const { computeWorkspaceInsights } = require('./linkInsights');

async function countWhere(collection, field, value) {
  try {
    const snap = await admin.firestore().collection(collection).where(field, '==', value).limit(500).get();
    return snap.size;
  } catch (_) { return 0; }
}

/**
 * @param {string} tenantId
 * @param {{ windowDays: number, timeZone?: string, maxLinks?: number }} opts
 */
async function buildWorkspaceAnalytics(tenantId, { windowDays, timeZone = 'UTC', maxLinks = 25 } = {}) {
  const { links } = await LinkService.listLinks({ tenantId, limit: 100 });
  const rows = [];
  let merged = [];
  for (const link of links.slice(0, maxLinks)) {
    const a = await getLinkAnalytics(link.code, link, { windowDays, timeZone });
    const src = Object.fromEntries((a.breakdowns.source || []).map(r => [r.value, r.clicks]));
    const topCountry = (a.breakdowns.country || []).find(r => r.value) || null;
    rows.push({
      code: link.code, title: link.title || link.code, status: link.status || 'active', enabled: link.enabled !== false,
      placement: link.placement || null, utm: link.utm || {},
      lifetime: link.clickCount || 0, events: a.totals.events, qr: src.qr || 0, taps: src.link || 0,
      unique: a.unique ? a.unique.distinctVisitors : 0, topCountry: topCountry ? topCountry.value : null,
      missed: a.outcomes ? a.outcomes.undelivered : 0,
      scansAffected: a.insights && a.insights.safetyImpact ? a.insights.safetyImpact.detail.scansAffected : 0,
      quality: a.insights && a.insights.qualityScore && a.insights.qualityScore.detail ? a.insights.qualityScore.detail.score : null,
      trend: a.insights && a.insights.trend && a.insights.trend.detail ? a.insights.trend.detail.label : null,
      timeline: a.timeline.slice(-7).map(d => d.clicks)
    });
    merged = merged.concat((a.points || []).map(p => [link.code].concat(p)));
  }
  merged.sort((x, y) => x[1] - y[1]);
  const [reports, appeals] = await Promise.all([
    countWhere('kortex_abuse_reports', 'tenantId', tenantId),
    countWhere('kortex_appeals', 'tenantId', tenantId)
  ]);
  const insights = computeWorkspaceInsights({ links: rows, reports, appeals });
  return { window: { days: windowDays, timeZone }, links: rows, points: merged.slice(-3000), insights };
}

module.exports = { buildWorkspaceAnalytics };
