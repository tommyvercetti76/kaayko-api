#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const CAMERA_DIR = path.join(FUNCTIONS_DIR, 'api', 'cameras');
const DOCS_DIR = path.join(FUNCTIONS_DIR, 'docs', 'cameras');

const BRAND_CONFIG = {
  canon: {
    allowedDomains: ['canon.com'],
  },
  sony: {
    allowedDomains: ['sony.com', 'support.d-imaging.sony.co.jp'],
  },
};

const REQUIRED_PROVENANCE_FIELDS = [
  'status',
  'sourceUrls',
  'verifiedAt',
  'verifiedBy',
  'verificationScope',
  'validationTier',
];

function loadRecords(kind, brand) {
  const payload = require(path.join(CAMERA_DIR, `data_${kind}`, `${brand}.json`));
  return payload[kind];
}

function officialUrlAllowed(brand, url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BRAND_CONFIG[brand].allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch (error) {
    return false;
  }
}

function validateRecord(kind, brand, record, keyField) {
  const errors = [];

  for (const field of REQUIRED_PROVENANCE_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0) || value === '') {
      errors.push(`${kind}:${brand}:${record[keyField]} missing ${field}`);
    }
  }

  for (const url of record.sourceUrls || []) {
    if (!officialUrlAllowed(brand, url)) {
      errors.push(`${kind}:${brand}:${record[keyField]} has non-official source URL ${url}`);
    }
  }

  return errors;
}

function assertFile(relativePath) {
  const fullPath = path.join(DOCS_DIR, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing validation artifact: ${path.relative(FUNCTIONS_DIR, fullPath)}`);
  }
}

function main() {
  const errors = [];

  for (const brand of Object.keys(BRAND_CONFIG)) {
    const cameras = loadRecords('cameras', brand);
    const lenses = loadRecords('lenses', brand);

    for (const camera of cameras) {
      errors.push(...validateRecord('camera', brand, camera, 'modelName'));
    }

    for (const lens of lenses) {
      errors.push(...validateRecord('lens', brand, lens, 'lensName'));
    }
  }

  assertFile('COMMUNITY_REVIEW_PACKET.md');
  assertFile('COMMUNITY_REVIEW_PACKET.json');
  assertFile('COMMUNITY_REVIEW_LOG_TEMPLATE.csv');

  if (errors.length) {
    throw new Error(`Camera catalog validation failed:\n${errors.join('\n')}`);
  }

  console.log('Camera catalog validation passed.');
}

main();
