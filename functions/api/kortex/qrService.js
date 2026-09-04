/**
 * Branded QR Code Service — Pro feature
 * Generates QR codes with custom colors, logo center, and scan tracking
 */

const QRCode = require('qrcode');
const { scanUrl } = require('./utmTools');
const admin = require('firebase-admin');
const db = admin.firestore();

const DEFAULT_OPTIONS = {
  width: 400,
  margin: 2,
  color: { dark: '#000000', light: '#ffffff' },
  errorCorrectionLevel: 'H' // High — allows 30% obstruction for logo overlay
};

/**
 * Generate QR code as data URL (PNG base64)
 */
async function generateQR(url, options = {}) {
  const qrOptions = {
    ...DEFAULT_OPTIONS,
    width: options.size || DEFAULT_OPTIONS.width,
    margin: options.margin ?? DEFAULT_OPTIONS.margin,
    color: {
      dark: options.foreground || DEFAULT_OPTIONS.color.dark,
      light: options.background || DEFAULT_OPTIONS.color.light
    },
    errorCorrectionLevel: options.logoUrl ? 'H' : (options.errorCorrectionLevel || 'M')
  };

  const dataUrl = await QRCode.toDataURL(url, qrOptions);
  return dataUrl;
}

/**
 * Generate QR code as SVG string
 */
async function generateQRSvg(url, options = {}) {
  const svgOptions = {
    type: 'svg',
    width: options.size || DEFAULT_OPTIONS.width,
    margin: options.margin ?? DEFAULT_OPTIONS.margin,
    color: {
      dark: options.foreground || DEFAULT_OPTIONS.color.dark,
      light: options.background || DEFAULT_OPTIONS.color.light
    },
    errorCorrectionLevel: options.logoUrl ? 'H' : (options.errorCorrectionLevel || 'M')
  };

  const svg = await QRCode.toString(url, svgOptions);

  // If logo requested, embed it in center of SVG
  if (options.logoUrl) {
    const size = options.size || DEFAULT_OPTIONS.width;
    const logoSize = Math.round(size * 0.22);
    const logoPos = Math.round((size - logoSize) / 2);
    const logoEmbed = `
      <rect x="${logoPos - 4}" y="${logoPos - 4}" width="${logoSize + 8}" height="${logoSize + 8}"
            fill="${options.background || '#ffffff'}" rx="8"/>
      <image href="${options.logoUrl}" x="${logoPos}" y="${logoPos}"
             width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>
    `;
    return svg.replace('</svg>', `${logoEmbed}</svg>`);
  }

  return svg;
}

/**
 * Check if tenant has Pro+ plan (QR branding is Pro feature)
 */
async function canUseBrandedQR(tenantId) {
  if (!tenantId || tenantId === 'kaayko-default') return false;
  const snap = await db.collection('tenants').doc(tenantId).get();
  if (!snap.exists) return false;
  const plan = snap.data().plan || 'starter';
  return ['pro', 'business', 'enterprise'].includes(plan);
}

/**
 * Track QR scan (increments scan counter on link doc)
 */
async function trackQRScan(code) {
  try {
    const linkRef = db.collection('short_links').doc(code);
    await linkRef.update({
      qrScans: admin.firestore.FieldValue.increment(1),
      lastQrScan: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('[QR] Scan tracking failed:', error.message);
  }
}

const QR_FILE_PATTERN = /^([a-zA-Z0-9_-]{3,80})\.(png|svg)$/;

/**
 * Serve the QR image for a live short link: GET /qr/<code>.png|svg
 * (kaayko.com/qr/… via the hosting rewrite, and /api/kortex/qr/…).
 * The QR encodes the public short URL, so nothing secret is involved; a
 * link that is missing, disabled, held or blocked answers 404.
 */
async function serveLinkQr(req, res) {
  const match = QR_FILE_PATTERN.exec(String(req.params.file || ''));
  if (!match) return res.status(404).json({ success: false, error: 'Not found' });
  const [, code, format] = match;

  const snap = await db.collection('short_links').doc(code).get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Not found' });
  const link = snap.data() || {};
  if (link.enabled === false || link.status === 'held' || link.status === 'blocked') {
    return res.status(404).json({ success: false, error: 'Not found' });
  }

  const size = Math.max(128, Math.min(1024, Number(req.query.size) || 512));
  // Every QR Kortex renders carries the scan marker, so scans count separately from taps.
  const target = scanUrl(link.shortUrl || `https://kaayko.com/l/${code}`);
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('X-Content-Type-Options', 'nosniff');

  if (format === 'svg') {
    const svg = await generateQRSvg(target, { size, margin: 2 });
    return res.type('image/svg+xml').send(svg);
  }
  const dataUrl = await generateQR(target, { size, margin: 2 });
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  return res.type('image/png').send(png);
}

module.exports = {
  generateQR,
  generateQRSvg,
  canUseBrandedQR,
  trackQRScan,
  serveLinkQr
};
