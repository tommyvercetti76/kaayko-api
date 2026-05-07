/**
 * Branded QR Code Service — Pro feature
 * Generates QR codes with custom colors, logo center, and scan tracking
 */

const QRCode = require('qrcode');
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

module.exports = {
  generateQR,
  generateQRSvg,
  canUseBrandedQR,
  trackQRScan
};
