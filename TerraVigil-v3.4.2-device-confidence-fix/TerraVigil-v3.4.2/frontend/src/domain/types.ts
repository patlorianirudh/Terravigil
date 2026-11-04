// TerraVigil Canonical Domain Model — Single Source of Truth
// Direct implementation of Master PRD v2.0 §8.2

export type Ulid = string;
export type IsoUtc = string;

export interface Coordinate {
  lat: number; // WGS84 degrees
  lon: number;
  /** Raw altitude whose datum was not supplied. */
  altitudeM?: number | null;
  altAglM?: number | null;
  altAmslM?: number | null;
}

// ── Session ─────────────────────────────────────────────
export type FlightMode = 'rc_manual' | 'ardupilot_auto';
export type SessionState = 'created' | 'active' | 'ended' | 'aborted' | 'unknown';
export type PassKind = 'survey' | 'confirmation';

export interface ScanSession {
  id: Ulid;
  siteName: string; // free text — NOT a drawn polygon
  state: SessionState;
  flightMode: FlightMode | null;
  startedAt: IsoUtc;
  endedAt: IsoUtc | null;
  operatorId: Ulid;
  operatorName?: string | null;
  utmEpsg: number | null; // e.g. 32644
  config: SessionConfig; // frozen at start; changes create a new session
  notes: string;
  /** Explicit server marker for synthetic practice data. */
  isSample?: boolean;
  sampleRoute?: SampleRouteEndpoints;
}

export interface SampleRouteEndpoints {
  start: Coordinate;
  end: Coordinate;
}

export interface SampleMissionLoadResult {
  sessionId: Ulid;
  created: boolean;
  synthetic: true;
  counts: { detections: number; observations: number; telemetry: number };
  suggestedRoute: SampleRouteEndpoints;
}

/**
 * Every field is nullable: these are values the backend reports, and a value
 * the backend did not send must render as "unknown", never as a default that
 * looks like a real configured threshold.
 */
export interface SessionConfig {
  visualConfidenceThreshold: number | null; // T_vis
  metalThresholdNorm: number | null; // T_metal
  nominalAglM: number | null;
  inferenceWidthPx: number | null;
  forwardOverlap: number | null;
  sideOverlap: number | null;
  associationRadiusM: number | null; // r_assoc
  metalMaxStandoffM: number | null;
  visualSwathModel: 'fov' | null; // W = 1.361 * h
  metalSwathM: number | null; // measured
}

// ── Track & Telemetry ───────────────────────────────────
export type GpsFixType = 'no_fix' | 'fix_2d' | 'fix_3d' | 'dgps' | 'rtk_float' | 'rtk_fixed';

export interface TrackPoint {
  sourceRecordId?: string | null;
  sessionId: Ulid;
  tUtc: IsoUtc;
  tMonoNs: number | null;
  position: Coordinate;
  groundSpeedMs: number | null;
  headingDeg: number | null;
  rollDeg: number | null;
  pitchDeg: number | null;
  fixType: GpsFixType | null;
  hdop: number | null;
  satellites: number | null;
  batteryPercent: number | null;
  linkQualityPercent: number | null; // telemetry radio RSSI, reported by the link
  pass: PassKind | null; // derived from altitude band
  achievedFps: number | null;
  requiredFps: number | null;
  isUndersampled: boolean | null;
}

// ── Raw sensor observations (append-only) ───────────────
export interface VisualCandidate {
  id: Ulid;
  sessionId: Ulid;
  tUtc: IsoUtc;
  tMonoNs: number;
  position: Coordinate; // projected bbox centroid on ground
  localizationUncertaintyM: number; // CEP95, §7.6
  confidence: number; // YOLO, [0,1]
  classId: string; // from the model's class catalog
  className?: string;
  bbox: { x: number; y: number; w: number; h: number }; // full-frame px
  frameRef: string; // SD-card path on the Jetson
  thumbnailStatus: 'pending' | 'received' | 'lost';
  fullFrameStatus: 'onboard' | 'reconciled' | 'missing';
  thumbnailUrl?: string;
  fullFrameUrl?: string;
  tileIndex: number;
}

export interface MetalHit {
  id: Ulid;
  sessionId: Ulid;
  tUtc: IsoUtc;
  tMonoNs: number;
  position: Coordinate;
  localizationUncertaintyM: number;
  rawAdc: number; // ADS1115 counts
  baselineAdc: number; // rolling baseline at sample time
  signalNorm: number; // normalized [0,1]
  standoffM: number; // altAglM at sample
  standoffExceeded: boolean; // P-7.17
  coilTempC?: number;
}

// ── Fused detection (the published unit) ────────────────
export type Classification =
  | 'confirmed' // visual ∧ metal  → risk-scored, on risk heatmap
  | 'unconfirmed_visual' // visual only     → separate layer, NOT a mine
  | 'unresolved_metal'; // metal only      → separate layer, NOT a mine

export type RiskBand = 'high' | 'medium' | 'low';
export type ReviewState = 'unreviewed' | 'operator_endorsed' | 'operator_disputed';
export type VlmVerdict = 'agree' | 'uncertain' | 'reject' | 'not_run';

export interface Detection {
  heightProfileId?: number | null;
  normalizedCenter?: { x: number; y: number } | null;
  sourceId?: string | null;
  sourceRecordId?: string | null;
  sourceType?: 'detection' | 'observation' | null;
  sourceStatus?: string | null;
  validationIssue?: string | null;
  metalDetected?: boolean | null;
  /** Sensor channel reported by the drone's Firebase record. */
  deviceType?: 'camera' | 'metal' | null;
  /** Generic drone-reported score in [0,1], independent of sensor modality. */
  confidenceScore?: number | null;
  /** Drone-reported confidence percentage in [0,100]. */
  confidencePercent?: number | null;
  imageRef?: string | null;
  inferenceRunId?: string;
  locationSource?: string | null;
  telemetryTimestamp?: string | null;
  telemetryMatchGapSeconds?: number | null;
  telemetryMatchMethod?: string | null;
  timestampOriginal?: string | null;
  targetLocationKnown?: boolean | null;
  confirmationSource?: string | null;
  id: Ulid;
  sessionId: Ulid;
  classification: Classification;
  position: Coordinate; // cluster centroid
  localizationUncertaintyM: number | null; // CEP95 radius in meters
  firstObservedAt: IsoUtc;
  lastObservedAt: IsoUtc;

  visualCandidateIds: Ulid[]; // may be empty for unresolved_metal
  metalHitIds: Ulid[]; // may be empty for unconfirmed_visual
  corroborationCount: number | null; // independent contributing observations

  bestVisualConfidence: number | null;
  bestMetalSignalNorm: number | null;
  bestMetalStandoffM: number | null; // coil standoff at the strongest metal hit
  classId: string | null;
  className?: string | null;

  // Stored risk is independent of confirmation; absent scores remain unknown.
  riskScore: number | null; // [0,1], §11.3
  riskBand: RiskBand | null;
  riskComputedAt: IsoUtc | null;
  riskInputs: RiskInputs | null; // full audit trail of the computation

  // Advisory, never affects risk (§11.7)
  vlmVerdict: VlmVerdict | null;
  vlmRationale: string | null;
  gradCamRef: string | null;
  gradCamUrl?: string | null;

  // Tier 1 & 2 Imagery
  thumbnailStatus: 'pending' | 'received' | 'lost' | null;
  fullFrameStatus: 'onboard' | 'reconciled' | 'missing' | null;
  thumbnailUrl?: string | null;
  fullFrameUrl?: string | null;

  reviewState: ReviewState | null;
  reviewHistory: ReviewRecord[]; // append-only
}

export interface RiskInputs {
  visualNorm: number;
  metalNorm: number;
  corroborationNorm: number;
  weights: { visual: number; metal: number; corroboration: number };
  thresholds: { visual: number; metal: number };
  overridesApplied: string[]; // e.g. ['strong_metal_floor', 'monotonic_ratchet']
  formulaVersion: string; // 'risk-v1'
}

export interface ReviewRecord {
  reviewState: ReviewState;
  reviewedAt: IsoUtc;
  reviewedBy: Ulid;
  reviewerName?: string;
  note?: string;
}

// ── Coverage ────────────────────────────────────────────
export type CellState = 'unswept' | 'visual_swept' | 'dual_swept';

export interface CoverageCell {
  sessionId: Ulid;
  cellX: number; // UTM grid index
  cellY: number;
  lat: number;
  lon: number;
  state: CellState;
  visualPasses: number;
  metalPasses: number;
  meanGsdMm: number | null;
  degraded: boolean; // undersampled or GPS-degraded, P-7.5
}

export interface CoverageSummary {
  sessionId: Ulid;
  cellSizeM: number | null;
  visualSweptAreaM2: number | null;
  dualSweptAreaM2: number | null; // will be MUCH smaller — §12.2
  degradedAreaM2: number | null;
  trackLengthM: number | null;
  visualSwathM: number | null; // derived swath width at the flown altitude
  // NOTE: there is deliberately no "coveragePercent" or "cleared" field (P-8.1).
}

// ── Safe Path Planner ───────────────────────────────────
export interface SafePathRequest {
  sessionId: Ulid;
  start: Coordinate;
  end: Coordinate;
  minStandoffM?: number; // default 5.0m
  cautionWeight?: number; // [0,1], balances hazard cost vs distance
}

export interface SafePathResult {
  sessionId: Ulid;
  pathFound: boolean;
  waypoints: Coordinate[];
  totalDistanceM: number | null;
  minStandoffAchievedM: number | null;
  confirmedDetectionsNearRoute: number | null;
  unconfirmedDetectionsNearRoute: number | null;
  advisoryCorridorWaypoints?: Coordinate[];
  disclaimer: string;
  failureReason?: string | null;
}

// ── System Health & Alerts ──────────────────────────────
export type SubsystemStatus = 'ok' | 'warning' | 'critical' | 'offline';

export interface SubsystemHealth {
  id: string;
  name: string;
  status: SubsystemStatus;
  details: string;
  lastHeartbeat: IsoUtc;
  metrics?: Record<string, string | number>;
}

export interface SystemEventAlert {
  id: Ulid;
  sessionId?: Ulid;
  tUtc: IsoUtc;
  severity: 'warning' | 'critical' | 'info';
  code:
    | 'UNDERSAMPLED'
    | 'CAMERA_FAULT'
    | 'METAL_SENSOR_OFFLINE'
    | 'TIME_SYNC_DEGRADED'
    | 'LINK_LOST'
    | 'LOW_BATTERY'
    | 'METAL_BASELINE_UNSTABLE'
    | 'GPS_DEGRADED';
  message: string;
  acknowledged?: boolean;
}

// ── Detection Class Catalog ─────────────────────────────
export interface DetectionClass {
  id: string;
  name: string;
  description: string;
  category: 'ordnance_ap' | 'ordnance_at' | 'uxo' | 'debris' | 'marker';
  nominalDiameterMm?: number;
}

// ── Reports ─────────────────────────────────────────────
export type ReportStatus = 'generating' | 'ready' | 'failed';

export interface ReportItem {
  id: Ulid;
  reportNumber: number;
  sessionId: Ulid;
  siteName: string;
  generatedAt: IsoUtc;
  status: ReportStatus;
  formulaVersion: string;
  contentHash: string;
  downloadUrl?: string;
  csvDownloadUrl?: string;
  generationMode?: 'factual' | 'rag';
  narrative?: string | null;
  narrativeError?: string | null;
  sources?: CitationSource[];
  narrativeSources?: NarrativeCitationSource[];
  hardware?: {
    edgeComputer?: string;
    aircraft?: string;
    flightController?: string;
    groundStation?: string;
  };
  recordCounts?: {
    firebaseEvents?: number | null;
    firebaseMatched?: number | null;
    firebasePending?: number | null;
    firebaseInvalid?: number | null;
    firebaseRemoved?: number | null;
    imageInferenceRuns: number | null;
    imagePredictions: number | null;
    unlocalizedImagePredictions: number | null;
  };
  synthetic?: boolean;
  summary: {
    confirmedMinesCount: number | null;
    highRiskCount: number | null;
    mediumRiskCount: number | null;
    lowRiskCount: number | null;
    unconfirmedVisualCount: number | null;
    unresolvedMetalCount: number | null;
    visualSweptAreaM2: number | null;
    dualSweptAreaM2: number | null;
  };
}

// ── Assistant & Voice ───────────────────────────────────
export interface CitationSource {
  sha256?: string;
  sessionId?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  sourceRecordId?: string | null;
  similarity?: number | null;
  document: string;
  section: string;
  page?: number;
  version?: string;
  snippet: string;
}

export interface NarrativeCitationSource extends CitationSource {
  citationNumber: number;
}

export interface AssistantMessage {
  id: Ulid;
  sender: 'user' | 'assistant';
  timestamp: IsoUtc;
  text: string;
  citations?: CitationSource[];
  sqlQuery?: string;
  isVoiceInput?: boolean;
  refused?: boolean;
  refusalReason?: string;
}

// ── Auth & User ─────────────────────────────────────────
export type UserRole = 'admin' | 'operator' | 'analyst';

export interface AuthUser {
  id: Ulid;
  email: string;
  name: string;
  role: UserRole;
  callsign?: string;
}

/** Counts from the mission statistics endpoint, across both evidence collections. */
export interface MissionStatistics {
  sessionId: string;
  totalRecords: number | null;
  confirmed: number | null;
  unconfirmed: number | null;
  risk: Record<RiskBand, number | null>;
}

/** Result returned after the backend publishes a complete mission RAG index. */
export interface MissionPreparation {
  sessionId: string;
  status: 'ready';
  indexedChunks: number;
  sourceHash: string;
  generation: string;
  model: string;
  reused: boolean;
}

export interface InferenceModel {
  name: string;
  sha256: string | null;
  task?: string;
  device?: string;
  classes: { id: number; name: string }[];
}

export interface InferenceStatus {
  ready: boolean;
  status: 'ready' | 'unavailable' | 'busy';
  model: InferenceModel;
  runtime: Record<string, string>;
  limits: {
    maxImageBytes: number;
    maxImagePixels: number;
    minConfidence: number;
    maxConfidence: number;
  };
  error?: { code: string; message: string };
}

export interface InferenceRequest {
  imageBase64: string;
  filename: string;
  missionId?: string;
  confidence?: number;
  latitude?: number;
  longitude?: number;
}

export interface InferencePrediction {
  classId: number;
  className: string;
  confidence: number;
  bbox: [number, number, number, number];
  normalizedCenter: { x: number; y: number };
}

export interface InferenceResult {
  runId: string;
  missionId: string;
  model: InferenceModel;
  predictions: InferencePrediction[];
  imageUrl: string;
  annotatedImageUrl: string;
  image: { width: number; height: number };
  persistedObservations: number;
}
