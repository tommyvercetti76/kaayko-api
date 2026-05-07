/**
 * Analytics Alert Service — Weekly digest for link performance drops
 * Scheduled function: runs every Monday at 9am IST
 * Sends email to tenant admins when top links drop >30% week-over-week
 */

const admin = require('firebase-admin');
const db = admin.firestore();

const DROP_THRESHOLD = 0.30; // 30% drop triggers alert
const MIN_CLICKS_FOR_ALERT = 10; // Ignore links with <10 clicks/week

/**
 * Get click counts for a tenant's links over a date range
 */
async function getLinkClicksInRange(tenantId, startDate, endDate) {
  const linksSnap = await db.collection('short_links')
    .where('tenantId', '==', tenantId)
    .where('enabled', '==', true)
    .get();

  const clickCounts = {};

  for (const doc of linksSnap.docs) {
    const linkData = doc.data();
    const code = linkData.code || doc.id;

    const clicksSnap = await db.collection('smartLinkClicks')
      .where('code', '==', code)
      .where('timestamp', '>=', startDate)
      .where('timestamp', '<=', endDate)
      .count()
      .get();

    clickCounts[code] = {
      clicks: clicksSnap.data().count,
      title: linkData.title || linkData.code || code,
      destination: linkData.webDestination || linkData.destination || ''
    };
  }

  return clickCounts;
}

/**
 * Compare two weeks and find significant drops
 */
function findDrops(thisWeek, lastWeek) {
  const drops = [];

  for (const [code, current] of Object.entries(thisWeek)) {
    const previous = lastWeek[code];
    if (!previous || previous.clicks < MIN_CLICKS_FOR_ALERT) continue;

    const dropPct = (previous.clicks - current.clicks) / previous.clicks;
    if (dropPct >= DROP_THRESHOLD) {
      drops.push({
        code,
        title: current.title,
        destination: current.destination,
        thisWeekClicks: current.clicks,
        lastWeekClicks: previous.clicks,
        dropPercent: Math.round(dropPct * 100)
      });
    }
  }

  return drops.sort((a, b) => b.dropPercent - a.dropPercent);
}

/**
 * Build email HTML for the weekly digest
 */
function buildDigestHtml(tenantName, drops, topLinks) {
  const dropRows = drops.slice(0, 5).map(d => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #222;">${d.title}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;text-align:center;">${d.lastWeekClicks}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;text-align:center;">${d.thisWeekClicks}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;text-align:center;color:#ef4444;">-${d.dropPercent}%</td>
    </tr>
  `).join('');

  const topRows = topLinks.slice(0, 5).map(l => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #222;">${l.title}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;text-align:center;">${l.clicks}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;padding:32px;">
  <div style="max-width:600px;margin:0 auto;">
    <h1 style="color:#ffd700;font-size:20px;margin-bottom:4px;">Kortex Weekly Digest</h1>
    <p style="color:#888;font-size:13px;margin-bottom:24px;">${tenantName} — Week ending ${new Date().toLocaleDateString()}</p>

    ${drops.length > 0 ? `
    <h2 style="color:#ef4444;font-size:16px;margin-bottom:12px;">Links That Need Attention</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="border-bottom:2px solid #333;">
          <th style="text-align:left;padding:8px 12px;color:#888;">Link</th>
          <th style="text-align:center;padding:8px 12px;color:#888;">Last Week</th>
          <th style="text-align:center;padding:8px 12px;color:#888;">This Week</th>
          <th style="text-align:center;padding:8px 12px;color:#888;">Change</th>
        </tr>
      </thead>
      <tbody>${dropRows}</tbody>
    </table>
    ` : '<p style="color:#22c55e;">All links performing steady this week.</p>'}

    <h2 style="color:#ffd700;font-size:16px;margin:24px 0 12px;">Top Performers</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="border-bottom:2px solid #333;">
          <th style="text-align:left;padding:8px 12px;color:#888;">Link</th>
          <th style="text-align:center;padding:8px 12px;color:#888;">Clicks</th>
        </tr>
      </thead>
      <tbody>${topRows}</tbody>
    </table>

    <p style="margin-top:32px;font-size:12px;color:#666;">
      This is your weekly Kortex digest. <a href="https://kaayko.com/admin/kortex.html" style="color:#ffd700;">Open Dashboard</a>
    </p>
  </div>
</body>
</html>`;
}

/**
 * Generate digest data for a single tenant
 */
async function generateTenantDigest(tenantId, tenantName) {
  const now = new Date();
  const thisWeekEnd = new Date(now);
  const thisWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastWeekEnd = new Date(thisWeekStart);
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const thisWeek = await getLinkClicksInRange(tenantId, thisWeekStart, thisWeekEnd);
  const lastWeek = await getLinkClicksInRange(tenantId, lastWeekStart, lastWeekEnd);

  const drops = findDrops(thisWeek, lastWeek);

  const topLinks = Object.entries(thisWeek)
    .map(([code, data]) => ({ code, ...data }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);

  return { drops, topLinks, html: buildDigestHtml(tenantName, drops, topLinks) };
}

/**
 * Run weekly digest for all active tenants (Pro+ only)
 */
async function runWeeklyDigest() {
  const tenantsSnap = await db.collection('tenants')
    .where('plan', 'in', ['pro', 'business', 'enterprise'])
    .get();

  const results = [];

  for (const doc of tenantsSnap.docs) {
    const tenant = doc.data();
    const tenantId = doc.id;

    try {
      const digest = await generateTenantDigest(tenantId, tenant.name || tenantId);

      // Store digest for retrieval via dashboard
      await db.collection('analytics_digests').add({
        tenantId,
        drops: digest.drops,
        topLinks: digest.topLinks,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        weekEnding: new Date().toISOString()
      });

      // Store email for sending (email service picks up from this collection)
      if (tenant.contactEmail || tenant.adminEmail) {
        await db.collection('pending_emails').add({
          to: tenant.contactEmail || tenant.adminEmail,
          subject: digest.drops.length > 0
            ? `Kortex: ${digest.drops.length} link(s) dropped this week`
            : 'Kortex: Your weekly link digest',
          html: digest.html,
          tenantId,
          type: 'weekly_digest',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      results.push({ tenantId, drops: digest.drops.length, status: 'ok' });
    } catch (error) {
      console.error(`[AnalyticsAlert] Failed for tenant ${tenantId}:`, error);
      results.push({ tenantId, status: 'error', error: error.message });
    }
  }

  return results;
}

module.exports = {
  runWeeklyDigest,
  generateTenantDigest,
  findDrops,
  getLinkClicksInRange,
  buildDigestHtml
};
