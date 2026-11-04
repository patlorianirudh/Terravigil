'use strict';
// Paraphrased requirements from the user-supplied SRS, not external doctrine
// and not proof that an aircraft or sensor has achieved these capabilities.
const REFERENCES = [
  { id: 'hardware', section: 'Team deployment configuration', text: 'The project uses an NVIDIA Jetson Nano 4GB for onboard camera capture and AI inference, a ZD550 aircraft with a Pixhawk flight controller, Mission Planner for the ground connection, Firebase for detection metadata, and timestamp matching to a local telemetry CSV. These hardware choices were specified by the team; successful device connectivity and inference performance must be measured separately.' },
  { id: 'sensor-confirmation', section: '4.3 Sensor Fusion and Mine Confirmation', text: 'The TerraVigil project requires agreement between visual YOLO evidence and metallic evidence before a mine record is confirmed. A visual detection alone is an unconfirmed diagnostic observation. GPS, timestamps and sensor readings must be correlated; an image confidence score alone does not prove that a mine is present. The SRS Version-2 metal detector has approximately 1 cm range, requiring a separate close-range confirmation step. Telemetry altitude alone does not establish metal sensing at that altitude.' },
  { id: 'reporting', section: '4.5 Reporting Analytics and Dashboard', text: 'The project requires mission reports containing recorded detection evidence, confidence, GPS coordinates and imagery references, plus separate diagnostic observations, telemetry and source references. RAG answers must use the selected mission data. These are software requirements, not measured detection performance.' },
  { id: 'scope', section: '5.2 Safety Requirements and 5.4 Quality Attributes', text: 'TerraVigil is survey and decision support. Sensor passage and recorded coverage do not certify land release. The application route planner uses recorded point evidence and does not assess ground traversability, buildings, unknown hazards or physical clearance. Stored risk labels are backend classifications, not probabilities or authorization to enter. Human verification remains required.' },
  { id: 'training', section: 'Supplied train-2 training results', text: 'The supplied train-2 run used 100 epochs and 640 pixel training images. The final aggregate validation precision was 0.83852, recall 0.61580 and mAP at IoU 0.5 was 0.67145. These validation results are not field accuracy and do not establish field detection performance. The bundled best.pt is used for image inference; deployment performance depends on hardware and input data.' }
];
const seeded = new WeakMap();
async function seedReferences(db, missionId) {
  let missions = seeded.get(db);
  if (!missions) { missions = new Set(); seeded.set(db, missions); }
  if (missions.has(missionId)) return;
  for (const reference of REFERENCES) {
    const id = `project-reference:${missionId}:${reference.id}`;
    await db.collection('mission_documents').updateOne({ _id: id }, { $set: {
      _id: id, mission_id: missionId, title: 'TerraVigil supplied SRS and training analysis', section: reference.section,
      text: reference.text, provenance: 'Paraphrased from TerraVigil_SRS_Training_Analysis_Updated.docx and supplied train-2 artifacts. Project requirements, not external clearance doctrine.'
    } }, { upsert: true });
  }
  missions.add(missionId);
}
module.exports = { seedReferences };
