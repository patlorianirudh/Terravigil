import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { DemoApiService } from './demo';
const sessionId = 'SAMPLE-TV001';
describe('Demo adapter integration', () => {
  it('preserves evidence partition and filters the confirmed risk surface', async () => {
    const api = new DemoApiService(false);
    const rows = await api.getDetections(sessionId);
    assert.equal(rows.length, 8);
    assert.equal(rows.filter((x) => x.classification === 'confirmed').length, 4);
    assert.equal(rows.filter((x) => x.classification === 'unconfirmed_visual').length, 4);
    assert.equal(rows.filter((x) => x.classification === 'unresolved_metal').length, 0);
    for (const row of rows.filter((x) => x.classification !== 'confirmed')) {
      assert.equal(row.riskScore, null);
      assert.equal(row.riskBand, null);
      assert.equal(row.riskInputs, null);
    }
    const surface = await api.getRiskSurface(sessionId);
    assert.equal(surface.length, 4);
    assert(surface.every((x) => x.classification === 'confirmed'));
    assert.equal((await api.getDetections(sessionId, { riskBand: 'high' })).length, 2);
    assert.equal((await api.getDetections(sessionId, { riskBand: 'medium' })).length, 1);
    assert.equal((await api.getDetections(sessionId, { riskBand: 'low' })).length, 1);
  });
  it('isolates returned records and appends reviews without changing sensor evidence', async () => {
    const api = new DemoApiService(false);
    const rows = await api.getDetections(sessionId);
    const before = rows[0];
    assert.ok(before);
    const pristine = structuredClone(before);
    before.reviewState = 'operator_disputed';
    before.reviewHistory.push({
      reviewState: 'operator_disputed',
      reviewedAt: 'test',
      reviewedBy: 'test',
      reviewerName: 'test',
    });
    assert.deepEqual(await api.getDetection(before.id), pristine);
    const after = await api.submitReview(before.id, 'operator_endorsed', 'QA synthetic test');
    assert.equal(after.reviewHistory.length, pristine.reviewHistory.length + 1);
    assert.equal(after.reviewState, 'operator_endorsed');
    assert.equal(after.classification, pristine.classification);
    assert.equal(after.riskScore, pristine.riskScore);
    assert.deepEqual(after.riskInputs, pristine.riskInputs);
    assert.equal(after.reviewHistory.at(-1)?.note, 'QA synthetic test');
  });
  it('creates report metadata snapshots with current counts and without invented media', async () => {
    const api = new DemoApiService(false);
    assert.equal((await api.getReports()).length, 1);
    const report = await api.generateReport(sessionId);
    assert.equal(report.contentHash, 'demo-metadata-only');
    assert.equal(report.downloadUrl, undefined);
    const copy = structuredClone(report);
    assert.equal(report.summary.confirmedMinesCount, 4);
    assert.equal(report.summary.highRiskCount, 2);
    assert.equal(report.summary.mediumRiskCount, 1);
    assert.equal(report.summary.lowRiskCount, 1);
    report.summary.confirmedMinesCount = 999;
    assert.deepEqual(await api.getReport(report.id), copy);
    assert.equal((await api.getReports()).length, 2);
  });
  it('loads one mission and its recorded telemetry without inventing inference measurements', async () => {
    const api = new DemoApiService(false);
    assert.equal((await api.getSessions()).length, 1);
    const track = await api.getTrack(sessionId);
    assert.equal(track.length, 20);
    assert.equal(track[0]?.batteryPercent, 98);
    assert.equal(track.at(-1)?.batteryPercent, 79);
    assert(track.every((point) => point.achievedFps === null && point.requiredFps === null));
    assert(track.every((point) => point.position.altAglM === 12));
    const sample = await api.getSession(sessionId);
    assert.equal(sample?.config.metalMaxStandoffM, 0.01);
    assert.equal(sample.config.inferenceWidthPx, 416);
    assert.equal((await api.getCoverage(sessionId)).visualSweptAreaM2, null);
    assert.equal((await api.loadSampleMission()).created, false);
  });
  it('computes the bundled route and labels deterministic answers without claiming model inference', async () => {
    const api = new DemoApiService(false);
    const endpoints = (await api.getSession(sessionId))?.sampleRoute;
    assert.ok(endpoints);
    const route = await api.calculateSafePath({ sessionId, ...endpoints, minStandoffM: 5 });
    assert.equal(route.pathFound, true);
    assert(route.waypoints.length > 2);
    assert((route.minStandoffAchievedM ?? 0) >= 5);
    assert.deepEqual(route.waypoints[0], endpoints.start);
    assert.deepEqual(route.waypoints.at(-1), endpoints.end);
    const reply = await api.queryAssistant('risk', sessionId);
    assert.match(reply.text, /2 high, 1 medium and 1 low/);
    assert.match(reply.text, /no AI model/);
    assert.equal(reply.citations, undefined);
    assert.match((await api.queryAssistant('training', sessionId)).text, /0.61580/);
    assert.equal((await api.prepareMission(sessionId)).indexedChunks, 0);
  });
  it('creates an empty local session and ends it without leaking sample measurements', async () => {
    const api = new DemoApiService(false);
    const created = await api.createSession({
      siteName: ' QA test ',
      flightMode: 'rc_manual',
      config: {},
      notes: '',
    });
    assert.equal(created.siteName, 'QA test');
    assert.equal(created.state, 'active');
    assert.deepEqual(await api.getDetections(created.id), []);
    assert.deepEqual(await api.getTrack(created.id), []);
    assert.equal((await api.getCoverage(created.id)).visualSweptAreaM2, null);
    assert.equal((await api.getCoverage(created.id)).dualSweptAreaM2, null);
    assert.equal((await api.getSession(sessionId))?.state, 'ended');
    const ended = await api.endSession(created.id);
    assert.equal(ended.state, 'ended');
    assert.notEqual(ended.endedAt, null);
  });
});
