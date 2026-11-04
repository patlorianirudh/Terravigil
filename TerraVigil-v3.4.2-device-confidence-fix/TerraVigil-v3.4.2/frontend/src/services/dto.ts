/**
 * Wire DTOs — the shapes the backend actually sends.
 *
 * Per PRD P-20.24, this file and `mappers.ts` are the ONLY places that know
 * the backend's field names. If the backend renames a field, nothing outside
 * these two modules changes. Every field is optional here on purpose: the wire
 * is untrusted, and `mappers.ts` decides what a missing field means (which is
 * always `null` — never an invented default).
 */

export interface CoordinateDto {
  lat?: number;
  lon?: number;
  altAglM?: number | null;
  altAmslM?: number | null;
}

export interface SessionConfigDto {
  visualConfidenceThreshold?: number;
  metalThresholdNorm?: number;
  nominalAglM?: number;
  inferenceWidthPx?: number;
  forwardOverlap?: number;
  sideOverlap?: number;
  associationRadiusM?: number;
  metalMaxStandoffM?: number;
  visualSwathModel?: string;
  metalSwathM?: number;
}

export interface ScanSessionDto {
  id?: string;
  siteName?: string;
  state?: string;
  flightMode?: string;
  startedAt?: string;
  endedAt?: string | null;
  operatorId?: string;
  operatorName?: string | null;
  utmEpsg?: number;
  notes?: string | null;
  config?: SessionConfigDto;
}

export interface TrackPointDto {
  sessionId?: string;
  tUtc?: string;
  tMonoNs?: number;
  position?: CoordinateDto;
  groundSpeedMs?: number;
  headingDeg?: number;
  rollDeg?: number;
  pitchDeg?: number;
  fixType?: string;
  hdop?: number;
  satellites?: number;
  batteryPercent?: number;
  linkQualityPercent?: number | null;
  pass?: string;
  achievedFps?: number | null;
  requiredFps?: number | null;
  isUndersampled?: boolean;
}

export interface RiskInputsDto {
  visualNorm?: number;
  metalNorm?: number;
  corroborationNorm?: number;
  weights?: { visual?: number; metal?: number; corroboration?: number };
  thresholds?: { visual?: number; metal?: number };
  overridesApplied?: string[];
  formulaVersion?: string;
}

export interface ReviewRecordDto {
  reviewState?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewerName?: string | null;
  note?: string | null;
}

export interface DetectionDto {
  id?: string;
  sessionId?: string;
  classification?: string;
  position?: CoordinateDto;
  localizationUncertaintyM?: number | null;
  firstObservedAt?: string;
  lastObservedAt?: string;
  visualCandidateIds?: string[];
  metalHitIds?: string[];
  corroborationCount?: number;
  bestVisualConfidence?: number | null;
  bestMetalSignalNorm?: number | null;
  bestMetalStandoffM?: number | null;
  classId?: string | null;
  className?: string | null;
  deviceType?: 'camera' | 'metal' | null;
  confidenceScore?: number | null;
  confidencePercent?: number | null;
  riskScore?: number | null;
  riskBand?: string | null;
  riskComputedAt?: string | null;
  riskInputs?: RiskInputsDto | null;
  vlmVerdict?: string;
  vlmRationale?: string | null;
  gradCamRef?: string | null;
  gradCamUrl?: string | null;
  thumbnailStatus?: string;
  fullFrameStatus?: string;
  thumbnailUrl?: string | null;
  fullFrameUrl?: string | null;
  reviewState?: string;
  reviewHistory?: ReviewRecordDto[];
}

export interface CoverageSummaryDto {
  sessionId?: string;
  cellSizeM?: number;
  visualSweptAreaM2?: number | null;
  dualSweptAreaM2?: number | null;
  degradedAreaM2?: number | null;
  trackLengthM?: number | null;
  visualSwathM?: number | null;
}

export interface SafePathResultDto {
  sessionId?: string;
  pathFound?: boolean;
  waypoints?: CoordinateDto[];
  totalDistanceM?: number | null;
  minStandoffAchievedM?: number | null;
  confirmedDetectionsNearRoute?: number | null;
  unconfirmedDetectionsNearRoute?: number | null;
  advisoryCorridorWaypoints?: CoordinateDto[];
  disclaimer?: string;
  failureReason?: string | null;
}

export interface SubsystemHealthDto {
  id?: string;
  name?: string;
  status?: string;
  details?: string;
  lastHeartbeat?: string;
  metrics?: Record<string, string | number>;
}

export interface SystemEventAlertDto {
  id?: string;
  sessionId?: string | null;
  tUtc?: string;
  severity?: string;
  code?: string;
  message?: string;
  acknowledged?: boolean;
}

export interface DetectionClassDto {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  nominalDiameterMm?: number | null;
}

export interface ReportItemDto {
  id?: string;
  reportNumber?: number;
  sessionId?: string;
  siteName?: string;
  generatedAt?: string;
  status?: string;
  formulaVersion?: string;
  contentHash?: string;
  downloadUrl?: string | null;
  csvDownloadUrl?: string | null;
  generationMode?: string;
  narrative?: string | null;
  narrativeError?: string | null;
  sources?: CitationSourceDto[];
  narrativeSources?: NarrativeCitationSourceDto[];
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
    imageInferenceRuns?: number | null;
    imagePredictions?: number | null;
    unlocalizedImagePredictions?: number | null;
  };
  synthetic?: boolean;
  summary?: {
    confirmedMinesCount?: number;
    highRiskCount?: number;
    mediumRiskCount?: number;
    lowRiskCount?: number;
    unconfirmedVisualCount?: number;
    unresolvedMetalCount?: number;
    visualSweptAreaM2?: number;
    dualSweptAreaM2?: number;
  };
}

export interface CitationSourceDto {
  sessionId?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  sourceRecordId?: string | null;
  similarity?: number | null;
  sha256?: string;
  document?: string;
  section?: string;
  page?: number | null;
  version?: string | null;
  snippet?: string;
}

export interface NarrativeCitationSourceDto extends CitationSourceDto {
  citationNumber?: number;
}

export interface AssistantMessageDto {
  id?: string;
  sender?: string;
  timestamp?: string;
  text?: string;
  citations?: CitationSourceDto[];
  sqlQuery?: string | null;
  isVoiceInput?: boolean;
  refused?: boolean;
  refusalReason?: string | null;
}

export interface AuthUserDto {
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  callsign?: string | null;
}

export interface LoginResponseDto {
  token?: string;
  user?: AuthUserDto;
}
