/**
 * Automatic sensor fusion for Firebase camera + metal observations.
 *
 * The bridge stores every Firebase event as a separate observation
 * (status UNCONFIRMED, risk_level null). This pass runs after ingest and
 * upgrades a camera observation to CONFIRMED when a metal observation sits
 * close enough in time and space — the SRS §4.3 rule that a mine record is
 * confirmed only when visual YOLO evidence and metallic evidence agree.
 *
 * Thresholds are read from the environment so they can be tuned without a
 * code change; the defaults match fusion/confirmation.js and fusion/risk.js.
 */

const { determineConfirmation } = require('./confirmation');
const { calculateRisk } = require('./risk');

// ── Tunable thresholds (env-overridable) ────────────────────────────────────
// 0.60 keeps genuine mid-confidence camera hits (the field data sits at
// 0.62–0.69) while still rejecting weak noise below 0.60.
const YOLO_CONFIRM_MIN = Number(process.env.FUSION_YOLO_CONFIRM_MIN || 0.60);
// Max time gap between a camera and a metal observation for them to corroborate.
const TIME_GAP_SECONDS = Number(process.env.FUSION_TIME_GAP_SECONDS || 5);
// Max ground distance (metres) between the two observations.
const DISTANCE_METERS = Number(process.env.FUSION_DISTANCE_METERS || 5);

/** Great-circle distance in metres between two WGS84 points. */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseTime(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Run one fusion pass over a mission's observations.
 *
 * @param {import('mongodb').Db} db
 * @param {string} missionId
 * @returns {Promise<{confirmed:number, pairs:number, scanned:{camera:number, metal:number}}>}
 */
async function fuseMissionObservations(db, missionId) {
  const observations = db.collection('observations');
  const rows = await observations
    .find({ mission_id: missionId, status: { $in: ['UNCONFIRMED', 'CONFIRMED'] } })
    .toArray();

  const camera = rows.filter(
    (r) => r.device === 'camera' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude),
  );
  const metal = rows.filter(
    (r) => r.device === 'metal' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude),
  );

  let confirmed = 0;
  let pairs = 0;
  const usedMetal = new Set();

  for (const cam of camera) {
    const yolo = Number.isFinite(cam.yolo_confidence)
      ? cam.yolo_confidence
      : Number.isFinite(cam.confidence_score)
        ? cam.confidence_score
        : null;
    if (yolo === null || yolo < YOLO_CONFIRM_MIN) continue;
    const camTime = parseTime(cam.timestamp);

    // Find the closest unused metal observation within the time + distance window.
    let best = null;
    let bestDist = Infinity;
    for (const met of metal) {
      if (usedMetal.has(met._id)) continue;
      const metTime = parseTime(met.timestamp);
      if (camTime !== null && metTime !== null) {
        const gapSec = Math.abs(camTime - metTime) / 1000;
        if (gapSec > TIME_GAP_SECONDS) continue;
      }
      const dist = distanceMeters(cam.latitude, cam.longitude, met.latitude, met.longitude);
      if (dist > DISTANCE_METERS) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = met;
      }
    }
    if (!best) continue;

    // Agreement reached: run the shared confirmation + risk rules.
    // The metal detector reports a hit but not always a signal strength; a
    // present metal event counts as detected=true. When the signal is absent we
    // pass 0 so the risk band is driven by the camera confidence alone rather
    // than inventing a metal strength we never measured.
    const metalSignal = Number.isFinite(best.metal_signal) ? best.metal_signal : null;
    const result = determineConfirmation(yolo, true);
    if (result.status !== 'CONFIRMED') continue;
    const riskLevel = calculateRisk(yolo, metalSignal ?? 0, result.status);

    usedMetal.add(best._id);
    pairs += 1;
    if (cam.status !== 'CONFIRMED') confirmed += 1;

    await observations.updateOne(
      { _id: cam._id },
      {
        $set: {
          status: 'CONFIRMED',
          layer: 'LAYER_1',
          risk_level: riskLevel,
          metal_detected: true,
          metal_signal: metalSignal,
          confirmation_source: 'camera_and_metal',
          corroborating_observation_id: best._id,
          fusion_distance_m: Math.round(bestDist * 100) / 100,
          fused_at: new Date().toISOString(),
        },
      },
    );
    // Mark the metal observation as corroborating evidence (kept separate).
    await observations.updateOne(
      { _id: best._id },
      {
        $set: {
          corroborates_observation_id: cam._id,
          confirmation_source: 'metal_corroborates_camera',
          fused_at: new Date().toISOString(),
        },
      },
    );
  }

  return { confirmed, pairs, scanned: { camera: camera.length, metal: metal.length } };
}

module.exports = {
  fuseMissionObservations,
  distanceMeters,
  FUSION_THRESHOLDS: { YOLO_CONFIRM_MIN, TIME_GAP_SECONDS, DISTANCE_METERS },
};
