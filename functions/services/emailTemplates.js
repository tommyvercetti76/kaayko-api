/**
 * Email Templates for Smart Links Notifications
 * Split from emailNotificationService.js — HTML/text template builders.
 *
 * @module services/emailTemplates
 */

const APP_NAME = 'Kaayko Smart Links';

/** HTML escape helper */
function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.toString().replace(/[&<>"']/g, m => map[m]);
}

/** Format Firestore/Date timestamp for display */
function formatDate(timestamp) {
  let date;
  if (timestamp._seconds) date = new Date(timestamp._seconds * 1000);
  else if (timestamp instanceof Date) date = timestamp;
  else date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles'
  });
}

/**
 * Build link-created notification email
 * @param {Object} link - Created link
 * @param {Object} creator - Creator info
 * @returns {{ subject: string, htmlBody: string, textBody: string }}
 */
function buildLinkCreatedEmail(link, creator) {
  const code = link.code || link.shortCode || link.id;
  const shortUrl = link.shortUrl || `https://kaayko.com/l/${code}`;
  const destinations = link.destinations || {};
  const subject = `✅ New Smart Link Created: ${code}`;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(shortUrl)}`;
  const qrHiRes = `https://api.qrserver.com/v1/create-qr-code/?size=1024x1024&data=${encodeURIComponent(shortUrl)}`;

  const detailRow = (label, value) =>
    `<div class="detail-row"><span class="detail-label">${label}:</span><span class="detail-value">${value}</span></div>`;

  const optionalRow = (label, val) => val ? detailRow(label, escapeHtml(val)) : '';

  const utmSection = (link.utm && Object.keys(link.utm).length > 0)
    ? `<div class="details"><h3 style="color:#d4af37;margin-bottom:15px">UTM Parameters</h3>${Object.entries(link.utm).map(([k, v]) => detailRow(k, escapeHtml(v))).join('')}</div>`
    : '';

  const htmlBody = `<!DOCTYPE html><html><head><style>
body{font-family:'Montserrat',Arial,sans-serif;line-height:1.6;color:#333}
.container{max-width:600px;margin:0 auto;padding:20px;background:#f9f9f9}
.header{background:linear-gradient(135deg,#d4af37 0%,#c4961a 100%);color:#fff;padding:30px;text-align:center;border-radius:8px 8px 0 0}
.content{background:#fff;padding:30px;border-radius:0 0 8px 8px;box-shadow:0 2px 4px rgba(0,0,0,.1)}
.link-box{background:#f5f5f5;border-left:4px solid #d4af37;padding:15px;margin:20px 0;border-radius:4px}
.short-url{font-size:18px;font-weight:700;color:#d4af37;word-break:break-all}
.details{margin:20px 0}
.detail-row{padding:8px 0;border-bottom:1px solid #eee}
.detail-label{font-weight:600;color:#666;display:inline-block;width:140px}
.detail-value{color:#333}
.qr-section{text-align:center;margin:30px 0;padding:20px;background:#f9f9f9;border-radius:8px}
.qr-image{max-width:200px;margin:10px auto}
.footer{text-align:center;margin-top:30px;padding-top:20px;border-top:2px solid #eee;color:#666;font-size:12px}
.btn{display:inline-block;padding:12px 24px;background:#d4af37;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;margin:10px 5px}
.btn:hover{background:#c4961a}
</style></head><body><div class="container">
<div class="header"><h1>🔗 New Smart Link Created</h1><p>A new short link has been added to your Kaayko Smart Links system</p></div>
<div class="content">
<div class="link-box"><div style="color:#666;margin-bottom:5px">Your Short Link:</div><div class="short-url">${shortUrl}</div></div>
<div class="details"><h3 style="color:#d4af37;margin-bottom:15px">Link Details</h3>
${detailRow('Short Code', `<strong>${code}</strong>`)}
${optionalRow('Title', link.title)}
${optionalRow('Description', link.description)}
${detailRow('Web Destination', `<span style="word-break:break-all">${escapeHtml(destinations.web || 'N/A')}</span>`)}
${optionalRow('iOS Destination', destinations.ios)}
${optionalRow('Android Destination', destinations.android)}
${detailRow('Created By', creator?.email || link.createdBy || 'System')}
${detailRow('Status', link.enabled !== false ? '✅ Active' : '❌ Disabled')}
${link.expiresAt ? detailRow('Expires', formatDate(link.expiresAt)) : ''}
</div>
${utmSection}
<div class="qr-section"><h3 style="color:#d4af37;margin-bottom:10px">📱 QR Code</h3>
<p style="color:#666;margin-bottom:15px">Scan to access this link instantly</p>
<img src="${qrUrl}" alt="QR Code for ${code}" class="qr-image">
<div style="margin-top:15px"><a href="${qrHiRes}" class="btn">⬇️ Download High-Res QR</a></div></div>
<div style="text-align:center;margin-top:30px">
<a href="https://kaayko.com/admin/kortex.html" class="btn">🔗 View in Dashboard</a>
<a href="${shortUrl}" class="btn" style="background:#666">🔍 Test Link</a></div></div>
<div class="footer"><p><strong>${APP_NAME}</strong></p><p>Enterprise Link Management System</p>
<p style="margin-top:10px">This is an automated notification. Please do not reply to this email.</p>
<p style="color:#999;margin-top:15px">Questions? Contact support at <a href="mailto:rohan@kaayko.com" style="color:#d4af37">rohan@kaayko.com</a></p></div>
</div></body></html>`;

  const textBody = `New Smart Link Created\n\nShort Link: ${shortUrl}\nCode: ${code}
${link.title ? `Title: ${link.title}\n` : ''}${link.description ? `Description: ${link.description}\n` : ''}
Destinations:\n- Web: ${destinations.web || 'N/A'}
${destinations.ios ? `- iOS: ${destinations.ios}\n` : ''}${destinations.android ? `- Android: ${destinations.android}\n` : ''}
Created By: ${creator?.email || link.createdBy || 'System'}
Status: ${link.enabled !== false ? 'Active' : 'Disabled'}
${link.expiresAt ? `Expires: ${formatDate(link.expiresAt)}\n` : ''}
QR Code: ${qrUrl}\nView in Dashboard: https://kaayko.com/admin/kortex.html\nTest Link: ${shortUrl}
\n---\n${APP_NAME} - Enterprise Link Management System\nThis is an automated notification.`;

  return { subject, htmlBody, textBody };
}

module.exports = { buildLinkCreatedEmail, escapeHtml, formatDate };
