/** Adapter for the supplied CommonJS backend; pages retain their current contract. */
import type {
  AssistantMessage,
  AuthUser,
  CoverageSummary,
  Detection,
  DetectionClass,
  InferenceRequest,
  MissionStatistics,
  MissionPreparation,
  ReportItem,
  ReviewState,
  SafePathRequest,
  SafePathResult,
  SampleMissionLoadResult,
  ScanSession,
  SubsystemHealth,
  SystemEventAlert,
  TrackPoint,
} from '../domain/types';
import type { ApiContract, CreateSessionPayload, DetectionFilters } from './api';
import { ServiceError } from './errors';
import { config } from '../config';
import { rememberToken, request } from './http';
import { readInferenceStatus, runImageInference } from './inference';
import { toReportItem, toSubsystemHealth, toSystemEventAlert, toDetectionClass } from './mappers';
import type {
  ReportItemDto,
  SubsystemHealthDto,
  SystemEventAlertDto,
  DetectionClassDto,
} from './dto';
import {
  readEvidenceIdentity,
  toMission,
  toMissionAnswer,
  toMissionEvidence,
  toMissionStatistics,
  toMissionPreparation,
  toMissionTrack,
  toMissionRouteRequest,
  toMissionRouteResult,
  toSampleMissionLoad,
  type EvidenceSource,
} from './missionMappers';

function unsupported<T>(feature: string): Promise<T> {
  return Promise.reject(
    new ServiceError('unavailable', `${feature} is not available in this mission backend.`),
  );
}

function rows(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new ServiceError('invalid', 'The mission backend returned an invalid record list.');
  return value as unknown[];
}

function required<T>(value: T | null, feature: string): T {
  if (value === null)
    throw new ServiceError('invalid', `The mission backend returned an unreadable ${feature}.`);
  return value;
}

const missionPath = (id: string) => `/missions/${encodeURIComponent(id)}`;

export class MissionApiService implements ApiContract {
  getInferenceStatus() {
    return readInferenceStatus();
  }
  predictImage(input: InferenceRequest) {
    return runImageInference(input);
  }

  getAuthToken(): string | null {
    return null;
  }
  setAuthToken(token: string | null): void {
    if (token !== null)
      throw new ServiceError(
        'unavailable',
        'Authentication is not available in this mission backend.',
      );
    rememberToken(null);
  }
  login(_email: string, _password: string): Promise<AuthUser> {
    return unsupported('Authentication');
  }
  logout(): Promise<void> {
    rememberToken(null);
    return unsupported('Authentication');
  }
  getMe(): Promise<AuthUser | null> {
    return Promise.resolve(null);
  }

  async getSessions(): Promise<ScanSession[]> {
    const missions = rows(await request<unknown>('/missions'))
      .map(toMission)
      .filter((value): value is ScanSession => value !== null);
    // The backend addresses missions by mission_id and may contain duplicate documents.
    const unique = new Map<string, ScanSession>();
    for (const mission of missions) if (!unique.has(mission.id)) unique.set(mission.id, mission);
    return [...unique.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getSession(id: string): Promise<ScanSession | null> {
    const mission = toMission(await request<unknown>(missionPath(id)));
    return mission?.id === id ? mission : null;
  }

  async loadSampleMission(): Promise<SampleMissionLoadResult> {
    return required(
      toSampleMissionLoad(await request<unknown>('/sample-mission')),
      'sample mission result',
    );
  }

  async createSession(payload: CreateSessionPayload): Promise<ScanSession> {
    const location = payload.siteName.trim();
    if (!location) throw new ServiceError('invalid', 'Enter a mission location.');
    const id = `TV-${crypto.randomUUID()}`;
    await request<unknown>('/missions', {
      method: 'POST',
      body: { mission_id: id, location, status: 'ACTIVE' },
    });
    return required(await this.getSession(id), 'created mission');
  }

  async endSession(id: string): Promise<ScanSession> {
    const current = required(await this.getSession(id), 'mission');
    await request<unknown>(missionPath(id), {
      method: 'PUT',
      body: { location: current.siteName, status: 'COMPLETED' },
    });
    return required(await this.getSession(id), 'updated mission');
  }

  private async evidence(sessionId: string, source: EvidenceSource): Promise<Detection[]> {
    const values = rows(
      await request<unknown>(
        `${missionPath(sessionId)}/${source === 'detection' ? 'detections' : 'observations'}`,
      ),
    );
    return values
      .map((value) => toMissionEvidence(value, source))
      .filter((value): value is Detection => value !== null && value.sessionId === sessionId);
  }

  async getDetections(sessionId?: string, filters?: DetectionFilters): Promise<Detection[]> {
    const ids =
      sessionId === undefined
        ? (await this.getSessions()).map((mission) => mission.id)
        : [sessionId];
    const groups = await Promise.all(
      ids.map(async (id) =>
        (
          await Promise.all([this.evidence(id, 'detection'), this.evidence(id, 'observation')])
        ).flat(),
      ),
    );
    const search = filters?.search?.trim().toLowerCase();
    const unique = new Map(groups.flat().map((value) => [value.id, value]));
    return [...unique.values()]
      .filter(
        (value) =>
          (filters?.classification === undefined ||
            value.classification === filters.classification) &&
          (filters?.riskBand === undefined || value.riskBand === filters.riskBand) &&
          (filters?.reviewState === undefined || value.reviewState === filters.reviewState) &&
          (filters?.minConfidence === undefined ||
            (value.bestVisualConfidence !== null &&
              value.bestVisualConfidence >= filters.minConfidence)) &&
          (filters?.minMetal === undefined ||
            (value.bestMetalSignalNorm !== null &&
              value.bestMetalSignalNorm >= filters.minMetal)) &&
          (!search ||
            `${value.sourceId ?? ''} ${value.sourceRecordId ?? ''} ${value.className ?? ''}`
              .toLowerCase()
              .includes(search)),
      )
      .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt));
  }

  async getDetection(id: string): Promise<Detection | null> {
    const identity = readEvidenceIdentity(id);
    if (identity === null) return null;
    const values = await this.evidence(identity.missionId, identity.source);
    return values.find((value) => value.id === id) ?? null;
  }

  submitReview(_id: string, _state: ReviewState, _note?: string): Promise<Detection> {
    return unsupported('Evidence review');
  }

  async getTrack(sessionId: string): Promise<TrackPoint[]> {
    return rows(await request<unknown>(`${missionPath(sessionId)}/telemetry`))
      .map(toMissionTrack)
      .filter((value): value is TrackPoint => value !== null && value.sessionId === sessionId)
      .sort((a, b) => a.tUtc.localeCompare(b.tUtc));
  }

  async getCoverage(sessionId: string): Promise<CoverageSummary> {
    const track = await this.getTrack(sessionId);
    let length = 0;
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1];
      const b = track[i];
      if (!a || !b) continue;
      const radians = Math.PI / 180;
      const dLat = (b.position.lat - a.position.lat) * radians;
      const dLon = (b.position.lon - a.position.lon) * radians;
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(a.position.lat * radians) *
          Math.cos(b.position.lat * radians) *
          Math.sin(dLon / 2) ** 2;
      length += 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    return {
      sessionId,
      cellSizeM: null,
      visualSweptAreaM2: null,
      dualSweptAreaM2: null,
      degradedAreaM2: null,
      visualSwathM: null,
      trackLengthM: track.length >= 2 && track.every((point) => point.tUtc !== '') ? length : null,
    };
  }
  getRiskSurface(sessionId: string): Promise<Detection[]> {
    return this.getDetections(sessionId);
  }
  async calculateSafePath(input: SafePathRequest): Promise<SafePathResult> {
    const route = toMissionRouteRequest(input);
    if (route === null)
      throw new ServiceError(
        'invalid',
        'Select a mission, two distinct map endpoints and valid route preferences.',
      );
    return required(
      toMissionRouteResult(
        await request<unknown>(`${missionPath(route.sessionId)}/route`, {
          method: 'POST',
          body: route,
          unavailableOn404:
            'Route computation is unavailable for this mission. Refresh the mission or check the routing service.',
        }),
        route,
      ),
      'route result for the selected mission and endpoints',
    );
  }

  async getMissionStatistics(sessionId: string): Promise<MissionStatistics> {
    return required(
      toMissionStatistics(
        await request<unknown>(`${missionPath(sessionId)}/statistics`),
        sessionId,
      ),
      'mission statistics',
    );
  }

  async prepareMission(sessionId: string): Promise<MissionPreparation> {
    if (!sessionId.trim())
      throw new ServiceError('invalid', 'Select a mission before preparing its data.');
    const response = await request<unknown>(`${missionPath(sessionId)}/create-embeddings`, {
      method: 'POST',
      timeoutMs: config.preparationTimeoutMs,
    });
    return required(toMissionPreparation(response, sessionId), 'mission preparation result');
  }

  async queryAssistant(query: string, sessionId?: string): Promise<AssistantMessage> {
    if (!sessionId?.trim())
      throw new ServiceError('invalid', 'Select a mission before asking the assistant.');
    const question = query.trim();
    if (!question || question.length > 1000)
      throw new ServiceError('invalid', 'Enter a question between 1 and 1,000 characters.');
    const response = await request<unknown>(`${missionPath(sessionId)}/ask`, {
      query: { q: question },
      timeoutMs: config.assistantTimeoutMs,
      unavailableOn404:
        'The mission assistant endpoint is not available in this backend. No answer was generated.',
    });
    return required(
      toMissionAnswer(response, sessionId),
      'assistant answer for the selected mission',
    );
  }

  async getReports(): Promise<ReportItem[]> {
    return rows(await request<unknown>('/reports'))
      .map((value) => toReportItem(value as ReportItemDto))
      .filter((value): value is ReportItem => value !== null);
  }
  async getReport(id: string): Promise<ReportItem | null> {
    return toReportItem(await request<ReportItemDto>(`/reports/${encodeURIComponent(id)}`));
  }
  async generateReport(sessionId: string, includeAi = false): Promise<ReportItem> {
    return required(
      toReportItem(
        await request<ReportItemDto>('/reports', {
          method: 'POST',
          body: { sessionId, includeAi },
          timeoutMs: includeAi
            ? config.preparationTimeoutMs + config.assistantTimeoutMs
            : config.requestTimeoutMs,
        }),
      ),
      'report edition',
    );
  }
  async getSystemHealth(): Promise<SubsystemHealth[]> {
    return rows(await request<unknown>('/system/health'))
      .map((value) => toSubsystemHealth(value as SubsystemHealthDto))
      .filter((value): value is SubsystemHealth => value !== null);
  }
  async getSystemEvents(sessionId?: string): Promise<SystemEventAlert[]> {
    return rows(await request<unknown>('/system/events', { query: { sessionId } }))
      .map((value) => toSystemEventAlert(value as SystemEventAlertDto))
      .filter((value): value is SystemEventAlert => value !== null);
  }
  async getDetectionClasses(): Promise<DetectionClass[]> {
    return rows(await request<unknown>('/classes'))
      .map((value) => toDetectionClass(value as DetectionClassDto))
      .filter((value): value is DetectionClass => value !== null);
  }
}

export const missionApi = new MissionApiService();
export const missionBackendApi = missionApi;
