/**
 * DTO → domain mapping. With `dto.ts`, the only module pair that knows the
 * backend's field names (PRD P-20.24).
 *
 * Mapping rule, and it is a safety rule: a field the backend did not send
 * becomes `null`. Never a default, never a plausible-looking number. The UI
 * renders `null` as an em-dash, so a missing measurement is visibly missing.
 */

import type {
  AssistantMessage,
  AuthUser,
  CitationSource,
  Classification,
  Coordinate,
  CoverageSummary,
  Detection,
  DetectionClass,
  FlightMode,
  GpsFixType,
  PassKind,
  ReportItem,
  ReviewRecord,
  ReviewState,
  RiskBand,
  RiskInputs,
  SafePathResult,
  ScanSession,
  SessionConfig,
  SessionState,
  SubsystemHealth,
  SubsystemStatus,
  SystemEventAlert,
  TrackPoint,
  UserRole,
  VlmVerdict,
} from '../domain/types';

import type {
  AssistantMessageDto,
  AuthUserDto,
  CitationSourceDto,
  NarrativeCitationSourceDto,
  CoordinateDto,
  CoverageSummaryDto,
  DetectionClassDto,
  DetectionDto,
  ReportItemDto,
  ReviewRecordDto,
  RiskInputsDto,
  SafePathResultDto,
  ScanSessionDto,
  SessionConfigDto,
  SubsystemHealthDto,
  SystemEventAlertDto,
  TrackPointDto,
} from './dto';

// ── Coercion helpers ────────────────────────────────────

/** A finite number, or null. Rejects NaN, Infinity, and non-numbers. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A non-empty string, or null. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** One of a known set of literals, or the stated fallback. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** One of a known set of literals, or null when absent/unrecognised. */
function oneOfOrNull<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const FIX_TYPES = ['no_fix', 'fix_2d', 'fix_3d', 'dgps', 'rtk_float', 'rtk_fixed'] as const;
const CLASSIFICATIONS = ['confirmed', 'unconfirmed_visual', 'unresolved_metal'] as const;
const RISK_BANDS = ['high', 'medium', 'low'] as const;
const REVIEW_STATES = ['unreviewed', 'operator_endorsed', 'operator_disputed'] as const;
const VLM_VERDICTS = ['agree', 'uncertain', 'reject', 'not_run'] as const;
const SESSION_STATES = ['created', 'active', 'ended', 'aborted'] as const;
const FLIGHT_MODES = ['rc_manual', 'ardupilot_auto'] as const;
const PASS_KINDS = ['survey', 'confirmation'] as const;
const SUBSYSTEM_STATUSES = ['ok', 'warning', 'critical', 'offline'] as const;
const USER_ROLES = ['admin', 'operator', 'analyst'] as const;
const IMAGERY_STATUSES = ['pending', 'received', 'lost'] as const;
const FRAME_STATUSES = ['onboard', 'reconciled', 'missing'] as const;
const REPORT_STATUSES = ['generating', 'ready', 'failed'] as const;
const ALERT_SEVERITIES = ['warning', 'critical', 'info'] as const;
const ALERT_CODES = [
  'UNDERSAMPLED',
  'CAMERA_FAULT',
  'METAL_SENSOR_OFFLINE',
  'TIME_SYNC_DEGRADED',
  'LINK_LOST',
  'LOW_BATTERY',
  'METAL_BASELINE_UNSTABLE',
  'GPS_DEGRADED',
] as const;
const CLASS_CATEGORIES = ['ordnance_ap', 'ordnance_at', 'uxo', 'debris', 'marker'] as const;

// ── Geometry ────────────────────────────────────────────

export function toCoordinate(dto: CoordinateDto | undefined): Coordinate | null {
  const lat = num(dto?.lat);
  const lon = num(dto?.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, altAglM: num(dto?.altAglM), altAmslM: num(dto?.altAmslM) };
}

function toCoordinateList(list: CoordinateDto[] | undefined): Coordinate[] {
  if (!Array.isArray(list)) return [];
  return list.map(toCoordinate).filter((c): c is Coordinate => c !== null);
}

// ── Session ─────────────────────────────────────────────

export function toSessionConfig(dto: SessionConfigDto | undefined): SessionConfig {
  return {
    visualConfidenceThreshold: num(dto?.visualConfidenceThreshold),
    metalThresholdNorm: num(dto?.metalThresholdNorm),
    nominalAglM: num(dto?.nominalAglM),
    inferenceWidthPx: num(dto?.inferenceWidthPx),
    forwardOverlap: num(dto?.forwardOverlap),
    sideOverlap: num(dto?.sideOverlap),
    associationRadiusM: num(dto?.associationRadiusM),
    metalMaxStandoffM: num(dto?.metalMaxStandoffM),
    visualSwathModel: dto?.visualSwathModel === 'fov' ? 'fov' : null,
    metalSwathM: num(dto?.metalSwathM),
  };
}

export function toScanSession(dto: ScanSessionDto): ScanSession | null {
  const id = str(dto.id);
  if (id === null) return null;
  return {
    id,
    siteName: str(dto.siteName) ?? id,
    state: oneOf<SessionState>(dto.state, SESSION_STATES, 'unknown'),
    flightMode: oneOfOrNull<FlightMode>(dto.flightMode, FLIGHT_MODES),
    startedAt: str(dto.startedAt) ?? '',
    endedAt: str(dto.endedAt),
    operatorId: str(dto.operatorId) ?? '',
    operatorName: str(dto.operatorName),
    utmEpsg: num(dto.utmEpsg),
    config: toSessionConfig(dto.config),
    notes: str(dto.notes) ?? '',
  };
}

// ── Telemetry ───────────────────────────────────────────

export function toTrackPoint(dto: TrackPointDto): TrackPoint | null {
  const sessionId = str(dto.sessionId);
  const position = toCoordinate(dto.position);
  if (sessionId === null || position === null) return null;
  return {
    sessionId,
    tUtc: str(dto.tUtc) ?? '',
    tMonoNs: num(dto.tMonoNs),
    position,
    groundSpeedMs: num(dto.groundSpeedMs),
    headingDeg: num(dto.headingDeg),
    rollDeg: num(dto.rollDeg),
    pitchDeg: num(dto.pitchDeg),
    fixType: oneOfOrNull<GpsFixType>(dto.fixType, FIX_TYPES),
    hdop: num(dto.hdop),
    satellites: num(dto.satellites),
    batteryPercent: num(dto.batteryPercent),
    linkQualityPercent: num(dto.linkQualityPercent),
    pass: oneOfOrNull<PassKind>(dto.pass, PASS_KINDS),
    achievedFps: num(dto.achievedFps),
    requiredFps: num(dto.requiredFps),
    isUndersampled: typeof dto.isUndersampled === 'boolean' ? dto.isUndersampled : null,
  };
}

export function toTrackPoints(list: TrackPointDto[]): TrackPoint[] {
  return list.map(toTrackPoint).filter((p): p is TrackPoint => p !== null);
}

// ── Detection ───────────────────────────────────────────

function toRiskInputs(dto: RiskInputsDto | null | undefined): RiskInputs | null {
  if (!dto) return null;
  const visualNorm = num(dto.visualNorm);
  const metalNorm = num(dto.metalNorm);
  const corroborationNorm = num(dto.corroborationNorm);
  const formulaVersion = str(dto.formulaVersion);
  if (visualNorm === null || metalNorm === null || corroborationNorm === null) return null;
  return {
    visualNorm,
    metalNorm,
    corroborationNorm,
    weights: {
      visual: num(dto.weights?.visual) ?? 0,
      metal: num(dto.weights?.metal) ?? 0,
      corroboration: num(dto.weights?.corroboration) ?? 0,
    },
    thresholds: {
      visual: num(dto.thresholds?.visual) ?? 0,
      metal: num(dto.thresholds?.metal) ?? 0,
    },
    overridesApplied: strArray(dto.overridesApplied),
    formulaVersion: formulaVersion ?? 'unknown',
  };
}

function toReviewRecord(dto: ReviewRecordDto): ReviewRecord | null {
  const reviewedAt = str(dto.reviewedAt);
  if (reviewedAt === null) return null;
  const reviewerName = str(dto.reviewerName);
  const note = str(dto.note);
  return {
    reviewState: oneOf<ReviewState>(dto.reviewState, REVIEW_STATES, 'unreviewed'),
    reviewedAt,
    reviewedBy: str(dto.reviewedBy) ?? '',
    ...(reviewerName === null ? {} : { reviewerName }),
    ...(note === null ? {} : { note }),
  };
}

export function toDetection(dto: DetectionDto): Detection | null {
  const id = str(dto.id);
  const sessionId = str(dto.sessionId);
  const position = toCoordinate(dto.position);
  if (id === null || sessionId === null || position === null) return null;

  const classification = oneOfOrNull<Classification>(dto.classification, CLASSIFICATIONS);
  if (classification === null) return null; // an unclassified row is not renderable

  const riskBand = oneOfOrNull<RiskBand>(dto.riskBand, RISK_BANDS);

  return {
    id,
    sessionId,
    classification,
    position,
    localizationUncertaintyM: num(dto.localizationUncertaintyM),
    firstObservedAt: str(dto.firstObservedAt) ?? '',
    lastObservedAt: str(dto.lastObservedAt) ?? '',
    visualCandidateIds: strArray(dto.visualCandidateIds),
    metalHitIds: strArray(dto.metalHitIds),
    corroborationCount: num(dto.corroborationCount),
    bestVisualConfidence: num(dto.bestVisualConfidence),
    bestMetalSignalNorm: num(dto.bestMetalSignalNorm),
    bestMetalStandoffM: num(dto.bestMetalStandoffM),
    classId: str(dto.classId),
    className: str(dto.className),
    deviceType: dto.deviceType === 'camera' || dto.deviceType === 'metal' ? dto.deviceType : null,
    confidenceScore: num(dto.confidenceScore),
    confidencePercent: num(dto.confidencePercent),
    // Preserve stored risk independently from sensor classification.
    riskScore: num(dto.riskScore),
    riskBand,
    riskComputedAt: str(dto.riskComputedAt),
    riskInputs: toRiskInputs(dto.riskInputs),
    vlmVerdict: oneOf<VlmVerdict>(dto.vlmVerdict, VLM_VERDICTS, 'not_run'),
    vlmRationale: str(dto.vlmRationale),
    gradCamRef: str(dto.gradCamRef),
    gradCamUrl: str(dto.gradCamUrl),
    thumbnailStatus: oneOf(dto.thumbnailStatus, IMAGERY_STATUSES, 'pending'),
    fullFrameStatus: oneOf(dto.fullFrameStatus, FRAME_STATUSES, 'onboard'),
    thumbnailUrl: str(dto.thumbnailUrl),
    fullFrameUrl: str(dto.fullFrameUrl),
    reviewState: oneOf<ReviewState>(dto.reviewState, REVIEW_STATES, 'unreviewed'),
    reviewHistory: (dto.reviewHistory ?? [])
      .map(toReviewRecord)
      .filter((r): r is ReviewRecord => r !== null),
  };
}

export function toDetections(list: DetectionDto[]): Detection[] {
  return list.map(toDetection).filter((d): d is Detection => d !== null);
}

// ── Coverage & routing ──────────────────────────────────

export function toCoverageSummary(
  dto: CoverageSummaryDto,
  fallbackSessionId: string,
): CoverageSummary {
  return {
    sessionId: str(dto.sessionId) ?? fallbackSessionId,
    cellSizeM: num(dto.cellSizeM),
    visualSweptAreaM2: num(dto.visualSweptAreaM2),
    dualSweptAreaM2: num(dto.dualSweptAreaM2),
    degradedAreaM2: num(dto.degradedAreaM2),
    trackLengthM: num(dto.trackLengthM),
    visualSwathM: num(dto.visualSwathM),
  };
}

export function toSafePathResult(
  dto: SafePathResultDto,
  fallbackSessionId: string,
): SafePathResult {
  return {
    sessionId: str(dto.sessionId) ?? fallbackSessionId,
    pathFound: dto.pathFound === true,
    waypoints: toCoordinateList(dto.waypoints),
    totalDistanceM: num(dto.totalDistanceM),
    minStandoffAchievedM: num(dto.minStandoffAchievedM),
    confirmedDetectionsNearRoute: num(dto.confirmedDetectionsNearRoute),
    unconfirmedDetectionsNearRoute: num(dto.unconfirmedDetectionsNearRoute),
    advisoryCorridorWaypoints: toCoordinateList(dto.advisoryCorridorWaypoints),
    disclaimer: str(dto.disclaimer) ?? '',
    failureReason: str(dto.failureReason),
  };
}

// ── System health & alerts ──────────────────────────────

export function toSubsystemHealth(dto: SubsystemHealthDto): SubsystemHealth | null {
  const id = str(dto.id);
  if (id === null) return null;
  return {
    id,
    name: str(dto.name) ?? id,
    status: oneOf<SubsystemStatus>(dto.status, SUBSYSTEM_STATUSES, 'offline'),
    details: str(dto.details) ?? '',
    lastHeartbeat: str(dto.lastHeartbeat) ?? '',
    ...(dto.metrics && typeof dto.metrics === 'object' ? { metrics: dto.metrics } : {}),
  };
}

export function toSystemEventAlert(dto: SystemEventAlertDto): SystemEventAlert | null {
  const id = str(dto.id);
  const code = oneOfOrNull(dto.code, ALERT_CODES);
  if (id === null || code === null) return null;
  const sessionId = str(dto.sessionId);
  return {
    id,
    ...(sessionId === null ? {} : { sessionId }),
    tUtc: str(dto.tUtc) ?? '',
    severity: oneOf(dto.severity, ALERT_SEVERITIES, 'info'),
    code,
    message: str(dto.message) ?? '',
    acknowledged: dto.acknowledged === true,
  };
}

export function toDetectionClass(dto: DetectionClassDto): DetectionClass | null {
  const id = str(dto.id);
  if (id === null) return null;
  const diameter = num(dto.nominalDiameterMm);
  return {
    id,
    name: str(dto.name) ?? id,
    description: str(dto.description) ?? '',
    category: oneOf(dto.category, CLASS_CATEGORIES, 'debris'),
    ...(diameter === null ? {} : { nominalDiameterMm: diameter }),
  };
}

// ── Reports ─────────────────────────────────────────────

function toReportSource(value: unknown): CitationSource | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as CitationSourceDto;
  const sha256 = str(source.sha256);
  return {
    document: str(source.document) ?? 'Mission source',
    section: str(source.section) ?? '',
    snippet: str(source.snippet) ?? '',
    sessionId: str(source.sessionId),
    sourceId: str(source.sourceId),
    sourceType: str(source.sourceType),
    sourceRecordId: str(source.sourceRecordId),
    similarity: num(source.similarity),
    ...(sha256 === null ? {} : { sha256 }),
  };
}

export function toReportItem(dto: ReportItemDto | null | undefined): ReportItem | null {
  if (!dto || typeof dto !== 'object') return null;
  const id = str(dto.id);
  const sessionId = str(dto.sessionId);
  if (id === null || sessionId === null) return null;
  const s = dto.summary ?? {};
  const downloadUrl = str(dto.downloadUrl);
  const csvDownloadUrl = str(dto.csvDownloadUrl);
  const sources: unknown[] = Array.isArray(dto.sources) ? dto.sources : [];
  const narrativeSources: unknown[] = Array.isArray(dto.narrativeSources)
    ? dto.narrativeSources
    : [];
  return {
    id,
    reportNumber: num(dto.reportNumber) ?? 0,
    sessionId,
    siteName: str(dto.siteName) ?? sessionId,
    generatedAt: str(dto.generatedAt) ?? '',
    status:
      dto.status === 'ready' && downloadUrl === null
        ? 'failed'
        : oneOf(dto.status, REPORT_STATUSES, 'generating'),
    formulaVersion: str(dto.formulaVersion) ?? 'unknown',
    contentHash: str(dto.contentHash) ?? '',
    ...(downloadUrl === null ? {} : { downloadUrl }),
    ...(csvDownloadUrl === null ? {} : { csvDownloadUrl }),
    ...(dto.generationMode === 'factual' || dto.generationMode === 'rag'
      ? { generationMode: dto.generationMode }
      : {}),
    narrative: str(dto.narrative),
    narrativeError: str(dto.narrativeError),
    synthetic: dto.synthetic === true,
    ...(dto.hardware ? { hardware: dto.hardware } : {}),
    ...(dto.recordCounts
      ? {
          recordCounts: {
            firebaseEvents: num(dto.recordCounts.firebaseEvents),
            firebaseMatched: num(dto.recordCounts.firebaseMatched),
            firebasePending: num(dto.recordCounts.firebasePending),
            firebaseInvalid: num(dto.recordCounts.firebaseInvalid),
            firebaseRemoved: num(dto.recordCounts.firebaseRemoved),
            imageInferenceRuns: num(dto.recordCounts.imageInferenceRuns),
            imagePredictions: num(dto.recordCounts.imagePredictions),
            unlocalizedImagePredictions: num(dto.recordCounts.unlocalizedImagePredictions),
          },
        }
      : {}),
    sources: sources
      .map(toReportSource)
      .filter((source): source is CitationSource => source !== null),
    ...(Array.isArray(dto.narrativeSources)
      ? {
          narrativeSources: narrativeSources.flatMap((value) => {
            const source = toReportSource(value);
            if (source === null) return [];
            const citationNumber = num((value as NarrativeCitationSourceDto).citationNumber);
            if (citationNumber === null || citationNumber < 1 || !Number.isInteger(citationNumber))
              return [];
            return [{ ...source, citationNumber }];
          }),
        }
      : {}),
    summary: {
      confirmedMinesCount: num(s.confirmedMinesCount),
      highRiskCount: num(s.highRiskCount),
      mediumRiskCount: num(s.mediumRiskCount),
      lowRiskCount: num(s.lowRiskCount),
      unconfirmedVisualCount: num(s.unconfirmedVisualCount),
      unresolvedMetalCount: num(s.unresolvedMetalCount),
      visualSweptAreaM2: num(s.visualSweptAreaM2),
      dualSweptAreaM2: num(s.dualSweptAreaM2),
    },
  };
}

// ── Assistant & auth ────────────────────────────────────

export function toAssistantMessage(dto: AssistantMessageDto): AssistantMessage | null {
  const id = str(dto.id);
  const text = str(dto.text);
  if (id === null || text === null) return null;
  const sqlQuery = str(dto.sqlQuery);
  const refusalReason = str(dto.refusalReason);
  const citations = (dto.citations ?? []).map((c) => {
    const page = num(c.page);
    const version = str(c.version);
    return {
      document: str(c.document) ?? '',
      section: str(c.section) ?? '',
      snippet: str(c.snippet) ?? '',
      ...(page === null ? {} : { page }),
      ...(version === null ? {} : { version }),
    };
  });
  return {
    id,
    sender: dto.sender === 'user' ? 'user' : 'assistant',
    timestamp: str(dto.timestamp) ?? new Date().toISOString(),
    text,
    ...(citations.length === 0 ? {} : { citations }),
    ...(sqlQuery === null ? {} : { sqlQuery }),
    ...(dto.isVoiceInput === true ? { isVoiceInput: true } : {}),
    ...(dto.refused === true ? { refused: true } : {}),
    ...(refusalReason === null ? {} : { refusalReason }),
  };
}

export function toAuthUser(dto: AuthUserDto): AuthUser | null {
  const id = str(dto.id);
  const email = str(dto.email);
  if (id === null || email === null) return null;
  const callsign = str(dto.callsign);
  return {
    id,
    email,
    name: str(dto.name) ?? email,
    role: oneOf<UserRole>(dto.role, USER_ROLES, 'operator'),
    ...(callsign === null ? {} : { callsign }),
  };
}
