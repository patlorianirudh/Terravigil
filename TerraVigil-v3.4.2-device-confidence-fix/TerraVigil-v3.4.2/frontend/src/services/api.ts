/**
 * TerraVigil REST client — PRD §19.1, all 15 routes.
 *
 * The live adapter uses HTTP and domain mappers. The explicitly selected demo
 * adapter implements the same contract, leaving page-level integrations intact.
 */

import type {
  AssistantMessage,
  AuthUser,
  Classification,
  CoverageSummary,
  Detection,
  DetectionClass,
  FlightMode,
  InferenceRequest,
  MissionStatistics,
  MissionPreparation,
  ReportItem,
  ReviewState,
  RiskBand,
  SafePathRequest,
  SafePathResult,
  SampleMissionLoadResult,
  ScanSession,
  SessionConfig,
  SubsystemHealth,
  SystemEventAlert,
  TrackPoint,
} from '../domain/types';

import { request, rememberToken, getAuthToken } from './http';
import { config } from '../config';
import { missionApi } from './missionBackend';
import { ServiceError } from './errors';
import { readInferenceStatus, runImageInference } from './inference';
import type {
  AssistantMessageDto,
  AuthUserDto,
  CoverageSummaryDto,
  DetectionClassDto,
  DetectionDto,
  LoginResponseDto,
  ReportItemDto,
  SafePathResultDto,
  ScanSessionDto,
  SubsystemHealthDto,
  SystemEventAlertDto,
  TrackPointDto,
} from './dto';
import {
  toAssistantMessage,
  toAuthUser,
  toCoverageSummary,
  toDetection,
  toDetectionClass,
  toDetections,
  toReportItem,
  toSafePathResult,
  toScanSession,
  toSubsystemHealth,
  toSystemEventAlert,
  toTrackPoints,
} from './mappers';

export interface DetectionFilters {
  classification?: Classification;
  riskBand?: RiskBand;
  minConfidence?: number;
  minMetal?: number;
  reviewState?: ReviewState;
  search?: string;
}

export interface CreateSessionPayload {
  siteName: string;
  flightMode: FlightMode;
  notes: string;
  config: Partial<SessionConfig>;
}

function required<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new ServiceError('invalid', `The backend returned a ${what} the dashboard cannot read.`);
  }
  return value;
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

class LiveApiService {
  getInferenceStatus() {
    return readInferenceStatus();
  }
  predictImage(input: InferenceRequest) {
    return runImageInference(input);
  }

  public getAuthToken(): string | null {
    return getAuthToken();
  }

  public setAuthToken(token: string | null): void {
    rememberToken(token);
  }

  // ── Route 1: Auth ──
  async login(email: string, password: string): Promise<AuthUser> {
    const res = await request<LoginResponseDto>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    rememberToken(res.token ?? null);
    return required(toAuthUser(res.user ?? {}), 'user record');
  }

  async logout(): Promise<void> {
    try {
      await request<unknown>('/auth/logout', { method: 'POST' });
    } finally {
      rememberToken(null);
    }
  }

  async getMe(): Promise<AuthUser | null> {
    if (getAuthToken() === null) return null;
    const dto = await request<AuthUserDto>('/auth/me');
    return toAuthUser(dto);
  }

  // ── Route 2: Sessions ──
  async getSessions(): Promise<ScanSession[]> {
    const dtos = await request<ScanSessionDto[]>('/sessions');
    return list<ScanSessionDto>(dtos)
      .map(toScanSession)
      .filter((s): s is ScanSession => s !== null);
  }

  async getSession(id: string): Promise<ScanSession | null> {
    const dto = await request<ScanSessionDto>(`/sessions/${encodeURIComponent(id)}`);
    return toScanSession(dto);
  }

  loadSampleMission(): Promise<SampleMissionLoadResult> {
    return Promise.reject(
      new ServiceError('unavailable', 'Sample mission loading requires the mission backend.'),
    );
  }

  async createSession(payload: CreateSessionPayload): Promise<ScanSession> {
    const dto = await request<ScanSessionDto>('/sessions', { method: 'POST', body: payload });
    return required(toScanSession(dto), 'session record');
  }

  async endSession(id: string): Promise<ScanSession> {
    const dto = await request<ScanSessionDto>(`/sessions/${encodeURIComponent(id)}/end`, {
      method: 'POST',
    });
    return required(toScanSession(dto), 'session record');
  }

  // ── Routes 3 & 4: Detections ──
  async getDetections(sessionId?: string, filters?: DetectionFilters): Promise<Detection[]> {
    const dtos = await request<DetectionDto[]>('/detections', {
      query: {
        sessionId,
        classification: filters?.classification,
        riskBand: filters?.riskBand,
        reviewState: filters?.reviewState,
        minConfidence: filters?.minConfidence,
        minMetal: filters?.minMetal,
        search: filters?.search === '' ? undefined : filters?.search,
      },
    });
    return toDetections(list<DetectionDto>(dtos));
  }

  async getDetection(id: string): Promise<Detection | null> {
    const dto = await request<DetectionDto>(`/detections/${encodeURIComponent(id)}`);
    return toDetection(dto);
  }

  // ── Route 5: Detection review action (append-only) ──
  async submitReview(
    detectionId: string,
    reviewState: ReviewState,
    note?: string,
  ): Promise<Detection> {
    const dto = await request<DetectionDto>(
      `/detections/${encodeURIComponent(detectionId)}/review`,
      { method: 'POST', body: { reviewState, ...(note === undefined ? {} : { note }) } },
    );
    return required(toDetection(dto), 'detection record');
  }

  // ── Route 6: Track ──
  async getTrack(sessionId: string): Promise<TrackPoint[]> {
    const dtos = await request<TrackPointDto[]>(`/sessions/${encodeURIComponent(sessionId)}/track`);
    return toTrackPoints(list<TrackPointDto>(dtos));
  }

  // ── Route 7: Coverage ──
  async getCoverage(sessionId: string): Promise<CoverageSummary> {
    const dto = await request<CoverageSummaryDto>(
      `/sessions/${encodeURIComponent(sessionId)}/coverage`,
    );
    return toCoverageSummary(dto, sessionId);
  }

  // ── Route 8: Risk surface (server filters to classification = 'confirmed') ──
  async getRiskSurface(sessionId: string): Promise<Detection[]> {
    const dtos = await request<DetectionDto[]>(
      `/sessions/${encodeURIComponent(sessionId)}/risk-surface`,
    );
    return toDetections(list<DetectionDto>(dtos));
  }

  getMissionStatistics(_sessionId: string): Promise<MissionStatistics> {
    return Promise.reject(
      new ServiceError('unavailable', 'Mission statistics are not available in the PRD adapter.'),
    );
  }

  // ── Route 9: Minimum-risk route planner (A*) ──
  async calculateSafePath(req: SafePathRequest): Promise<SafePathResult> {
    const dto = await request<SafePathResultDto>('/route/minimum-risk', {
      method: 'POST',
      body: req,
    });
    return toSafePathResult(dto, req.sessionId);
  }

  // ── Route 10: Doctrine assistant (retrieval + structured query) ──
  async queryAssistant(query: string, sessionId?: string): Promise<AssistantMessage> {
    const dto = await request<AssistantMessageDto>('/assistant/query', {
      method: 'POST',
      body: { query, ...(sessionId === undefined ? {} : { sessionId }) },
    });
    return required(toAssistantMessage(dto), 'assistant response');
  }

  prepareMission(_sessionId: string): Promise<MissionPreparation> {
    return Promise.reject(
      new ServiceError(
        'unavailable',
        'Mission RAG preparation is not available in the PRD adapter.',
      ),
    );
  }

  // ── Route 11: Reports ──
  async getReports(): Promise<ReportItem[]> {
    const dtos = await request<ReportItemDto[]>('/reports');
    return list<ReportItemDto>(dtos)
      .map(toReportItem)
      .filter((r): r is ReportItem => r !== null);
  }

  async getReport(id: string): Promise<ReportItem | null> {
    const dto = await request<ReportItemDto>(`/reports/${encodeURIComponent(id)}`);
    return toReportItem(dto);
  }

  async generateReport(sessionId: string, includeAi = false): Promise<ReportItem> {
    const dto = await request<ReportItemDto>('/reports', {
      method: 'POST',
      body: { sessionId, includeAi },
    });
    return required(toReportItem(dto), 'report record');
  }

  // ── Route 12: System health & events ──
  async getSystemHealth(): Promise<SubsystemHealth[]> {
    const dtos = await request<SubsystemHealthDto[]>('/system/health');
    return list<SubsystemHealthDto>(dtos)
      .map(toSubsystemHealth)
      .filter((s): s is SubsystemHealth => s !== null);
  }

  async getSystemEvents(sessionId?: string): Promise<SystemEventAlert[]> {
    const dtos = await request<SystemEventAlertDto[]>('/system/events', { query: { sessionId } });
    return list<SystemEventAlertDto>(dtos)
      .map(toSystemEventAlert)
      .filter((a): a is SystemEventAlert => a !== null);
  }

  // ── Route 13: Catalog (P-20.19 — no class name is hardcoded in the client) ──
  async getDetectionClasses(): Promise<DetectionClass[]> {
    const dtos = await request<DetectionClassDto[]>('/catalog/detection-classes');
    return list<DetectionClassDto>(dtos)
      .map(toDetectionClass)
      .filter((c): c is DetectionClass => c !== null);
  }
}

export type ApiContract = LiveApiService;
export const api: ApiContract = config.backendStyle === 'prd' ? new LiveApiService() : missionApi;
