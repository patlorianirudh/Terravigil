import type { Classification, Detection } from '../domain/types';

/**
 * Marker geometry per classification. Shared by the badge, the map markers, and
 * the sweep ribbon so the same observation is the same shape everywhere
 * (P-20.6) — and so classification is never conveyed by colour alone (P-20.12).
 */
export const CLASSIFICATION_GLYPH: Record<Classification, string> = {
  confirmed: '⬤',
  unconfirmed_visual: '△',
  unresolved_metal: '◇',
};

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  confirmed: 'Confirmed mine',
  unconfirmed_visual: 'Visual detection',
  unresolved_metal: 'Unresolved metal',
};

export function detectionLabel(detection: Detection): string {
  return detection.sourceId ?? detection.sourceRecordId ?? detection.id;
}

/** Display the detector's class while making known landmine sensor records readable. */
export function detectionClassLabel(detection: Detection): string {
  if (detection.deviceType === 'camera' || detection.deviceType === 'metal') return 'Landmine';
  const className = detection.className?.trim();
  if (className && /^(land[_ -]?mines?|landmine)$/i.test(className)) return 'Landmine';
  return className ?? detection.classId ?? 'Class not supplied';
}

/** Sensor modality as reported by Firebase; this is not the flight-control device. */
export function detectionDeviceLabel(detection: Detection): string | null {
  if (detection.deviceType === 'camera') return 'Camera';
  if (detection.deviceType === 'metal') return 'Metal detector';
  return null;
}

export function sensorConfidenceLabel(detection: Detection): string | null {
  if (detection.confidencePercent == null) return null;
  const value = `${detection.confidencePercent.toFixed(2)}%`;
  const score = detection.confidenceScore == null
    ? ''
    : ` (score ${detection.confidenceScore.toFixed(4)})`;
  const sensor = detection.deviceType === 'metal'
    ? 'Metal confidence'
    : detection.deviceType === 'camera'
      ? 'Camera confidence'
      : 'Sensor confidence';
  return `${sensor}: ${value}${score}`;
}
