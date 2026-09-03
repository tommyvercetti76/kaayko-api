/**
 * Link status + the pages served for links that are not live.
 *
 * A short link is one of:
 *   active  — resolves normally (legacy documents without a status field count as active)
 *   held    — created, but waiting for review; visitors see a neutral "under review" page
 *   blocked — refused by the safety layer or an operator; visitors see a 410 page
 *
 * Every resolver (redirectHandler, tenantLinkResolver, campaign resolver via the
 * short_links mirror) checks the status through `effectiveStatus` so a hold or
 * block takes effect on the next request without a cache to purge.
 *
 * @module api/kortex/safetyPages
 */

'use strict';

const LINK_STATUS = Object.freeze({ ACTIVE: 'active', HELD: 'held', BLOCKED: 'blocked' });
const APPEAL_PAGE = 'https://kaayko.com/kortex/appeal';

function effectiveStatus(link) {
  const status = link?.status;
  if (status === LINK_STATUS.HELD || status === LINK_STATUS.BLOCKED) return status;
  return LINK_STATUS.ACTIVE;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page({ title, heading, message, code, tone }) {
  const safeTitle = escapeHtml(title);
  const safeHeading = escapeHtml(heading);
  const safeMessage = escapeHtml(message);
  const safeCode = escapeHtml(code || '');
  const appealHref = `${APPEAL_PAGE}?code=${encodeURIComponent(code || '')}`;
  const accent = tone === 'blocked' ? '#e05a4f' : '#D4A84B';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${safeTitle}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#080808;color:#f0f0f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{max-width:440px;width:100%;text-align:center;border:1px solid #1e1e1e;border-radius:16px;padding:28px;background:#0d0d0d}
    .mark{display:inline-block;width:10px;height:10px;border-radius:50%;background:${accent};margin-bottom:14px}
    h1{font-size:22px;margin-bottom:10px;color:#f7f7f7}
    p{color:#9a9a9a;line-height:1.6;font-size:15px}
    p+p{margin-top:10px}
    code{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#cfcfcf;background:#161616;padding:2px 6px;border-radius:4px}
    a{display:inline-block;margin-top:20px;color:#080808;background:${accent};font-weight:700;padding:11px 20px;border-radius:10px;text-decoration:none}
    .foot{margin-top:18px;font-size:12px;color:#555}
  </style>
</head>
<body>
  <div class="card">
    <span class="mark"></span>
    <h1>${safeHeading}</h1>
    <p>${safeMessage}</p>
    <p>Link <code>${safeCode}</code></p>
    <a href="${appealHref}">Request a review</a>
    <div class="foot">Kortex checks every destination before and after a link goes live.</div>
  </div>
</body>
</html>`;
}

function heldPage(code) {
  return page({
    title: 'Link under review',
    heading: 'This link is being reviewed',
    message: 'The destination is new to us and is being checked before the link goes live. This usually takes less than a day. If you created this link, you will be able to see its status in your dashboard.',
    code,
    tone: 'held'
  });
}

function blockedPage(code) {
  return page({
    title: 'Link unavailable',
    heading: 'This link has been disabled',
    message: 'The destination was flagged as unsafe or against our rules, so Kortex has stopped forwarding visitors to it. If you believe this is a mistake, you can ask for a review.',
    code,
    tone: 'blocked'
  });
}

/**
 * Serve the right page for a non-active link. Returns true when a response was sent.
 */
function respondForStatus(res, link, code) {
  const status = effectiveStatus(link);
  if (status === LINK_STATUS.HELD) {
    res.status(200)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .set('X-Robots-Tag', 'noindex')
      .send(heldPage(code));
    return true;
  }
  if (status === LINK_STATUS.BLOCKED) {
    res.status(410)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .set('X-Robots-Tag', 'noindex')
      .send(blockedPage(code));
    return true;
  }
  return false;
}

module.exports = { LINK_STATUS, APPEAL_PAGE, effectiveStatus, heldPage, blockedPage, respondForStatus, escapeHtml };
