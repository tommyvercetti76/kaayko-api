/**
 * Scheduled safety work: threat-feed sync and the daily re-scan.
 */

require('./helpers/mockSetup');

const admin = require('firebase-admin');
const safety = require('../api/kortex/destinationSafety');
const jobs = require('../api/kortex/safetyJobs');

beforeEach(() => {
  admin._mocks.resetAll();
  safety.resetCaches();
  delete process.env.GOOGLE_SAFE_BROWSING_API_KEY;
});

const URLHAUS = `# URLhaus hostfile\n127.0.0.1\tmalware-drop.example\n127.0.0.1\tanother-bad.example\n`;
const OPENPHISH = `https://phish-login.example/verify\nhttps://phish-login.example/other\nhttps://bank-fake.example/\n`;

describe('syncThreatFeeds', () => {
  test('merges both feeds into one host list in Storage and clears the runtime cache', async () => {
    const fetchImpl = jest.fn(async (url) => ({
      ok: true,
      text: async () => (url.includes('urlhaus') ? URLHAUS : OPENPHISH)
    }));
    const summary = await jobs.syncThreatFeeds({ fetchImpl });
    expect(summary.written).toBe(true);
    expect(summary.totalHosts).toBe(4);
    expect(summary.feeds.urlhaus.hosts).toBe(2);
    expect(summary.feeds.openphish.hosts).toBe(2);

    const file = admin._mocks.storageFiles()[safety.FEED_OBJECT_PATH];
    expect(file).toContain('phish-login.example');
    expect(file).toContain('malware-drop.example');

    const verdict = await safety.assessDestination('https://bank-fake.example/', { tenantId: 't', purpose: 'create' });
    expect(verdict.verdict).toBe('block');
  });

  test('a failed feed is skipped, the other one is still published', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.includes('urlhaus')) throw new Error('timeout');
      return { ok: true, text: async () => OPENPHISH };
    });
    const summary = await jobs.syncThreatFeeds({ fetchImpl });
    expect(summary.written).toBe(true);
    expect(summary.feeds.urlhaus.ok).toBe(false);
    expect(summary.totalHosts).toBe(2);
  });

  test('nothing is written when every feed fails', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('offline'); });
    const summary = await jobs.syncThreatFeeds({ fetchImpl });
    expect(summary.written).toBe(false);
    expect(admin._mocks.storageFiles()[safety.FEED_OBJECT_PATH]).toBeUndefined();
  });
});

describe('rescanActiveLinks', () => {
  const live = (code, web, extra = {}) => {
    admin._mocks.docData[`short_links/${code}`] = {
      code, tenantId: 'tenant-a', enabled: true, status: 'active', title: code,
      destinations: { web, ios: null, android: null }, createdAt: new Date(), ...extra
    };
  };

  test('blocks a live link whose destination is now blocklisted, alerts and audits it', async () => {
    live('turned-bad', 'https://now-bad.example/promo');
    live('still-fine', 'https://kaayko.com/store');
    admin._mocks.docData['kortex_blocked_hosts/now-bad.example'] = { host: 'now-bad.example' };

    const result = await jobs.rescanActiveLinks({ limit: 50 });
    expect(result.scanned).toBe(2);
    expect(result.blocked.map(b => b.code)).toEqual(['turned-bad']);

    expect(admin._mocks.docData['short_links/turned-bad'].status).toBe('blocked');
    expect(admin._mocks.docData['short_links/turned-bad'].safety.checkedBy).toBe('rescan');
    expect(admin._mocks.docData['short_links/still-fine'].status).toBe('active');
    expect(admin._mocks.docData['short_links/still-fine'].safety.checkedBy).toBe('rescan');

    const alerts = Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith('security_alerts/')).map(([, v]) => v);
    expect(alerts.some(a => a.type === 'destination_blocked' && a.code === 'turned-bad')).toBe(true);
    const audits = Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith('kortex_audit_logs/')).map(([, v]) => v);
    expect(audits.some(a => a.action === 'link.blocked' && a.code === 'turned-bad' && a.actor.name === 'rescan')).toBe(true);
  });

  test('uses one Safe Browsing call for the whole page', async () => {
    process.env.GOOGLE_SAFE_BROWSING_API_KEY = 'k';
    live('a', 'https://a.example/');
    live('b', 'https://b.example/');
    live('c', 'https://c.example/');
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ matches: [{ threat: { url: 'https://b.example/' }, threatType: 'MALWARE' }] }) }));
    const result = await jobs.rescanActiveLinks({ limit: 50, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.blocked.map(b => b.code)).toEqual(['b']);
  });

  test('never holds on a re-scan, even for an unknown domain on a new tenant', async () => {
    live('unknown-domain', 'https://totally-new.example/');
    const result = await jobs.rescanActiveLinks({ limit: 50 });
    expect(result.blocked).toHaveLength(0);
    expect(admin._mocks.docData['short_links/unknown-domain'].status).toBe('active');
  });

  test('records progress in the meta document', async () => {
    live('x', 'https://kaayko.com/');
    await jobs.rescanActiveLinks({ limit: 50 });
    const meta = admin._mocks.docData[jobs.RESCAN_META_DOC];
    expect(meta.lastRun.scanned).toBe(1);
    expect(meta.cursorCreatedAt).toBeNull();
  });
});
