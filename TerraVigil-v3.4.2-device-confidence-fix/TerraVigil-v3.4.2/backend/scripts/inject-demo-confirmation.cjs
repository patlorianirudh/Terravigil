'use strict';
/**
 * Demo helper: inject one camera + one metal observation at the same place and
 * time, then run sensor fusion so the dashboard shows a CONFIRMED detection with
 * a risk band. Clearly marked test_record:true so it is never mistaken for real
 * field evidence. Run: node scripts/inject-demo-confirmation.cjs
 */
const path = require('node:path');
const { createLocalDb } = require('../local-db');
const { fuseMissionObservations } = require('../fusion/fuse');

const MISSION = process.env.FIREBASE_MISSION_ID || 'TV-LIVE-001';
const DB_PATH = path.resolve(__dirname, '..', 'data', 'missions.json');

// A strong camera hit (0.95) and a strong metal hit (0.80) at the same spot,
// 2 seconds apart — comfortably inside the 5 s / 5 m fusion window.
const LAT = 17.3972144;
const LON = 78.4896305;
const CAM_TS = '2026-11-05T14:30:00.000000Z';
const MET_TS = '2026-11-05T14:30:02.000000Z';

const camera = {
  _id: 'DEMO-CAM-0001', observation_id: 'DEMO-CAM-0001', mission_id: MISSION,
  timestamp: CAM_TS, latitude: LAT, longitude: LON,
  yolo_confidence: 0.95, confidence_score: 0.95, confidence_percent: 95,
  device: 'camera', class_name: 'land_mines', class_id: null,
  image_path: null, image_url: null, image_original_path: null,
  image_local_filename: null, image_state: 'missing', test_record: true,
  metal_detected: null, metal_signal: null, status: 'UNCONFIRMED', layer: 'LAYER_2',
  risk_level: null, source: 'demo_injection', firebase_id: 'demo:-cam-0001',
  synthetic: false, location_source: 'aircraft_gps_at_capture', target_location_known: false,
  confirmation_source: 'camera_detector_only', timestamp_original: CAM_TS,
  telemetry_timestamp: CAM_TS, telemetry_match_gap_seconds: 0,
  telemetry_match_method: 'demo', telemetry_csv_line: null,
  lookup_timestamp: CAM_TS, clock_offset_seconds: 0, telemetry_max_gap_seconds: 2,
};
const metal = {
  _id: 'DEMO-MET-0001', observation_id: 'DEMO-MET-0001', mission_id: MISSION,
  timestamp: MET_TS, latitude: LAT, longitude: LON,
  yolo_confidence: null, confidence_score: 0.80, confidence_percent: 80,
  device: 'metal', class_name: 'land_mines', class_id: null,
  image_path: null, image_url: null, image_original_path: null,
  image_local_filename: null, image_state: 'missing', test_record: true,
  metal_detected: true, metal_signal: 0.80, status: 'UNCONFIRMED', layer: 'LAYER_2',
  risk_level: null, source: 'demo_injection', firebase_id: 'demo:-met-0001',
  synthetic: false, location_source: 'aircraft_gps_at_capture', target_location_known: false,
  confirmation_source: 'metal_sensor_only', timestamp_original: MET_TS,
  telemetry_timestamp: MET_TS, telemetry_match_gap_seconds: 0,
  telemetry_match_method: 'demo', telemetry_csv_line: null,
  lookup_timestamp: MET_TS, clock_offset_seconds: 0, telemetry_max_gap_seconds: 2,
};

(async () => {
  const db = createLocalDb(DB_PATH);
  await db.collection('observations').updateOne({ _id: camera._id }, { $set: camera }, { upsert: true });
  await db.collection('observations').updateOne({ _id: metal._id }, { $set: metal }, { upsert: true });
  const result = await fuseMissionObservations(db, MISSION);
  const cam = await db.collection('observations').findOne({ _id: camera._id });
  console.log('Fusion result:', JSON.stringify(result));
  console.log('Demo camera now:', JSON.stringify({
    status: cam.status, layer: cam.layer, risk_level: cam.risk_level,
    metal_detected: cam.metal_detected, confirmation_source: cam.confirmation_source,
    corroborating_observation_id: cam.corroborating_observation_id,
  }));
  console.log('\nOpen the dashboard → Detections / Risk map. The demo pair is marked test_record:true.');
})();
