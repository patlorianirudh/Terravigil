import { describe, expect, it } from 'vitest';

import {
  toCoverageSummary,
  toDetection,
  toScanSession,
  toSafePathResult,
  toTrackPoint,
  toReportItem,
} from './mappers';

/**
 * These tests guard one rule, and it is a safety rule: a value the backend did
 * not report must arrive as `null`, so the UI renders an em-dash instead of a
 * number an operator could act on. A regression here would put invented
 * measurements back on screen without anything failing loudly.
 */
describe('detection mapping', () => {
  const minimal = { id: 'D1', sessionId: 'S1', position: { lat: 17.1, lon: 78.2 } };

  it('leaves unreported measurements null rather than zero', () => {
    const d = toDetection({ ...minimal, classification: 'unconfirmed_visual' });
    expect(d).not.toBeNull();
    expect(d?.localizationUncertaintyM).toBeNull();
    expect(d?.bestVisualConfidence).toBeNull();
    expect(d?.bestMetalSignalNorm).toBeNull();
    expect(d?.corroborationCount).toBeNull();
  });

  it('retains stored risk separately from confirmation', () => {
    // An unconfirmed observation can retain its stored HIGH band.
    const d = toDetection({
      ...minimal,
      classification: 'unresolved_metal',
      riskScore: 0.91,
      riskBand: 'high',
    });
    expect(d?.riskScore).toBe(0.91);
    expect(d?.riskBand).toBe('high');
    expect(d?.riskInputs).toBeNull();
  });

  it('keeps risk on a confirmed detection', () => {
    const d = toDetection({
      ...minimal,
      classification: 'confirmed',
      riskScore: 0.72,
      riskBand: 'high',
      bestMetalStandoffM: 0.38,
    });
    expect(d?.riskScore).toBe(0.72);
    expect(d?.riskBand).toBe('high');
    expect(d?.bestMetalStandoffM).toBe(0.38);
  });

  it('drops rows it cannot render honestly', () => {
    expect(toDetection({ ...minimal, classification: 'mine' })).toBeNull();
    expect(toDetection({ id: 'D2', sessionId: 'S1', classification: 'confirmed' })).toBeNull();
  });
});

describe('telemetry mapping', () => {
  it('rejects non-numeric and NaN readings', () => {
    const t = toTrackPoint({
      sessionId: 'S1',
      position: { lat: 1, lon: 2 },
      groundSpeedMs: 'fast' as unknown as number,
      hdop: Number.NaN,
    });
    expect(t?.groundSpeedMs).toBeNull();
    expect(t?.hdop).toBeNull();
    expect(t?.pass).toBeNull();
    expect(t?.isUndersampled).toBeNull();
    expect(t?.tUtc).toBe('');
  });
});

describe('session, coverage and route mapping', () => {
  it('does not invent session thresholds', () => {
    const s = toScanSession({ id: 'S1', startedAt: '2026-01-01T00:00:00Z' });
    expect(s?.config.visualConfidenceThreshold).toBeNull();
    expect(s?.config.metalThresholdNorm).toBeNull();
    expect(s?.utmEpsg).toBeNull();
    expect(s?.siteName).toBe('S1');
  });

  it('reports unknown swept area as unknown, not as zero', () => {
    const c = toCoverageSummary({}, 'S9');
    expect(c.sessionId).toBe('S9');
    expect(c.visualSweptAreaM2).toBeNull();
    expect(c.dualSweptAreaM2).toBeNull();
  });

  it('treats a route as not found unless the backend says otherwise', () => {
    const r = toSafePathResult({}, 'S9');
    expect(r.pathFound).toBe(false);
    expect(r.waypoints).toEqual([]);
    expect(r.totalDistanceM).toBeNull();
  });
});

it('does not mark a report without a file ready to download', () => {
  expect(toReportItem({ id: 'R1', sessionId: 'M1', status: 'ready' })?.status).not.toBe('ready');
});
