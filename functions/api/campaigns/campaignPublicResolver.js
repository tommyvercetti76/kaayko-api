'use strict';

const express = require('express');
const admin = require('firebase-admin');
const { handleRedirect } = require('../kortex/redirectHandler');
const { DEFAULT_TENANT_ID } = require('../kortex/tenantContext');

const router = express.Router();
const db = admin.firestore();

// Never shadow existing mounted API or legacy routes.
const RESERVED_SLUGS = new Set([
  'l',
  'resolve',
  'health',
  'helloWorld',
  'smartlinks',
  'campaigns',
  'auth',
  'billing',
  'products',
  'images',
  'paddlingOut',
  'docs',
  'nearbyWater',
  'paddleScore',
  'fastForecast',
  'forecast',
  'alumni',
  'kreators',
  'gptActions',
  'createPaymentIntent',
  'admin',
  'kutz',
  'cameras',
  'lenses',
  'presets'
]);

function normalizeHost(rawHost = '') {
  return String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/:\\d+$/, '');
}

function isKaaykoDefaultHost(host) {
  return host === 'kaayko.com' || host === 'www.kaayko.com' || host === '';
}

function campaignErrorPage(code, title, message) {
  const icon = code === 410 ? '⏰' : '🔍';
  return `<!DOCTYPE html>
<html>
<head>
  <title>${title} | Kaayko</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#080808; color:#f0f0f0; margin:0; }
    .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
    .card { max-width:460px; width:100%; text-align:center; border:1px solid #1e1e1e; border-radius:16px; padding:26px; background:#0d0d0d; }
    .icon { font-size:44px; margin-bottom:10px; }
    h1 { margin:0 0 10px; font-size:26px; color:#f7f7f7; }
    p { margin:0 0 18px; color:#989898; line-height:1.6; }
    a { display:inline-block; text-decoration:none; color:#080808; background:#D4A84B; font-weight:700; padding:11px 22px; border-radius:10px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="icon">${icon}</div>
      <h1>${title}</h1>
      <p>${message}</p>
      <a href="https://kaayko.com">Go to Kaayko</a>
    </div>
  </div>
</body>
</html>`;
}

async function resolveTenantForHost(host) {
  if (isKaaykoDefaultHost(host)) {
    return {
      id: DEFAULT_TENANT_ID,
      domain: 'kaayko.com',
      name: 'Kaayko'
    };
  }

  const snapshot = await db.collection('tenants').where('domain', '==', host).limit(1).get();
  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const tenant = doc.data() || {};
  if (tenant.enabled === false) return null;

  return {
    id: doc.id,
    domain: tenant.domain || host,
    name: tenant.name || doc.id
  };
}

function pickCampaignForTenant(campaigns, tenantId, host) {
  const tenantScoped = campaigns.filter(c => (c.tenantId || DEFAULT_TENANT_ID) === tenantId);
  if (!tenantScoped.length) return null;

  const hostScoped = tenantScoped.filter(c => !c.domain || normalizeHost(c.domain) === host);
  if (!hostScoped.length) return null;

  const active = hostScoped.find(c => c.status === 'active');
  if (active) return { campaign: active, inactive: false };

  // Campaign exists for this tenant+host+slug, but is not active.
  return { campaign: hostScoped[0], inactive: true };
}

router.get('/:campaignSlug/:code', async (req, res, next) => {
  try {
    const campaignSlug = String(req.params.campaignSlug || '').trim().toLowerCase();
    const code = String(req.params.code || '').trim().toLowerCase();

    if (!campaignSlug || !code) return next();
    if (RESERVED_SLUGS.has(campaignSlug)) return next();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(campaignSlug)) return next();
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(code)) return next();

    const host = normalizeHost(req.headers.host || req.hostname || '');
    const tenant = await resolveTenantForHost(host);

    // Fail closed for unknown domains.
    if (!tenant) {
      return res.status(404).send(campaignErrorPage(
        404,
        'Campaign Not Found',
        'This campaign URL is not available for this domain.'
      ));
    }

    const snapshot = await db.collection('campaigns').where('slug', '==', campaignSlug).limit(25).get();
    if (snapshot.empty) {
      return res.status(404).send(campaignErrorPage(
        404,
        'Campaign Not Found',
        `No campaign is configured for "${campaignSlug}".`
      ));
    }

    const found = pickCampaignForTenant(
      snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      tenant.id,
      host
    );

    if (!found) {
      return res.status(404).send(campaignErrorPage(
        404,
        'Campaign Not Found',
        'This campaign is not available for this tenant domain.'
      ));
    }

    if (found.inactive) {
      return res.status(410).send(campaignErrorPage(
        410,
        'Campaign Unavailable',
        'This campaign is currently paused, archived, or expired.'
      ));
    }

    const campaign = found.campaign;
    const campaignId = campaign.campaignId || campaign.id;

    // Check campaign expiry
    if (campaign.settings?.expiresAt) {
      const expiryTime = new Date(campaign.settings.expiresAt);
      if (expiryTime < new Date()) {
        return res.status(410).send(campaignErrorPage(
          410,
          'Campaign Expired',
          'This campaign has reached its end date and is no longer available.'
        ));
      }
    }

    const linkDocId = `${campaignId}_${code}`;
    const linkDoc = await db.collection('campaign_links').doc(linkDocId).get();
    if (!linkDoc.exists) {
      return res.status(404).send(campaignErrorPage(
        404,
        'Link Not Found',
        'This campaign link does not exist.'
      ));
    }

    const link = linkDoc.data() || {};
    if ((link.tenantId || DEFAULT_TENANT_ID) !== tenant.id || (link.campaignId || '') !== campaignId) {
      // Fail closed if data mismatch is detected.
      return res.status(404).send(campaignErrorPage(
        404,
        'Link Not Found',
        'This campaign link is not available.'
      ));
    }

    if (link.status !== 'active') {
      return res.status(410).send(campaignErrorPage(
        410,
        'Link Unavailable',
        'This campaign link is currently paused or inactive.'
      ));
    }

    // Check link max-uses enforcement
    const maxUsesPerLink = campaign.settings?.maxUsesPerLink || 0; // 0 = unlimited
    if (maxUsesPerLink > 0 && (link.usesCount || 0) >= maxUsesPerLink) {
      return res.status(410).send(campaignErrorPage(
        410,
        'Link Limit Reached',
        'This campaign link has reached its maximum usage limit.'
      ));
    }

    const shortLinkCode = String(link.shortLinkCode || `${campaign.slug}_${code}`);
    return handleRedirect(req, res, shortLinkCode, { trackAnalytics: true });
  } catch (error) {
    console.error('[CampaignResolver] Error:', error);
    return res.status(500).send(campaignErrorPage(
      500,
      'Redirect Error',
      'Something went wrong while resolving this campaign link.'
    ));
  }
});

module.exports = router;
