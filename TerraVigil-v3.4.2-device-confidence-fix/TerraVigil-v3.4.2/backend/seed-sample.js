'use strict';
const fixture = require('./sample/fixture.json');
const { seedReferences } = require('./project-references');

async function seedSample(db) {
  // Stable identities and $setOnInsert make restarts idempotent, including a
  // restart after only part of the first installation was written.
  await db.collection('missions').updateOne(
    { mission_id: fixture.mission.mission_id },
    { $setOnInsert: { ...fixture.mission, synthetic: true } }, { upsert: true }
  );
  for (const name of ['detections', 'observations', 'telemetry']) {
    for (let index = 0; index < fixture[name].length; index++) {
      const row = fixture[name][index];
      const id = row._id || row.detection_id || row.observation_id || `sample-telemetry-${index + 1}`;
      await db.collection(name).updateOne({ _id: id }, { $setOnInsert: { ...row, _id: id, synthetic: true } }, { upsert: true });
    }
  }
  await seedReferences(db, fixture.mission.mission_id);
}
module.exports = { seedSample };
