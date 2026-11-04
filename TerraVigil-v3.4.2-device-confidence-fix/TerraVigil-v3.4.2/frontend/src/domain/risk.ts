// Risk Assessment Implementation — PRD v2.0 §11
// Deterministic implementation of formula `risk-v1`

import type { RiskBand, RiskInputs } from './types';

export function clamp01(v: number): number {
  if (isNaN(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export interface ComputeRiskParams {
  bestVisualConfidence: number; // [0,1]
  bestMetalSignalNorm: number; // [0,1]
  corroborationCount: number; // >= 1
  tVis?: number; // default 0.50
  tMetal?: number; // default 0.35
  previousRiskBand?: RiskBand | null; // for monotonic ratchet
}

export interface RiskComputationResult {
  riskScore: number;
  riskBand: RiskBand;
  riskInputs: RiskInputs;
}

/**
 * Computes deterministic riskScore and riskBand per PRD §11.3 & §11.4.
 *
 * Formula:
 *   visualNorm = clamp01( (bestVisualConfidence − T_vis) / (1 − T_vis) )
 *   metalNorm  = clamp01( (bestMetalSignalNorm − T_metal) / (1 − T_metal) )
 *   corrobNorm = clamp01( (corroborationCount − 1) / 3 )
 *   riskScore  = 0.40·visualNorm + 0.40·metalNorm + 0.20·corrobNorm
 *
 * Bands:
 *   high   : riskScore >= 0.70
 *   medium : 0.40 <= riskScore < 0.70
 *   low    : riskScore < 0.40 (Note: there is NO 'none' band. Low still means confirmed mine)
 *
 * Overrides:
 *   - Strong metal floor: if metalNorm >= 0.85, riskBand is at least 'medium'
 *   - Monotonic ratchet: riskBand cannot automatically decrease within a session
 */
export function computeRisk({
  bestVisualConfidence,
  bestMetalSignalNorm,
  corroborationCount,
  tVis = 0.5,
  tMetal = 0.35,
  previousRiskBand = null,
}: ComputeRiskParams): RiskComputationResult {
  const overridesApplied: string[] = [];

  const visualNorm = clamp01((bestVisualConfidence - tVis) / (1 - tVis));
  const metalNorm = clamp01((bestMetalSignalNorm - tMetal) / (1 - tMetal));
  const corroborationNorm = clamp01((Math.max(1, corroborationCount) - 1) / 3);

  const wVis = 0.4;
  const wMetal = 0.4;
  const wCorrob = 0.2;

  const rawScore = wVis * visualNorm + wMetal * metalNorm + wCorrob * corroborationNorm;
  const riskScore = Math.round(rawScore * 1000) / 1000; // 3 decimal places

  let calculatedBand: RiskBand = 'low';
  if (riskScore >= 0.7) {
    calculatedBand = 'high';
  } else if (riskScore >= 0.4) {
    calculatedBand = 'medium';
  } else {
    calculatedBand = 'low';
  }

  // Strong metal floor override (P-11.4)
  if (metalNorm >= 0.85 && calculatedBand === 'low') {
    calculatedBand = 'medium';
    overridesApplied.push('strong_metal_floor');
  }

  // Monotonic ratchet override (P-11.5)
  if (previousRiskBand) {
    const bandWeight: Record<RiskBand, number> = { low: 1, medium: 2, high: 3 };
    if (bandWeight[previousRiskBand] > bandWeight[calculatedBand]) {
      calculatedBand = previousRiskBand;
      overridesApplied.push('monotonic_ratchet');
    }
  }

  const riskInputs: RiskInputs = {
    visualNorm,
    metalNorm,
    corroborationNorm,
    weights: { visual: wVis, metal: wMetal, corroboration: wCorrob },
    thresholds: { visual: tVis, metal: tMetal },
    overridesApplied,
    formulaVersion: 'risk-v1',
  };

  return {
    riskScore,
    riskBand: calculatedBand,
    riskInputs,
  };
}
