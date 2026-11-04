'use strict';

const PRACTICE_MISSIONS = ['SAMPLE-TV001', 'TV-TELEMETRY-DEMO'];
const DEPLOYMENT = Object.freeze({
  edgeComputer: 'NVIDIA Jetson Nano 4GB',
  aircraft: 'ZD550',
  flightController: 'Pixhawk',
  groundStation: 'Mission Planner',
  provenance: 'Project hardware specified by the team; this is not a device health measurement.'
});

function isPractice(row) {
  return row?.synthetic === true || row?.sample === true || row?.isSample === true ||
    row?.provenance?.synthetic === true ||
    (PRACTICE_MISSIONS.includes(row?.mission_id) || PRACTICE_MISSIONS.includes(row?.sessionId));
}

// Migrate older installations that seeded practice missions. Only explicitly
// marked simulation records and the two reserved practice missions are removed.
async function removePracticeData(db) {
  const flagged = await db.collection('missions').find({}).toArray();
  const ids = [...new Set([...PRACTICE_MISSIONS, ...flagged.filter(isPractice).map(row => row.mission_id)])].filter(Boolean);
  const query = { $or: [
    { mission_id: { $in: ids } }, { sessionId: { $in: ids } },
    { sample: true }, { synthetic: true }, { isSample: true }, { 'provenance.synthetic': true }
  ] };
  for (const name of ['missions', 'detections', 'observations', 'telemetry', 'firebase_events', 'inference_runs', 'reports', 'mission_documents', 'rag_embeddings']) {
    const collection = db.collection(name);
    if (await collection.findOne(query)) await collection.deleteMany(query);
  }
  return db;
}

module.exports = { PRACTICE_MISSIONS, DEPLOYMENT, isPractice, removePracticeData };
