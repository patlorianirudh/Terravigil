/** Wire boundary for the existing CommonJS /missions API. */
import type {
  AssistantMessage,
  CitationSource,
  Coordinate,
  Detection,
  MissionStatistics,
  MissionPreparation,
  RiskBand,
  SafePathRequest,
  SafePathResult,
  SampleMissionLoadResult,
  SampleRouteEndpoints,
  ScanSession,
  SessionState,
  TrackPoint,
} from '../domain/types';
import { toSessionConfig } from './mappers';
import { apiAssetUrl } from './assetUrl';

type WireRecord = Record<string, unknown>;
export type EvidenceSource = 'detection' | 'observation';

function record(value: unknown): WireRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as WireRecord)
    : {};
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function time(value: unknown): string | null {
  const text = string(value);
  return text !== null && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function coordinate(dto: WireRecord): Coordinate | null {
  const lat = number(dto.latitude);
  const lon = number(dto.longitude);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // The original API's `altitude` has no declared datum. It is neither AGL nor AMSL.
  // The firebase telemetry bridge sends `relative_altitude_m` (AGL, home-relative)
  // and `altitude_amsl_m`; accept both spellings so altitude always renders.
  return {
    lat,
    lon,
    altitudeM: number(dto.altitude),
    altAglM: number(dto.altitude_agl_m) ?? number(dto.relative_altitude_m),
    altAmslM: number(dto.altitude_amsl_m) ?? number(dto.altitude_m),
  };
}

function routeCoordinate(value: unknown): Coordinate | null {
  const dto = record(value);
  const lat = number(dto.lat);
  const lon = number(dto.lon);
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon }
    : null;
}

function routeEndpoints(value: unknown): SampleRouteEndpoints | null {
  const dto = record(value);
  const start = routeCoordinate(dto.start);
  const end = routeCoordinate(dto.end);
  if (start === null || end === null || (start.lat === end.lat && start.lon === end.lon))
    return null;
  return { start, end };
}

function count(value: unknown): number | null {
  const result = number(value);
  return result !== null && Number.isInteger(result) && result >= 0 ? result : null;
}

export function toMission(value: unknown): ScanSession | null {
  const dto = record(value);
  const id = string(dto.mission_id);
  if (id === null) return null;
  const sampleRoute = dto.sample === true ? routeEndpoints(dto.sample_route) : null;
  const states: Record<string, SessionState> = {
    CREATED: 'created',
    ACTIVE: 'active',
    IN_PROGRESS: 'active',
    COMPLETED: 'ended',
    ENDED: 'ended',
    ABORTED: 'aborted',
    CANCELLED: 'aborted',
  };
  return {
    id,
    siteName: string(dto.location) ?? id,
    state: states[string(dto.status)?.toUpperCase() ?? ''] ?? 'unknown',
    flightMode:
      dto.flight_mode === 'ardupilot_auto' || dto.flight_mode === 'rc_manual'
        ? dto.flight_mode
        : null,
    startedAt: time(dto.date) ?? '',
    endedAt: time(dto.ended_at),
    operatorId: '',
    operatorName: string(dto.operator_name),
    utmEpsg: number(dto.utm_epsg),
    config: toSessionConfig(record(dto.config)),
    notes: string(dto.notes) ?? '',
    ...(dto.sample === true ? { isSample: true } : {}),
    ...(sampleRoute === null ? {} : { sampleRoute }),
  };
}

export function toSampleMissionLoad(value: unknown): SampleMissionLoadResult | null {
  const dto = record(value);
  const counts = record(dto.counts);
  const detections = count(counts.detections);
  const observations = count(counts.observations);
  const telemetry = count(counts.telemetry);
  const suggestedRoute = routeEndpoints(dto.suggestedRoute);
  if (
    dto.mission_id !== 'SAMPLE-TV001' ||
    dto.synthetic !== true ||
    typeof dto.created !== 'boolean' ||
    detections === null ||
    observations === null ||
    telemetry === null ||
    suggestedRoute === null
  )
    return null;
  return {
    sessionId: dto.mission_id,
    created: dto.created,
    synthetic: true,
    counts: { detections, observations, telemetry },
    suggestedRoute,
  };
}

export function toMissionRouteRequest(value: SafePathRequest): SafePathRequest | null {
  const endpoints = routeEndpoints(value);
  const minStandoffM = value.minStandoffM === undefined ? 5 : number(value.minStandoffM);
  const cautionWeight = value.cautionWeight === undefined ? 0.6 : number(value.cautionWeight);
  if (
    string(value.sessionId) === null ||
    endpoints === null ||
    minStandoffM === null ||
    minStandoffM < 3.5 ||
    minStandoffM > 20 ||
    cautionWeight === null ||
    cautionWeight < 0 ||
    cautionWeight > 1
  )
    return null;
  return { sessionId: value.sessionId, ...endpoints, minStandoffM, cautionWeight };
}

export function toMissionRouteResult(
  value: unknown,
  request: SafePathRequest,
): SafePathResult | null {
  const dto = record(value);
  const disclaimer = string(dto.disclaimer);
  if (
    dto.sessionId !== request.sessionId ||
    typeof dto.pathFound !== 'boolean' ||
    !Array.isArray(dto.waypoints) ||
    disclaimer === null
  )
    return null;
  const waypoints = dto.waypoints.map(routeCoordinate);
  if (waypoints.some((point) => point === null)) return null;
  const totalDistanceM = number(dto.totalDistanceM);
  const minStandoffAchievedM = number(dto.minStandoffAchievedM);
  const confirmedDetectionsNearRoute = count(dto.confirmedDetectionsNearRoute);
  const unconfirmedDetectionsNearRoute = count(dto.unconfirmedDetectionsNearRoute);
  const failureReason = string(dto.failureReason);
  if (dto.pathFound) {
    const matches = (point: Coordinate | null | undefined, endpoint: Coordinate) =>
      point != null &&
      Math.abs(point.lat - endpoint.lat) <= 1e-7 &&
      Math.abs(point.lon - endpoint.lon) <= 1e-7;
    if (
      waypoints.length < 2 ||
      !matches(waypoints[0], request.start) ||
      !matches(waypoints.at(-1), request.end) ||
      totalDistanceM === null ||
      totalDistanceM <= 0 ||
      (dto.minStandoffAchievedM !== null &&
        (minStandoffAchievedM === null ||
          minStandoffAchievedM < (request.minStandoffM ?? 5) - 1e-6)) ||
      confirmedDetectionsNearRoute === null ||
      unconfirmedDetectionsNearRoute === null
    )
      return null;
  } else if (
    waypoints.length !== 0 ||
    dto.totalDistanceM !== null ||
    dto.minStandoffAchievedM !== null ||
    dto.confirmedDetectionsNearRoute !== null ||
    dto.unconfirmedDetectionsNearRoute !== null ||
    failureReason === null
  )
    return null;
  return {
    sessionId: request.sessionId,
    pathFound: dto.pathFound,
    waypoints: waypoints as Coordinate[],
    totalDistanceM,
    minStandoffAchievedM,
    confirmedDetectionsNearRoute,
    unconfirmedDetectionsNearRoute,
    disclaimer,
    ...(failureReason === null ? {} : { failureReason }),
  };
}

export function evidenceIdentity(
  source: EvidenceSource,
  missionId: string,
  recordId: string,
): string {
  // URL-safe, reversible identity: duplicate logical detection IDs remain distinct.
  return `record-${btoa(encodeURIComponent(JSON.stringify([source, missionId, recordId])))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')}`;
}

export function readEvidenceIdentity(
  id: string,
): { source: EvidenceSource; missionId: string; recordId: string } | null {
  if (!id.startsWith('record-')) return null;
  try {
    const parsed: unknown = JSON.parse(
      decodeURIComponent(atob(id.slice(7).replaceAll('-', '+').replaceAll('_', '/'))),
    );
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [source, missionId, recordId] = parsed as unknown[];
    if (
      (source !== 'detection' && source !== 'observation') ||
      typeof missionId !== 'string' ||
      typeof recordId !== 'string'
    )
      return null;
    return { source, missionId, recordId };
  } catch {
    return null;
  }
}

function confirmationIssue(dto: WireRecord): string | null {
  const confidence = number(dto.yolo_confidence);
  const metal = typeof dto.metal_detected === 'boolean' ? dto.metal_detected : null;
  if (dto.status === 'CONFIRMED') {
    if (metal === false || (confidence !== null && confidence < 0.7) || dto.layer === 'LAYER_2')
      return 'Stored confirmation contradicts the supplied sensor evidence.';
    if (metal === null || confidence === null)
      return 'Stored confirmation has incomplete sensor evidence.';
  }
  if (
    dto.status === 'UNCONFIRMED' &&
    (dto.layer === 'LAYER_1' || (metal === true && confidence !== null && confidence >= 0.7))
  )
    return 'Stored unconfirmed status contradicts the supplied sensor evidence.';
  return null;
}

export function toMissionEvidence(value: unknown, sourceType: EvidenceSource): Detection | null {
  const dto = record(value);
  const sourceId = string(sourceType === 'detection' ? dto.detection_id : dto.observation_id);
  const sourceRecordId = string(dto._id) ?? string(record(dto._id).$oid);
  const recordId = sourceRecordId ?? sourceId;
  const sessionId = string(dto.mission_id);
  const position = coordinate(dto);
  const rawDevice = string(dto.device)?.trim().toLowerCase();
  const deviceType = rawDevice === 'metal_detector'
    ? 'metal'
    : rawDevice === 'camera' || rawDevice === 'metal' ? rawDevice : null;
  const confidenceScore = number(dto.confidence_score) ?? number(dto.confidence) ??
    (deviceType === 'metal' ? null : number(dto.yolo_confidence));
  const confidencePercent = number(dto.confidence_percent) ??
    (confidenceScore === null ? null : confidenceScore * 100);
  const classification =
    dto.status === 'CONFIRMED'
      ? 'confirmed'
      : dto.status === 'UNCONFIRMED'
        ? deviceType === 'metal'
          ? 'unresolved_metal'
          : 'unconfirmed_visual'
        : null;
  if (recordId === null || sessionId === null || position === null || classification === null)
    return null;
  const observedAt = time(dto.timestamp) ?? time(dto.created_at) ?? '';
  const risk = string(dto.risk_level)?.toLowerCase();
  const riskBand: RiskBand | null =
    risk === 'high' || risk === 'medium' || risk === 'low' ? risk : null;
  const imageUrl = apiAssetUrl(dto.image_url ?? dto.image_path);
  const rawConfirmationSource = string(dto.confirmation_source);
  const confirmationSource = rawConfirmationSource === 'metal_sensor_only'
    ? 'Metal detector candidate only; camera corroboration is not recorded.'
    : rawConfirmationSource === 'camera_detector_only'
      ? 'Camera candidate only; metal-sensor corroboration is not recorded.'
      : rawConfirmationSource === 'visual_only'
        ? 'Visual candidate only; no metal-sensor corroboration is recorded.'
        : rawConfirmationSource;
  return {
    id: evidenceIdentity(sourceType, sessionId, recordId),
    sessionId,
    sourceType,
    sourceId,
    sourceRecordId,
    sourceStatus: string(dto.status),
    validationIssue: confirmationIssue(dto),
    classification,
    position,
    metalDetected: typeof dto.metal_detected === 'boolean' ? dto.metal_detected : null,
    deviceType,
    confidenceScore,
    confidencePercent,
    localizationUncertaintyM: null,
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    visualCandidateIds: [],
    metalHitIds: [],
    corroborationCount: null,
    bestVisualConfidence: deviceType === 'metal'
      ? null
      : number(dto.yolo_confidence) ?? (deviceType === 'camera' ? confidenceScore : null),
    bestMetalSignalNorm: number(dto.metal_signal),
    bestMetalStandoffM: number(dto.metal_standoff_m),
    classId: typeof dto.class_id === 'number' ? String(dto.class_id) : string(dto.class_id),
    className: string(dto.class_name),
    heightProfileId: number(dto.height_profile_id),
    normalizedCenter:
      number(record(dto.normalized_center).x) !== null &&
      number(record(dto.normalized_center).y) !== null
        ? { x: Number(record(dto.normalized_center).x), y: Number(record(dto.normalized_center).y) }
        : null,
    // Preserve stored backend risk, including Layer 2 labels; never calculate a score.
    riskBand,
    riskScore: null,
    riskComputedAt: null,
    riskInputs: null,
    vlmVerdict: null,
    vlmRationale: null,
    gradCamRef: null,
    gradCamUrl: null,
    // Onboard filesystem paths stay references; only served HTTP/API images are shown.
    imageRef: string(dto.image_path),
    ...(string(dto.inference_run_id) === null
      ? {}
      : { inferenceRunId: String(dto.inference_run_id) }),
    locationSource: string(dto.location_source),
    telemetryTimestamp: string(dto.telemetry_timestamp),
    telemetryMatchGapSeconds: number(dto.telemetry_match_gap_seconds),
    telemetryMatchMethod: string(dto.telemetry_match_method),
    timestampOriginal: typeof dto.timestamp_original === 'number' ? String(dto.timestamp_original) : string(dto.timestamp_original),
    targetLocationKnown:
      typeof dto.target_location_known === 'boolean' ? dto.target_location_known : null,
    confirmationSource,
    thumbnailStatus: imageUrl === null ? null : 'received',
    fullFrameStatus: imageUrl === null ? null : 'reconciled',
    thumbnailUrl: imageUrl,
    fullFrameUrl: imageUrl,
    reviewState: null,
    reviewHistory: [],
  };
}

export function toMissionTrack(value: unknown): TrackPoint | null {
  const dto = record(value);
  const sessionId = string(dto.mission_id);
  const position = coordinate(dto);
  if (sessionId === null || position === null) return null;
  // Pixhawk CSV numeric GPS fix type: 0/1 no fix, 2 = 2D, 3 = 3D, 4 = DGPS,
  // 5 = RTK float, 6 = RTK fixed.
  const fixByNumber: Record<number, TrackPoint['fixType']> = {
    0: 'no_fix',
    1: 'no_fix',
    2: 'fix_2d',
    3: 'fix_3d',
    4: 'dgps',
    5: 'rtk_float',
    6: 'rtk_fixed',
  };
  const fixNumber = number(dto.gps_fix_type);
  const armedText = dto.armed;
  return {
    sessionId,
    sourceRecordId: string(dto._id) ?? string(record(dto._id).$oid),
    position,
    tUtc: time(dto.timestamp) ?? time(dto.created_at) ?? '',
    tMonoNs: null,
    groundSpeedMs: number(dto.ground_speed_ms),
    headingDeg: number(dto.heading_deg),
    rollDeg: number(dto.roll_deg),
    pitchDeg: number(dto.pitch_deg),
    fixType: ['no_fix', 'fix_2d', 'fix_3d', 'dgps', 'rtk_float', 'rtk_fixed'].includes(
      String(dto.fix_type),
    )
      ? (dto.fix_type as TrackPoint['fixType'])
      : (fixNumber !== null ? (fixByNumber[fixNumber] ?? null) : null),
    hdop: number(dto.hdop),
    satellites: number(dto.satellites),
    batteryPercent: number(dto.battery_percent),
    batteryVoltageV: number(dto.battery_voltage_v),
    flightMode: string(dto.flight_mode),
    armed: typeof armedText === 'boolean'
      ? armedText
      : armedText === 'true'
        ? true
        : armedText === 'false'
          ? false
          : null,
    linkQualityPercent: number(dto.link_quality_percent),
    pass: dto.pass === 'survey' || dto.pass === 'confirmation' ? dto.pass : null,
    achievedFps: null,
    requiredFps: null,
    isUndersampled: null,
  };
}

export function toMissionStatistics(value: unknown, sessionId: string): MissionStatistics | null {
  const dto = record(value);
  if (dto.mission_id !== sessionId) return null;
  const count = (value: unknown) => {
    const result = number(value);
    return result !== null && Number.isInteger(result) && result >= 0 ? result : null;
  };
  const risk = record(dto.risk);
  return {
    sessionId,
    totalRecords: count(dto.total_records),
    confirmed: count(record(dto.layer_1).confirmed),
    unconfirmed: count(record(dto.layer_2).unconfirmed),
    risk: { high: count(risk.high), medium: count(risk.medium), low: count(risk.low) },
  };
}

export function toMissionPreparation(value: unknown, sessionId: string): MissionPreparation | null {
  const dto = record(value);
  const missionId = string(dto.mission_id);
  const status = string(dto.status);
  const indexedChunks = number(dto.indexed_chunks);
  const sourceHash = string(dto.source_hash);
  const generation = string(dto.generation);
  const model = string(dto.model);
  if (
    missionId !== sessionId ||
    status !== 'ready' ||
    indexedChunks === null ||
    !Number.isInteger(indexedChunks) ||
    indexedChunks < 0 ||
    sourceHash === null ||
    generation === null ||
    model === null
  )
    return null;
  return {
    sessionId,
    status: 'ready',
    indexedChunks,
    sourceHash,
    generation,
    model,
    reused: dto.reused === true,
  };
}

export function toMissionAnswer(value: unknown, sessionId: string): AssistantMessage | null {
  const dto = record(value);
  if (dto.mission_id !== undefined && dto.mission_id !== sessionId) return null;
  const text = string(dto.answer);
  if (text === null) return null;
  const sources = Array.isArray(dto.sources)
    ? dto.sources
    : Array.isArray(dto.citations)
      ? dto.citations
      : [];
  if (
    sources.some((value: unknown) => {
      const source = record(value);
      return source.mission_id !== undefined && source.mission_id !== sessionId;
    })
  )
    return null;
  const citations: CitationSource[] = sources.map((value: unknown) => {
    const source = record(value);
    const sourceId = string(source.source_id) ?? string(source.sourceId);
    const sourceType = string(source.source_type) ?? string(source.sourceType);
    return {
      document: string(source.document) ?? sourceType ?? sourceId ?? '',
      section: string(source.section) ?? '',
      snippet: string(source.snippet) ?? string(source.content) ?? string(source.text) ?? '',
      sourceId,
      sourceType,
      sessionId,
      sourceRecordId:
        string(source.record_id) ?? string(source.sourceRecordId) ?? string(source._id),
      similarity: number(source.score) ?? number(source.similarity),
    };
  });
  return {
    id: string(dto.id) ?? `answer-${crypto.randomUUID()}`,
    sender: 'assistant',
    // When the service does not timestamp answers, this is the local receipt time.
    timestamp: time(dto.timestamp) ?? new Date().toISOString(),
    text,
    ...(citations.length > 0 ? { citations } : {}),
  };
}
