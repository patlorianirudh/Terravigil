import { config as appConfig } from '../config';
import { detectionClassLabel, detectionDeviceLabel, detectionLabel, sensorConfidenceLabel } from '../lib/classification';
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Check,
  CheckCheck,
  Cpu,
  Crosshair,
  Layers,
  MapPin,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { RiskBadge } from '../components/ui/RiskBadge';
import { ClassificationBadge } from '../components/ui/ClassificationBadge';
import { ConfidenceLedger } from '../components/ui/ConfidenceLedger';
import { KeyValueRow } from '../components/ui/KeyValueRow';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useDetection, useDetectionReview } from '../hooks/useDetections';
import { useSession } from '../hooks/useSessions';
import { computeRisk } from '../domain/risk';
import {
  ABSENT,
  fmtCount,
  fmtDateTime,
  fmtLatLon,
  fmtNum,
  fmtScore,
  fmtUncertainty,
} from '../lib/formatters';
import type { Detection, ReviewState } from '../domain/types';
import '../styles/evidence.css';

const REVIEW_LABEL: Record<ReviewState, string> = {
  unreviewed: 'Needs review',
  operator_endorsed: 'Endorsed',
  operator_disputed: 'Disputed',
};
const VLM_LABEL: Record<string, string> = {
  agree: 'Agrees with observation',
  uncertain: 'Uncertain',
  reject: 'Disagrees with observation',
  not_run: 'Not run',
};

/** Reproduce the deterministic score from the exact inputs returned by the service. */
function auditRisk(detection: Detection): { expected: number; matches: boolean } | null {
  const inputs = detection.riskInputs;
  if (
    detection.classification !== 'confirmed' ||
    inputs === null ||
    detection.riskScore === null ||
    detection.bestVisualConfidence === null ||
    detection.bestMetalSignalNorm === null ||
    detection.corroborationCount === null
  )
    return null;
  const { riskScore: expected } = computeRisk({
    bestVisualConfidence: detection.bestVisualConfidence,
    bestMetalSignalNorm: detection.bestMetalSignalNorm,
    corroborationCount: detection.corroborationCount,
    tVis: inputs.thresholds.visual,
    tMetal: inputs.thresholds.metal,
  });
  return { expected, matches: Math.abs(expected - detection.riskScore) <= 0.001 };
}

export const DetectionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { data: detection, isPending, isError, refetch } = useDetection(id);
  const { submitReview, isSubmittingReview } = useDetectionReview();
  const { data: session } = useSession(detection?.sessionId);
  const [overlayOpacity, setOverlayOpacity] = useState(60);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [frame, setFrame] = useState<'thumbnail' | 'full'>('thumbnail');
  const [note, setNote] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  if (isPending)
    return (
      <div className="ev-page">
        <Skeleton className="h-16 w-96" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (isError || !detection)
    return (
      <div className="ev-page">
        <Link to="/detections" className="ev-back">
          <ArrowLeft size={16} />
          Detection register
        </Link>
        <EmptyState
          title="Detection not found"
          description="This record could not be read. It may belong to a session that is no longer available."
        />
      </div>
    );
  const handleReview = async (state: ReviewState): Promise<void> => {
    setReviewError(null);
    setReviewNotice(null);
    try {
      await submitReview({
        id: detection.id,
        state,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNote('');
      await refetch();
      setReviewNotice(`${REVIEW_LABEL[state]} — review added to the record.`);
    } catch (cause) {
      setReviewError(
        cause instanceof Error
          ? cause.message
          : 'The review could not be saved. Your note has been retained.',
      );
    }
  };
  const reviewUnavailable = appConfig.dataMode === 'live' && appConfig.backendStyle === 'missions';
  const audit = auditRisk(detection);
  const config = session?.config;
  const suppliedImageUrl = frame === 'full' ? detection.fullFrameUrl : detection.thumbnailUrl;
  const imageUrl = suppliedImageUrl === failedImage ? null : suppliedImageUrl;
  const isInference = Boolean(detection.inferenceRunId);
  const isFirebase = detection.locationSource === 'aircraft_gps_at_capture';
  return (
    <div className="ev-page">
      <Link
        to={`/detections?mission=${encodeURIComponent(detection.sessionId)}`}
        className="ev-back"
      >
        <ArrowLeft size={16} />
        Detection register
      </Link>
      <header className="ev-detail-header">
        <div>
          <span className="ev-kicker">Observation / {detectionLabel(detection)}</span>
          <h1>{detectionClassLabel(detection)}</h1>
          <p>
            First observed {fmtDateTime(detection.firstObservedAt)} <span aria-hidden>·</span>{' '}
            {session?.siteName ?? detection.sessionId}
            {detectionDeviceLabel(detection) && <> · Source: {detectionDeviceLabel(detection)}</>}
          </p>
          {sensorConfidenceLabel(detection) && (
            <p className="ev-cell-sub">{sensorConfidenceLabel(detection)}</p>
          )}
        </div>
        <div className="ev-detail-badges">
          <ClassificationBadge
            classification={detection.classification}
            validationIssue={detection.validationIssue ?? null}
          />
          <RiskBadge band={detection.riskBand} score={detection.riskScore} />
        </div>
      </header>
      {detection.validationIssue && (
        <p role="alert" className="ev-error">
          {detection.validationIssue} Stored status:{' '}
          {detection.sourceStatus ?? detection.classification}.
        </p>
      )}
      {detection.locationSource === 'user_supplied_image_location' && (
        <p className="ev-notice">
          Image location supplied by the operator. Exact target location is not measured. This
          visual prediction is unconfirmed; no metal sensor evidence was recorded.
        </p>
      )}
      {isFirebase && (
        <section className="ev-notice">
          <strong>Aircraft GPS matched to image capture time</strong>
          <p>
            The map shows the drone position. The detected object’s exact ground position has not
            been measured.
          </p>
          <p>
            Capture: {detection.firstObservedAt} · GPS:{' '}
            {detection.telemetryTimestamp ?? 'Unreported'} · Gap:{' '}
            {detection.telemetryMatchGapSeconds?.toFixed(3) ?? 'Unknown'} s · Method:{' '}
            {detection.telemetryMatchMethod ?? 'Unknown'}
          </p>
          <Link
            to={`/risk-map?mission=${encodeURIComponent(detection.sessionId)}&detection=${encodeURIComponent(detection.id)}`}
          >
            View this capture on map →
          </Link>
        </section>
      )}
      <div className="ev-detail-grid">
        <div className="ev-detail-column">
          <section className="ev-register">
            <div className="ev-register-heading">
              <div>
                <span className="ev-kicker">01 / Visual evidence</span>
                <h2>{isInference ? 'Uploaded image' : 'Captured observation'}</h2>
              </div>
              <div className="ev-frame-toggle" aria-label="Image source">
                <button
                  aria-pressed={frame === 'thumbnail'}
                  onClick={() => {
                    setFrame('thumbnail');
                  }}
                >
                  {isInference || isFirebase ? 'Image preview' : 'Radio frame'}
                </button>
                <button
                  aria-pressed={frame === 'full'}
                  onClick={() => {
                    setFrame('full');
                  }}
                >
                  Full resolution
                </button>
              </div>
            </div>
            <div className="ev-evidence-frame">
              {imageUrl ? (
                <>
                  <img
                    src={imageUrl}
                    onError={() => {
                      setFailedImage(imageUrl);
                    }}
                    alt={
                      isInference
                        ? `Uploaded image for ${detection.className ?? detection.id}`
                        : `Captured ${frame === 'full' ? 'full-resolution' : 'radio thumbnail'} frame for ${detection.className ?? detection.id}`
                    }
                  />
                  {detection.gradCamUrl && (
                    <img
                      src={detection.gradCamUrl}
                      alt=""
                      aria-hidden
                      className="ev-heatmap"
                      style={{ opacity: overlayOpacity / 100 }}
                    />
                  )}
                </>
              ) : (
                <div className="ev-image-unavailable">
                  <Camera size={34} strokeWidth={1.25} />
                  <h3>
                    {isFirebase
                      ? 'Camera image not available on this computer'
                      : isInference
                        ? 'Uploaded image unavailable'
                        : frame === 'full'
                          ? 'Full frame not available'
                          : 'No radio frame received'}
                  </h3>
                  <p>
                    {frame === 'full'
                      ? `Full-resolution status: ${detection.fullFrameStatus ?? 'unreported'}.`
                      : `Thumbnail status: ${detection.thumbnailStatus ?? 'unreported'}.`}
                  </p>
                  {detection.imageRef && <p>Stored image reference: {detection.imageRef}</p>}
                  {isFirebase && (
                    <p>
                      Copy the image file into the app’s images folder, then retry. A Firebase
                      filename does not transfer the photo.
                    </p>
                  )}
                  {failedImage && (
                    <button
                      onClick={() => {
                        setFailedImage(null);
                      }}
                    >
                      Retry image
                    </button>
                  )}
                  <span>Sensor readings remain available below.</span>
                </div>
              )}
              <span className="ev-frame-label">
                <Camera size={13} />
                {isFirebase
                  ? 'FIREBASE CAPTURE IMAGE'
                  : isInference
                    ? 'UPLOADED SOURCE IMAGE'
                    : frame === 'full'
                      ? 'FULL RESOLUTION'
                      : 'TIER 01 / RADIO THUMBNAIL'}
              </span>
              {imageUrl && (
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ev-frame-open"
                  aria-label="Open captured image"
                >
                  <ArrowUpRight size={17} />
                </a>
              )}
            </div>
            <div className="ev-overlay-control">
              <label htmlFor="cam-opacity">
                <Layers size={16} />
                Grad-CAM explanation
              </label>
              <div>
                <input
                  id="cam-opacity"
                  aria-label="Grad-CAM overlay opacity"
                  type="range"
                  min={0}
                  max={100}
                  value={overlayOpacity}
                  disabled={!detection.gradCamUrl || !imageUrl}
                  onChange={(event) => {
                    setOverlayOpacity(Number(event.target.value));
                  }}
                  className="field-range"
                />
                <span className="ev-mono">
                  {detection.gradCamUrl && imageUrl ? `${overlayOpacity}%` : ABSENT}
                </span>
              </div>
            </div>
            <div className="ev-imagery-status">
              <span>
                Thumbnail <strong>{detection.thumbnailStatus ?? 'Unreported'}</strong>
              </span>
              <span>
                Full frame <strong>{detection.fullFrameStatus ?? 'Unreported'}</strong>
              </span>
            </div>
          </section>
          <section className="ev-register">
            <div className="ev-register-heading">
              <div>
                <span className="ev-kicker">02 / Dual-sensor fusion</span>
                <h2>The confidence ledger</h2>
              </div>
              <Crosshair size={20} className="text-accent" />
            </div>
            <div className="ev-sensor-body">
              <ConfidenceLedger
                visualConfidence={detection.bestVisualConfidence}
                metalSignalNorm={detection.bestMetalSignalNorm}
                visualThreshold={config?.visualConfidenceThreshold ?? null}
                metalThreshold={config?.metalThresholdNorm ?? null}
                corroborationCount={detection.corroborationCount}
                className="ev-large-ledger"
              />
              <p className="ev-ledger-description">
                White markers show reported session thresholds. Missing readings and thresholds
                remain unknown.
              </p>
              <dl className="ev-detail-facts">
                <KeyValueRow label="Model class" value={detectionClassLabel(detection)} />
                <KeyValueRow label="Sensor device" value={detectionDeviceLabel(detection) ?? ABSENT} />
                <KeyValueRow label="Drone confidence score" value={detection.confidenceScore == null ? ABSENT : detection.confidenceScore.toFixed(4)} />
                <KeyValueRow label="Drone confidence percentage" value={detection.confidencePercent == null ? ABSENT : `${detection.confidencePercent.toFixed(2)}%`} />
                <KeyValueRow
                  label="Height profile"
                  value={
                    detection.heightProfileId == null
                      ? ABSENT
                      : `Profile ${String(detection.heightProfileId)}`
                  }
                />
                <KeyValueRow
                  label="Normalized target center"
                  value={
                    detection.normalizedCenter == null
                      ? ABSENT
                      : `${detection.normalizedCenter.x.toFixed(2)}, ${detection.normalizedCenter.y.toFixed(2)}`
                  }
                />
                <KeyValueRow
                  label="Metal detected"
                  value={
                    detection.metalDetected == null
                      ? ABSENT
                      : detection.metalDetected
                        ? 'Yes'
                        : 'No'
                  }
                />
              </dl>
              <div className="ev-sensor-metrics">
                <div>
                  <span>Coil standoff</span>
                  <strong>{fmtNum(detection.bestMetalStandoffM, 3, 'm')}</strong>
                  <small>Limit {fmtNum(config?.metalMaxStandoffM, 2, 'm')}</small>
                </div>
                <div>
                  <span>Visual candidates</span>
                  <strong>
                    {fmtCount(detection.sourceType ? null : detection.visualCandidateIds.length)}
                  </strong>
                  <small>Contributing records</small>
                </div>
                <div>
                  <span>Metal hits</span>
                  <strong>
                    {fmtCount(detection.sourceType ? null : detection.metalHitIds.length)}
                  </strong>
                  <small>Contributing records</small>
                </div>
              </div>
            </div>
          </section>
          <Panel
            title="Advisory model assessment"
            headerRight={<Cpu size={18} className="text-accent" />}
          >
            <div className="ev-advisory">
              <span className="ev-status-pill">
                {detection.vlmVerdict === null
                  ? 'Unreported'
                  : (VLM_LABEL[detection.vlmVerdict] ?? detection.vlmVerdict)}
              </span>
              <p>
                {detection.vlmRationale ??
                  'No model rationale has been returned for this observation.'}
              </p>
              <small>
                Advisory only. This assessment does not alter the deterministic risk score.
              </small>
            </div>
          </Panel>
        </div>
        <div className="ev-detail-column">
          <section className="ev-register">
            <div className="ev-register-heading">
              <div>
                <span className="ev-kicker">03 / Evidence strength</span>
                <h2>Risk computation</h2>
              </div>
              <ShieldCheck size={20} className="text-accent" />
            </div>
            <div className="ev-risk-body">
              <>
                <div className="ev-risk-score">
                  <strong>{fmtScore(detection.riskScore)}</strong>
                  <div>
                    <RiskBadge band={detection.riskBand} />
                    <span>
                      {detection.riskScore === null
                        ? 'Numeric score not reported'
                        : 'Reported evidence score'}
                    </span>
                  </div>
                </div>
                <dl className="ev-detail-facts">
                  <KeyValueRow
                    label="Formula"
                    value={detection.riskInputs?.formulaVersion ?? ABSENT}
                    mono
                  />
                  <KeyValueRow
                    label="Computed at"
                    value={fmtDateTime(detection.riskComputedAt)}
                    mono
                  />
                </dl>
                {detection.riskInputs ? (
                  <div className="ev-risk-formula">
                    <p className="ev-kicker">Reproducible calculation</p>
                    <p>
                      {fmtScore(detection.riskInputs.weights.visual)} × visual(
                      {fmtScore(detection.riskInputs.visualNorm)})<br />+{' '}
                      {fmtScore(detection.riskInputs.weights.metal)} × metal(
                      {fmtScore(detection.riskInputs.metalNorm)})<br />+{' '}
                      {fmtScore(detection.riskInputs.weights.corroboration)} × corroboration(
                      {fmtScore(detection.riskInputs.corroborationNorm)})
                    </p>
                    <small>
                      Thresholds · visual {fmtScore(detection.riskInputs.thresholds.visual)} / metal{' '}
                      {fmtScore(detection.riskInputs.thresholds.metal)}
                    </small>
                    {detection.riskInputs.overridesApplied.length > 0 && (
                      <p className="text-warning">
                        Overrides: {detection.riskInputs.overridesApplied.join(', ')}
                      </p>
                    )}
                    {audit && (
                      <div
                        className={`ev-audit-result ${audit.matches ? 'text-ok' : 'text-critical'}`}
                      >
                        {audit.matches ? (
                          <>
                            <CheckCheck size={16} />
                            Independently verified
                          </>
                        ) : (
                          `Audit mismatch. Recomputed score: ${fmtScore(audit.expected)}.`
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="ev-error">
                    The service did not return the calculation inputs. This score cannot be
                    independently audited here.
                  </p>
                )}
              </>
            </div>
          </section>
          <Panel
            title={
              detection.targetLocationKnown === false
                ? 'Image location (target not localized)'
                : 'Position & uncertainty'
            }
            headerRight={<MapPin size={18} className="text-accent" />}
          >
            <div className="ev-position">
              <span className="ev-mono">
                {fmtLatLon(detection.position.lat, detection.position.lon)}
              </span>
              {detection.targetLocationKnown !== false && (
                <strong>
                  {fmtUncertainty(detection.localizationUncertaintyM)} <span>CEP95 radius</span>
                </strong>
              )}
              <p>
                {detection.targetLocationKnown === false
                  ? 'These coordinates locate the source image. The target location and its uncertainty have not been measured.'
                  : detection.localizationUncertaintyM === null
                    ? 'Localization uncertainty was not reported.'
                    : 'The reported centroid carries a 95% localization uncertainty radius.'}
              </p>
              {detection.confirmationSource && <p>{detection.confirmationSource}</p>}
              <dl className="ev-detail-facts">
                <KeyValueRow
                  label="Last observed"
                  value={fmtDateTime(detection.lastObservedAt)}
                  mono
                />
                <KeyValueRow label="Session" value={detection.sessionId} mono />
                <KeyValueRow
                  label="Source collection"
                  value={detection.sourceType ?? ABSENT}
                  mono
                />
                <KeyValueRow label="Source ID" value={detection.sourceId ?? ABSENT} mono />
                <KeyValueRow label="Mongo record" value={detection.sourceRecordId ?? ABSENT} mono />
                <KeyValueRow
                  label="Raw altitude (datum unreported)"
                  value={fmtNum(detection.position.altitudeM, 1, 'm')}
                  mono
                />
              </dl>
            </div>
          </Panel>
          <section className="ev-register">
            <div className="ev-register-heading">
              <div>
                <span className="ev-kicker">04 / Human assessment</span>
                <h2>Operator review</h2>
              </div>
              <span className={`ev-review-state ${detection.reviewState}`}>
                <i />
                {detection.reviewState === null
                  ? 'Unavailable'
                  : REVIEW_LABEL[detection.reviewState]}
              </span>
            </div>
            <div className="ev-review-body">
              <label htmlFor="review-note">Add your assessment</label>
              <textarea
                id="review-note"
                disabled={reviewUnavailable}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                placeholder="What supports or challenges this observation?"
                rows={3}
                className="field"
              />
              <div className="ev-review-actions">
                <Button
                  variant="primary"
                  disabled={isSubmittingReview || reviewUnavailable}
                  icon={<Check size={16} />}
                  onClick={() => {
                    void handleReview('operator_endorsed');
                  }}
                >
                  Endorse record
                </Button>
                <Button
                  variant="danger"
                  disabled={isSubmittingReview || reviewUnavailable}
                  icon={<X size={16} />}
                  onClick={() => {
                    void handleReview('operator_disputed');
                  }}
                >
                  Dispute
                </Button>
              </div>
              {reviewError && (
                <p role="alert" className="ev-error">
                  {reviewError}
                </p>
              )}
              {reviewNotice && (
                <p role="status" className="ev-notice">
                  {reviewNotice}
                </p>
              )}
              {reviewUnavailable && (
                <p className="ev-form-help">
                  Evidence review is not available in this mission backend.
                </p>
              )}
              <p className="ev-form-help">
                Reviews append to the audit history. They do not change sensor classification or
                risk.
              </p>
              {detection.reviewHistory.length > 0 && (
                <div className="ev-review-history">
                  <span className="ev-kicker">Review history</span>
                  <ul>
                    {[...detection.reviewHistory].reverse().map((record, index) => (
                      <li key={`${record.reviewedAt}-${index}`}>
                        <span className="ev-timeline-dot" />
                        <div>
                          <strong>{REVIEW_LABEL[record.reviewState]}</strong>
                          <span>
                            by {record.reviewerName ?? record.reviewedBy} ·{' '}
                            {fmtDateTime(record.reviewedAt)}
                          </span>
                          {record.note && <p>{record.note}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
