import { describe, expect, it } from 'vitest';
import { toMissionEvidence } from './missionMappers';
import { detectionClassLabel, detectionDeviceLabel, sensorConfidenceLabel } from '../lib/classification';

describe('Firebase sensor evidence mapping', () => {
  const base = {
    _id: 'FB-012345678901234567890123',
    mission_id: 'TV-LIVE-001',
    latitude: 17.3975,
    longitude: 78.4893,
    timestamp: '2026-10-28T09:17:41.443217Z',
    status: 'UNCONFIRMED',
    class_name: 'unknown_object',
    confidence_score: 0.5968,
    confidence_percent: 59.68,
    target_location_known: false,
    location_source: 'aircraft_gps_at_capture',
  };

  it('renders camera-device records as landmines and retains drone score and percentage', () => {
    const detection = toMissionEvidence({ ...base, device: 'camera', yolo_confidence: 0.5968 }, 'observation');
    expect(detection).not.toBeNull();
    expect(detection?.classification).toBe('unconfirmed_visual');
    expect(detectionClassLabel(detection!)).toBe('Landmine');
    expect(detectionDeviceLabel(detection!)).toBe('Camera');
    expect(detection?.confidenceScore).toBe(0.5968);
    expect(detection?.confidencePercent).toBe(59.68);
    expect(sensorConfidenceLabel(detection!)).toContain('59.68%');
    expect(detection?.bestVisualConfidence).toBe(0.5968);
  });

  it('renders metal-device records as landmine candidates, not unknown classes or visual detections', () => {
    const detection = toMissionEvidence({ ...base, device: 'metal', yolo_confidence: null }, 'observation');
    expect(detection).not.toBeNull();
    expect(detection?.classification).toBe('unresolved_metal');
    expect(detectionClassLabel(detection!)).toBe('Landmine');
    expect(detectionDeviceLabel(detection!)).toBe('Metal detector');
    expect(detection?.confidenceScore).toBe(0.5968);
    expect(detection?.confidencePercent).toBe(59.68);
    expect(detection?.bestVisualConfidence).toBeNull();
  });

  it('accepts the detector firmware device name metal_detector', () => {
    const detection = toMissionEvidence({ ...base, device: 'metal_detector', yolo_confidence: null }, 'observation');
    expect(detection?.classification).toBe('unresolved_metal');
    expect(detectionDeviceLabel(detection!)).toBe('Metal detector');
    expect(detection?.bestVisualConfidence).toBeNull();
  });
});
