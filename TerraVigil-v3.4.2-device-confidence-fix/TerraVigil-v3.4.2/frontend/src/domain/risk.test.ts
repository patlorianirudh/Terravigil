import { describe, expect, it } from 'vitest';

import { clamp01, computeRisk } from './risk';

/**
 * `risk-v1` is deterministic (PRD §11.3). The detection detail page recomputes
 * a server-reported score with this function and flags a mismatch, so its
 * arithmetic has to be exact — a drift here would turn the audit line into a
 * false accusation, or hide a real one.
 */
describe('clamp01', () => {
  it('clamps out-of-range and non-numeric values', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
  });
});

describe('computeRisk', () => {
  it('scores a strong dual-sensor detection as high', () => {
    const r = computeRisk({
      bestVisualConfidence: 0.95,
      bestMetalSignalNorm: 0.95,
      corroborationCount: 4,
    });
    // vis 0.9, mtl ~0.923, corr 1.0 → 0.4(0.9) + 0.4(0.923) + 0.2(1)
    expect(r.riskScore).toBeCloseTo(0.929, 3);
    expect(r.riskBand).toBe('high');
  });

  it('scores a detection at both thresholds as low, still confirmed', () => {
    const r = computeRisk({
      bestVisualConfidence: 0.5,
      bestMetalSignalNorm: 0.35,
      corroborationCount: 1,
    });
    expect(r.riskScore).toBe(0);
    expect(r.riskBand).toBe('low');
  });

  it('applies the strong-metal floor to lift low to medium', () => {
    const r = computeRisk({
      bestVisualConfidence: 0.5, // contributes nothing
      bestMetalSignalNorm: 0.95, // metalNorm ~0.923 ≥ 0.85
      corroborationCount: 1,
    });
    expect(r.riskScore).toBeLessThan(0.4);
    expect(r.riskBand).toBe('medium');
    expect(r.riskInputs.overridesApplied).toContain('strong_metal_floor');
  });

  it('ratchets the band up but never down within a session', () => {
    const params = {
      bestVisualConfidence: 0.5,
      bestMetalSignalNorm: 0.35,
      corroborationCount: 1,
    };
    const ratcheted = computeRisk({ ...params, previousRiskBand: 'high' });
    expect(ratcheted.riskBand).toBe('high');
    expect(ratcheted.riskInputs.overridesApplied).toContain('monotonic_ratchet');

    const notLowered = computeRisk({
      bestVisualConfidence: 0.95,
      bestMetalSignalNorm: 0.95,
      corroborationCount: 4,
      previousRiskBand: 'low',
    });
    expect(notLowered.riskBand).toBe('high');
    expect(notLowered.riskInputs.overridesApplied).not.toContain('monotonic_ratchet');
  });

  it('honours session thresholds rather than assuming defaults', () => {
    const strict = computeRisk({
      bestVisualConfidence: 0.6,
      bestMetalSignalNorm: 0.4,
      corroborationCount: 1,
      tVis: 0.8,
      tMetal: 0.6,
    });
    // Both readings sit below the stricter thresholds, so they contribute zero.
    expect(strict.riskScore).toBe(0);
    expect(strict.riskInputs.thresholds).toEqual({ visual: 0.8, metal: 0.6 });
  });

  it('records the weights it used', () => {
    const r = computeRisk({
      bestVisualConfidence: 0.75,
      bestMetalSignalNorm: 0.6,
      corroborationCount: 2,
    });
    expect(r.riskInputs.weights).toEqual({ visual: 0.4, metal: 0.4, corroboration: 0.2 });
    expect(r.riskInputs.formulaVersion).toBe('risk-v1');
  });
});
