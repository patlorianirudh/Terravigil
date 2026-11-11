import { describe, expect, it } from 'vitest';
import { toMissionEvidence, toMissionTrack } from './missionMappers';
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

describe('Firebase telemetry track mapping', () => {
  // Field names exactly as the Python firebase bridge emits them.
  const trackRow = {
    _id: 'FB-aaaaaaaaaaaaaaaaaaaaaaaa',
    mission_id: 'TV-LIVE-001',
    timestamp: '2026-11-04T16:15:22.094+05:30',
    latitude: 17.3971956,
    longitude: 78.4895201,
    altitude_amsl_m: 459.79,
    relative_altitude_m: -7.576,
    ground_speed_ms: 0.0096,
    heading_deg: 176.92,
    roll_deg: 0.5189,
    pitch_deg: 0.0436,
    battery_percent: null,
    battery_voltage_v: 12.1,
    flight_mode: 'STABILIZE',
    armed: false,
    gps_fix_type: 3,
    satellites: 14,
    hdop: 0.9,
  };

  it('maps relative_altitude_m to AGL and altitude_amsl_m to AMSL so altitude renders', () => {
    const point = toMissionTrack(trackRow);
    expect(point).not.toBeNull();
    expect(point?.position.altAglM).toBe(-7.576);
    expect(point?.position.altAmslM).toBe(459.79);
  });

  it('carries roll, pitch, flight mode, armed, and battery voltage from the bridge row', () => {
    const point = toMissionTrack(trackRow);
    expect(point?.rollDeg).toBe(0.5189);
    expect(point?.pitchDeg).toBe(0.0436);
    expect(point?.flightMode).toBe('STABILIZE');
    expect(point?.armed).toBe(false);
    expect(point?.batteryVoltageV).toBe(12.1);
    expect(point?.satellites).toBe(14);
    expect(point?.hdop).toBe(0.9);
  });

  it('maps the numeric Pixhawk GPS fix type when the text form is absent', () => {
    const point = toMissionTrack(trackRow);
    expect(point?.fixType).toBe('fix_3d');
  });
});
