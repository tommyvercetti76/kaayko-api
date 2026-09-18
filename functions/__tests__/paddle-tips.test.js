const { getPreparationTips } = require('../api/weather/paddleTips');

const warm = { temperature: 29.3, humidity: 35, windSpeed: 15.1, uvIndex: 7.2, cloudCover: 88, isDay: true };

describe('preparation tips', () => {
  test('no water sensor → no drysuit tip (null must not read as 0 °C)', () => {
    const tips = getPreparationTips({ conditions: { ...warm, waterTemp: null, waterTempMeasured: false } });
    expect(tips.map(t => t.code)).not.toContain('COLD_WATER');
  });

  test('estimated cold water still does not fire the drysuit tip', () => {
    const tips = getPreparationTips({ conditions: { ...warm, waterTemp: 8, waterTempMeasured: false } });
    expect(tips.map(t => t.code)).not.toContain('COLD_WATER');
  });

  test('measured cold water fires it at priority 1', () => {
    const tips = getPreparationTips({ conditions: { ...warm, waterTemp: 8, waterTempMeasured: true } });
    expect(tips[0].code).toBe('COLD_WATER');
  });

  test('missing temperature → no hydration tip; hot day → hydration with litres', () => {
    expect(getPreparationTips({ conditions: { ...warm, temperature: null } }).map(t => t.code)).not.toContain('HYDRATION');
    const hot = getPreparationTips({ conditions: warm }).find(t => t.code === 'HYDRATION');
    expect(hot.values.waterLiters).toBe(1.5);
  });

  // Updated 18 Sep 2026 (audit finding #16): a flow tip now requires a LIVE
  // reading. A band with no observation time is undated and fires nothing;
  // the fresh-vs-stale contract is covered in api/weather/__tests__/flowTips.test.js.
  test('low river flow → FLOW_LOW; high → FLOW_HIGH (fresh readings only)', () => {
    const fresh = () => ({ discharge: { cms: 1, observedAt: new Date().toISOString() }, stale: false });
    expect(getPreparationTips({ conditions: warm, hydrology: { ...fresh(), pctOfNormalBand: 'low' } }).map(t => t.code)).toContain('FLOW_LOW');
    expect(getPreparationTips({ conditions: warm, hydrology: { ...fresh(), pctOfNormalBand: 'high' } }).map(t => t.code)).toContain('FLOW_HIGH');
    expect(getPreparationTips({ conditions: warm, hydrology: { pctOfNormalBand: 'high' } }).map(t => t.code)).not.toContain('FLOW_HIGH');
  });
});
