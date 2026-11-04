/**
 * Synthetic, opt-in demonstration adapter. No real survey locations, sensor
 * frames, aircraft connections, document generation, or model calls live here.
 * Its records share the live domain contract so the UI can exercise every
 * evidence state. Dates/geometry are deterministic; mutations last for this tab.
 */
import type {
  MissionStatistics,
  MissionPreparation,
  InferenceRequest,
  InferenceResult,
  InferenceStatus,
  AssistantMessage,
  AuthUser,
  CoverageSummary,
  Detection,
  DetectionClass,
  ReportItem,
  ReviewState,
  SafePathRequest,
  SafePathResult,
  SampleMissionLoadResult,
  ScanSession,
  SessionConfig,
  SubsystemHealth,
  SystemEventAlert,
  TrackPoint,
} from '../domain/types';
import fixture from '../../../backend/sample/fixture.json';
import sampleService from './generated/sample-service.js';
import {
  toMission,
  toMissionEvidence,
  toMissionTrack,
  toMissionRouteResult,
  toSampleMissionLoad,
} from './missionMappers';
import type { ApiContract, CreateSessionPayload, DetectionFilters } from './api';
import { ServiceError } from './errors';

const REPLAY_TIME = fixture.mission.ended_at;
const STORAGE_KEY = 'terravigil.demo.workspace.single-sample.v3';
const SESSION_ID = fixture.mission.mission_id;
const USER: AuthUser = {
  id: 'DEMO-OPERATOR',
  email: 'operator@demo.invalid',
  name: 'Demo operator',
  role: 'operator',
  callsign: 'VIGIL 01',
};
const mappedSample = toMission(fixture.mission);
if (!mappedSample) throw new Error('Invalid sample mission configuration.');
const SESSION_CONFIG: SessionConfig = mappedSample.config;
const CATALOG: DetectionClass[] = [
  {
    id: '12',
    name: 'land_mines',
    description: 'Class 12 in the supplied train-2 checkpoint. Mission evidence is simulated.',
    category: 'marker',
  },
];

function copy<T>(value: T): T {
  return structuredClone(value);
}
function result<T>(value: T): Promise<T> {
  return Promise.resolve(copy(value));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeSessions(): ScanSession[] {
  const mission = toMission(fixture.mission);
  if (!mission) throw new Error('Invalid bundled sample mission.');
  return [mission];
}

function makeDetections(sessionId: string): Detection[] {
  if (sessionId !== SESSION_ID) return [];
  return [
    ...fixture.detections.map((row) => toMissionEvidence(row, 'detection')),
    ...fixture.observations.map((row) => toMissionEvidence(row, 'observation')),
  ]
    .filter((row): row is Detection => row !== null)
    .map((row) => ({
      ...row,
      reviewState: 'unreviewed',
      vlmVerdict: 'not_run',
    }));
}

function makeTrack(session: ScanSession): TrackPoint[] {
  return session.id === SESSION_ID
    ? fixture.telemetry.map(toMissionTrack).filter((row): row is TrackPoint => row !== null)
    : [];
}

function coverageFor(sessionId: string): CoverageSummary {
  let length = 0;
  const track = sessionId === SESSION_ID ? fixture.telemetry : [];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1],
      b = track[i];
    if (!a || !b) continue;
    const rad = Math.PI / 180;
    const h =
      Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
      Math.cos(a.latitude * rad) *
        Math.cos(b.latitude * rad) *
        Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
    length += 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return {
    sessionId,
    cellSizeM: null,
    visualSweptAreaM2: null,
    dualSweptAreaM2: null,
    degradedAreaM2: null,
    visualSwathM: null,
    trackLengthM: track.length > 1 ? length : null,
  };
}

interface DemoSnapshot {
  sessions: ScanSession[];
  detections: Detection[];
  reports: ReportItem[];
  sequence: number;
}

export class DemoApiService implements ApiContract {
  private sessions: ScanSession[];
  private detections: Detection[];
  private reports: ReportItem[] = [];
  private sequence = 0;
  private authenticated = true;

  constructor(restore = true) {
    this.sessions = makeSessions();
    this.detections = this.sessions.flatMap((session) => makeDetections(session.id));
    this.reports = this.sessions
      .filter((session) => session.state !== 'active')
      .map((session, index) => this.reportFor(session, index + 1, session.endedAt ?? REPLAY_TIME));
    if (restore) this.restore();
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<DemoSnapshot>;
      if (
        !Array.isArray(saved.sessions) ||
        !Array.isArray(saved.detections) ||
        !Array.isArray(saved.reports) ||
        typeof saved.sequence !== 'number'
      )
        return;
      if (
        !saved.sessions.every(
          (session) =>
            typeof session.id === 'string' &&
            typeof session.siteName === 'string' &&
            isRecord(session.config),
        )
      )
        return;
      if (
        !saved.detections.every(
          (detection) => typeof detection.id === 'string' && Array.isArray(detection.reviewHistory),
        )
      )
        return;
      if (
        !saved.reports.every((report) => typeof report.id === 'string' && isRecord(report.summary))
      )
        return;
      this.sessions = saved.sessions;
      this.detections = saved.detections;
      this.reports = saved.reports;
      this.sequence = saved.sequence;
    } catch {
      /* Storage can be disabled; the demo remains usable in memory. */
    }
  }

  private persist(): void {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessions: this.sessions,
          detections: this.detections,
          reports: this.reports,
          sequence: this.sequence,
        }),
      );
    } catch {
      /* The current tab retains all mutations if persistence is unavailable. */
    }
  }

  private getSessionOrThrow(id: string): ScanSession {
    const session = this.sessions.find((item) => item.id === id);
    if (!session) throw new ServiceError('invalid', 'This demo session does not exist.');
    return session;
  }

  private reportFor(session: ScanSession, number: number, timestamp: string): ReportItem {
    const observations = this.detections.filter((detection) => detection.sessionId === session.id);
    const confirmed = observations.filter((detection) => detection.classification === 'confirmed');
    const coverage = coverageFor(session.id);
    return {
      id: `DEMO-REPORT-${String(number).padStart(4, '0')}`,
      reportNumber: number,
      sessionId: session.id,
      siteName: session.siteName,
      generatedAt: timestamp,
      status: 'ready',
      formulaVersion: 'risk-v1',
      contentHash: 'demo-metadata-only',
      summary: {
        confirmedMinesCount: confirmed.length,
        highRiskCount: confirmed.filter((detection) => detection.riskBand === 'high').length,
        mediumRiskCount: confirmed.filter((detection) => detection.riskBand === 'medium').length,
        lowRiskCount: confirmed.filter((detection) => detection.riskBand === 'low').length,
        unconfirmedVisualCount: observations.filter(
          (detection) => detection.classification === 'unconfirmed_visual',
        ).length,
        unresolvedMetalCount: observations.filter(
          (detection) => detection.classification === 'unresolved_metal',
        ).length,
        visualSweptAreaM2: coverage.visualSweptAreaM2,
        dualSweptAreaM2: coverage.dualSweptAreaM2,
      },
    };
  }

  getAuthToken(): string | null {
    return this.authenticated ? 'demo-session-only' : null;
  }
  setAuthToken(token: string | null): void {
    this.authenticated = token !== null;
  }
  login(_email: string, _password: string): Promise<AuthUser> {
    this.authenticated = true;
    return result(USER);
  }
  logout(): Promise<void> {
    this.authenticated = false;
    return Promise.resolve();
  }
  getMe(): Promise<AuthUser | null> {
    return result(this.authenticated ? USER : null);
  }

  getSessions(): Promise<ScanSession[]> {
    return result(this.sessions);
  }
  getSession(id: string): Promise<ScanSession | null> {
    return result(this.sessions.find((session) => session.id === id) ?? null);
  }
  createSession(payload: CreateSessionPayload): Promise<ScanSession> {
    if (payload.siteName.trim() === '')
      throw new ServiceError('invalid', 'Enter a name for this demo session.');
    const timestamp = new Date().toISOString();
    this.sessions = this.sessions.map((session) =>
      session.state === 'active' ? { ...session, state: 'ended', endedAt: timestamp } : session,
    );
    this.sequence += 1;
    const session: ScanSession = {
      id: `LOCAL-DEMO-${String(this.sequence).padStart(4, '0')}`,
      siteName: payload.siteName.trim(),
      state: 'active',
      flightMode: payload.flightMode,
      startedAt: timestamp,
      endedAt: null,
      operatorId: USER.id,
      operatorName: USER.name,
      utmEpsg: null,
      config: { ...copy(SESSION_CONFIG), ...payload.config },
      notes: `${payload.notes.trim()}${payload.notes.trim() ? '\n' : ''}SIMULATED DATA. Local demo session; no survey sensors connected.`,
    };
    this.sessions.unshift(session);
    this.persist();
    return result(session);
  }
  endSession(id: string): Promise<ScanSession> {
    const session = this.getSessionOrThrow(id);
    if (session.state === 'active' || session.state === 'created') {
      session.state = 'ended';
      session.endedAt = new Date().toISOString();
      this.persist();
    }
    return result(session);
  }

  getDetections(sessionId?: string, filters?: DetectionFilters): Promise<Detection[]> {
    const search = filters?.search?.trim().toLowerCase();
    return result(
      this.detections.filter(
        (detection) =>
          (!sessionId || detection.sessionId === sessionId) &&
          (!filters?.classification || detection.classification === filters.classification) &&
          (!filters?.riskBand || detection.riskBand === filters.riskBand) &&
          (!filters?.reviewState || detection.reviewState === filters.reviewState) &&
          (filters?.minConfidence === undefined ||
            (detection.bestVisualConfidence !== null &&
              detection.bestVisualConfidence >= filters.minConfidence)) &&
          (filters?.minMetal === undefined ||
            (detection.bestMetalSignalNorm !== null &&
              detection.bestMetalSignalNorm >= filters.minMetal)) &&
          (!search ||
            `${detection.id} ${detection.className ?? ''} ${detection.classification}`
              .toLowerCase()
              .includes(search)),
      ),
    );
  }
  getDetection(id: string): Promise<Detection | null> {
    return result(this.detections.find((detection) => detection.id === id) ?? null);
  }
  submitReview(id: string, reviewState: ReviewState, note?: string): Promise<Detection> {
    const detection = this.detections.find((item) => item.id === id);
    if (!detection) throw new ServiceError('invalid', 'This demo observation does not exist.');
    detection.reviewState = reviewState;
    detection.reviewHistory.push({
      reviewState,
      reviewedAt: new Date().toISOString(),
      reviewedBy: USER.id,
      reviewerName: USER.name,
      ...(note === undefined ? {} : { note }),
    });
    this.persist();
    return result(detection);
  }
  getTrack(sessionId: string): Promise<TrackPoint[]> {
    return result(makeTrack(this.getSessionOrThrow(sessionId)));
  }
  getCoverage(sessionId: string): Promise<CoverageSummary> {
    this.getSessionOrThrow(sessionId);
    return result(coverageFor(sessionId));
  }
  getRiskSurface(sessionId: string): Promise<Detection[]> {
    return this.getDetections(sessionId, { classification: 'confirmed' });
  }
  calculateSafePath(request: SafePathRequest): Promise<SafePathResult> {
    this.getSessionOrThrow(request.sessionId);
    const response = sampleService.dispatchSample(
      'POST',
      `/missions/${encodeURIComponent(request.sessionId)}/route`,
      request,
      { exclusive: true },
    );
    if (response?.status !== 200)
      throw new ServiceError(
        'invalid',
        'Route computation requires the sample mission and valid endpoints.',
      );
    const route = toMissionRouteResult(response.body, request);
    if (!route) throw new ServiceError('invalid', 'The simulated route could not be read.');
    return result(route);
  }

  loadSampleMission(): Promise<SampleMissionLoadResult> {
    const metadata = toSampleMissionLoad(sampleService.metadata());
    if (!metadata) throw new ServiceError('invalid', 'Invalid bundled sample metadata.');
    return result(metadata);
  }

  async getMissionStatistics(sessionId: string): Promise<MissionStatistics> {
    const rows = await this.getDetections(sessionId);
    return {
      sessionId,
      totalRecords: rows.length,
      confirmed: rows.filter((row) => row.classification === 'confirmed').length,
      unconfirmed: rows.filter((row) => row.classification !== 'confirmed').length,
      risk: {
        high: rows.filter((row) => row.riskBand === 'high').length,
        medium: rows.filter((row) => row.riskBand === 'medium').length,
        low: rows.filter((row) => row.riskBand === 'low').length,
      },
    };
  }

  prepareMission(sessionId: string): Promise<MissionPreparation> {
    this.getSessionOrThrow(sessionId);
    return result({
      sessionId,
      status: 'ready',
      indexedChunks: 0,
      sourceHash: `demo-${sessionId}`,
      generation: 'demo-generation',
      model: 'simulation-summary-no-embeddings',
      reused: true,
    });
  }

  queryAssistant(query: string, sessionId?: string): Promise<AssistantMessage> {
    if (!sessionId || sessionId !== SESSION_ID)
      throw new ServiceError('invalid', 'Select the simulated sample mission.');
    if (!query.trim() || query.length > 1000)
      throw new ServiceError('invalid', 'Enter a question between 1 and 1,000 characters.');
    return result({
      id: `SIMULATED-REPLY-${String(++this.sequence)}`,
      sender: 'assistant',
      timestamp: new Date().toISOString(),
      text: sampleService.answer(query).answer,
    });
  }

  getReports(): Promise<ReportItem[]> {
    return result(this.reports);
  }
  getInferenceStatus(): Promise<InferenceStatus> {
    return Promise.reject(
      new ServiceError(
        'unavailable',
        'Model inference requires the integrated backend. The offline demo does not run an AI model.',
      ),
    );
  }
  predictImage(_input: InferenceRequest): Promise<InferenceResult> {
    return Promise.reject(
      new ServiceError(
        'unavailable',
        'Model inference requires the integrated backend. The offline demo does not run an AI model.',
      ),
    );
  }
  getReport(id: string): Promise<ReportItem | null> {
    return result(this.reports.find((report) => report.id === id) ?? null);
  }
  generateReport(sessionId: string, includeAi = false): Promise<ReportItem> {
    if (includeAi)
      return Promise.reject(
        new ServiceError(
          'unavailable',
          'AI reports require the integrated backend. The offline demo does not run an AI model.',
        ),
      );
    const report = this.reportFor(
      this.getSessionOrThrow(sessionId),
      Math.max(0, ...this.reports.map((item) => item.reportNumber)) + 1,
      new Date().toISOString(),
    );
    this.reports.unshift(report);
    this.persist();
    return result(report);
  }
  getSystemHealth(): Promise<SubsystemHealth[]> {
    return result([
      {
        id: 'sample-runtime',
        name: 'Simulation',
        status: 'ok',
        details: 'Bundled mission loaded; no hardware connected',
        lastHeartbeat: REPLAY_TIME,
      },
      {
        id: 'sample-camera',
        name: 'Visual sensor',
        status: 'offline',
        details: 'No live camera. Source images are not part of this simulated mission.',
        lastHeartbeat: '',
      },
      {
        id: 'sample-metal',
        name: 'Metal sensor',
        status: 'offline',
        details: 'No sensor connected. Close-range confirmations are synthetic.',
        lastHeartbeat: '',
      },
    ]);
  }
  getSystemEvents(_sessionId?: string): Promise<SystemEventAlert[]> {
    return result([]);
  }
  getDetectionClasses(): Promise<DetectionClass[]> {
    return result(CATALOG);
  }
}

export const demoApi = new DemoApiService();
