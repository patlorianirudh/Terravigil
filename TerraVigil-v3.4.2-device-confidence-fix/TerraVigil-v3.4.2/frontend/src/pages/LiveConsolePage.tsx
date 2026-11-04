import { detectionClassLabel, detectionDeviceLabel, detectionLabel, sensorConfidenceLabel } from '../lib/classification';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Radio, TriangleAlert } from 'lucide-react';
import { TacticalMap } from '../components/map/TacticalMap';
import { ConfidenceLedger } from '../components/ui/ConfidenceLedger';
import { RiskBadge } from '../components/ui/RiskBadge';
import { ClassificationBadge } from '../components/ui/ClassificationBadge';
import { SweepRibbon } from '../components/ui/SweepRibbon';
import { SweptNotClearedBanner } from '../components/ui/AlertNotice';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useDetections } from '../hooks/useDetections';
import { useLiveTelemetry } from '../hooks/useLiveTelemetry';
import { useCoverage } from '../hooks/useCoverage';
import { useTrack } from '../hooks/useTrack';
import { useSessionStore } from '../state/sessionStore';
import { ABSENT, fmtArea, fmtNum, fmtPercent, fmtTime, fmtUncertainty } from '../lib/formatters';
import type { Detection } from '../domain/types';

const FIX_LABEL: Record<string, string> = {
  no_fix: 'No fix',
  fix_2d: '2D fix',
  fix_3d: '3D fix',
  dgps: 'DGPS',
  rtk_float: 'RTK float',
  rtk_fixed: 'RTK fixed',
};
export const LiveConsolePage: React.FC = () => {
  const navigate = useNavigate();
  const activeSession = useSessionStore((s) => s.activeSession);
  const { detections: receivedDetections, isError, refetch } = useDetections(activeSession?.id);
  const detections = receivedDetections.filter((d) => d.sessionId === activeSession?.id);
  const stream = useLiveTelemetry();
  const { data: recordedTrack = [], isError: trackError } = useTrack(activeSession?.id);
  const sessionTrack = stream.trackHistory.filter((point) => point.sessionId === activeSession?.id);
  const trackHistory = sessionTrack.length > 0 ? sessionTrack : recordedTrack;
  const t =
    stream.latestTelemetry?.sessionId === activeSession?.id
      ? stream.latestTelemetry
      : (trackHistory.at(-1) ?? null);
  const archived = activeSession?.state === 'ended' || activeSession?.state === 'aborted';
  const { data: coverage } = useCoverage(activeSession?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedFilter, setFeedFilter] = useState<'all' | 'confirmed' | 'unconfirmed'>('all');
  const config = activeSession?.config;
  const confirmed = detections.filter((d) => d.classification === 'confirmed');
  const unconfirmed = detections.filter((d) => d.classification !== 'confirmed');
  const visible =
    feedFilter === 'all' ? detections : feedFilter === 'confirmed' ? confirmed : unconfirmed;
  const fpsHealthy =
    t?.achievedFps != null && t.requiredFps != null ? t.achievedFps >= t.requiredFps * 1.5 : null;
  const gnssHealthy =
    t?.fixType === 'fix_3d' ||
    t?.fixType === 'dgps' ||
    t?.fixType === 'rtk_fixed' ||
    t?.fixType === 'rtk_float';
  return (
    <div className="field-workspace live-workspace">
      <header className="field-page-header">
        <div>
          <p className="type-eyebrow">FIELD OPERATIONS / {archived ? 'RECORDED' : 'LIVE'}</p>
          <h1>
            {archived ? 'Session console' : 'Live console'}
            <span className="live-heading-status">
              <Radio size={13} />
              {archived
                ? 'RECORDED SESSION'
                : activeSession?.state === 'active'
                  ? 'SESSION ACTIVE'
                  : 'STANDBY'}
            </span>
          </h1>
          <p className="field-page-subtitle">
            {activeSession?.siteName ?? 'Select a scan session to begin monitoring.'}{' '}
            {activeSession && (
              <span>
                ·{' '}
                {activeSession.flightMode === null
                  ? 'Flight mode unreported'
                  : activeSession.flightMode === 'rc_manual'
                    ? 'RC manual'
                    : 'ArduPilot auto'}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowUpRight size={14} />}
          onClick={() => {
            navigate('/detections');
          }}
        >
          Detection register
        </Button>
      </header>
      <section className="telemetry-bar" aria-label="Flight and sensor telemetry">
        <Telemetry
          label={t?.position.altAglM != null ? 'Altitude AGL' : 'Recorded altitude'}
          value={fmtNum(t?.position.altAglM ?? t?.position.altitudeM, 1)}
          unit="m"
          detail={
            t?.position.altAglM != null
              ? `Nominal ${fmtNum(config?.nominalAglM, 1, 'm')}`
              : 'Datum unreported'
          }
        />
        <Telemetry
          label="Ground speed"
          value={fmtNum(t?.groundSpeedMs, 1)}
          unit="m/s"
          detail={`Heading ${fmtNum(t?.headingDeg, 0, '°')}`}
        />
        <Telemetry
          label="GNSS position"
          value={t?.fixType ? (FIX_LABEL[t.fixType] ?? t.fixType) : ABSENT}
          detail={`HDOP ${fmtNum(t?.hdop, 1)} · ${fmtNum(t?.satellites, 0)} satellites`}
          tone={t?.fixType == null ? '' : gnssHealthy ? 'ok' : 'warning'}
        />
        <Telemetry
          label="Inference rate"
          value={fmtNum(t?.achievedFps, 1)}
          unit="fps"
          detail={`${fmtNum(t?.requiredFps, 1)} req · ${fpsHealthy === null ? 'awaiting data' : fpsHealthy ? 'sampling adequate' : 'undersampled'}`}
          tone={fpsHealthy === null ? '' : fpsHealthy ? 'ok' : 'critical'}
          status={fpsHealthy}
        />
        <Telemetry
          label="Power / radio"
          value={fmtPercent(t?.batteryPercent)}
          detail={`Link ${fmtPercent(t?.linkQualityPercent)}`}
          tone={t?.batteryPercent != null && t.batteryPercent < 25 ? 'critical' : ''}
        />
        <Telemetry
          label="Current pass"
          value={t?.pass === 'survey' ? 'Survey' : t?.pass === 'confirmation' ? 'Confirm' : ABSENT}
          detail={`Roll ${fmtNum(t?.rollDeg, 1, '°')} · pitch ${fmtNum(t?.pitchDeg, 1, '°')}`}
        />
      </section>
      {trackError && (
        <p role="alert">
          Recorded telemetry could not be refreshed. Any displayed samples are from the last
          successful read.
        </p>
      )}
      <div className="live-main-grid">
        <div className="live-map-wrap">
          <TacticalMap
            key={activeSession?.id ?? 'none'}
            title="Spatial overview"
            subtitle="Track & detection evidence"
            detections={detections}
            trackPoints={trackHistory}
            currentDronePoint={t}
            selectedDetectionId={selectedId}
            visualThreshold={config?.visualConfidenceThreshold ?? null}
            metalThreshold={config?.metalThresholdNorm ?? null}
            onSelectDetection={(d) => {
              setSelectedId(d.id);
            }}
          />
          <div className="live-map-summary">
            <span>
              <i />
              Track derived from GPS <strong>{fmtNum(coverage?.trackLengthM, 0, 'm')}</strong>
            </span>
            <span>
              Last fix <strong>{fmtTime(t?.tUtc)}</strong>
            </span>
            <span>
              Observations <strong>{detections.length}</strong>
            </span>
          </div>
        </div>
        <aside className="live-evidence-panel" aria-label="Detection evidence">
          <div className="evidence-header">
            <div>
              <p className="type-eyebrow">SENSOR FUSION</p>
              <h2>
                Detection feed <span>{detections.length}</span>
              </h2>
            </div>
            <span className="evidence-count-note">{confirmed.length} confirmed</span>
          </div>
          <div className="evidence-tabs">
            <button
              type="button"
              aria-pressed={feedFilter === 'all'}
              className={feedFilter === 'all' ? 'is-active' : ''}
              onClick={() => {
                setFeedFilter('all');
              }}
            >
              All observations <span>{detections.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={feedFilter === 'confirmed'}
              className={feedFilter === 'confirmed' ? 'is-active' : ''}
              onClick={() => {
                setFeedFilter('confirmed');
              }}
            >
              Confirmed <span>{confirmed.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={feedFilter === 'unconfirmed'}
              className={feedFilter === 'unconfirmed' ? 'is-active' : ''}
              onClick={() => {
                setFeedFilter('unconfirmed');
              }}
            >
              Unconfirmed <span>{unconfirmed.length}</span>
            </button>
          </div>
          <div className="evidence-feed">
            {isError ? (
              <div className="p-4">
                <p className="mb-3 text-sm text-warning">Detection evidence could not be loaded.</p>
                <Button
                  size="sm"
                  onClick={() => {
                    void refetch();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                title="Awaiting observations"
                description="Sensor evidence appears as the survey proceeds."
              />
            ) : (
              <ul>
                {visible.map((detection) => (
                  <DetectionRow
                    key={detection.id}
                    detection={detection}
                    selected={selectedId === detection.id}
                    visualThreshold={config?.visualConfidenceThreshold ?? null}
                    metalThreshold={config?.metalThresholdNorm ?? null}
                    onSelect={() => {
                      setSelectedId(detection.id);
                    }}
                    onInspect={() => {
                      navigate(`/detections/${detection.id}`);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
          <button
            className="evidence-register-link"
            type="button"
            onClick={() => {
              navigate('/detections');
            }}
          >
            View all observations <ArrowRight size={14} />
          </button>
          <div className="swept-summary">
            <div className="swept-summary-heading">
              <h2>Derived swept ground</h2>
              <span>SESSION TOTAL</span>
            </div>
            <div className="swept-summary-values">
              <div>
                <span>Visually swept</span>
                <strong>{fmtArea(coverage?.visualSweptAreaM2)}</strong>
                <small>{fmtNum(coverage?.visualSwathM, 2, 'm')} swath</small>
              </div>
              <div>
                <span>Dual swept</span>
                <strong>{fmtArea(coverage?.dualSweptAreaM2)}</strong>
                <small>{fmtNum(config?.metalSwathM, 2, 'm')} coil swath</small>
              </div>
            </div>
            <p className="swept-degraded">
              Degraded <strong>{fmtArea(coverage?.degradedAreaM2)}</strong>
              <span>Sampling or GNSS quality</span>
            </p>
            <SweptNotClearedBanner compact />
          </div>
        </aside>
      </div>
      <SweepRibbon
        trackPoints={trackHistory}
        detections={detections}
        className="field-sweep-ribbon"
      />
    </div>
  );
};
const Telemetry: React.FC<{
  label: string;
  value: string;
  unit?: string;
  detail: string;
  tone?: string;
  status?: boolean | null;
}> = ({ label, value, unit, detail, tone = '', status }) => (
  <div className="telemetry-cell">
    <span>{label}</span>
    <div className={`telemetry-value ${tone ? `telemetry-value--${tone}` : ''}`}>
      <strong>{value}</strong>
      {unit && <small>{unit}</small>}
      {status != null &&
        (status ? (
          <Check size={15} aria-label="Sampling adequate" />
        ) : (
          <TriangleAlert size={15} aria-label="Undersampled" />
        ))}
    </div>
    <p>{detail}</p>
  </div>
);
const DetectionRow: React.FC<{
  detection: Detection;
  selected: boolean;
  visualThreshold: number | null;
  metalThreshold: number | null;
  onSelect: () => void;
  onInspect: () => void;
}> = ({ detection, selected, visualThreshold, metalThreshold, onSelect, onInspect }) => (
  <li className={`field-detection-row ${selected ? 'is-selected' : ''}`}>
    <button
      type="button"
      className="field-detection-select"
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="field-detection-id">{detectionLabel(detection)}</span>
      <strong>{detectionClassLabel(detection)}</strong>
      {detectionDeviceLabel(detection) && <span>{detectionDeviceLabel(detection)}</span>}
      {sensorConfidenceLabel(detection) && <span>{sensorConfidenceLabel(detection)}</span>}
      <ArrowUpRight size={13} />
    </button>
    <div className="field-detection-badges">
      <ClassificationBadge
        classification={detection.classification}
        validationIssue={detection.validationIssue ?? null}
      />
      <RiskBadge band={detection.riskBand} score={detection.riskScore} />
    </div>
    <ConfidenceLedger
      visualConfidence={detection.bestVisualConfidence}
      metalSignalNorm={detection.bestMetalSignalNorm}
      visualThreshold={visualThreshold}
      metalThreshold={metalThreshold}
      corroborationCount={detection.corroborationCount}
      compact
    />
    <div className="field-detection-meta">
      <span>{fmtTime(detection.firstObservedAt)}</span>
      <span>{fmtUncertainty(detection.localizationUncertaintyM)} CEP95</span>
      <button
        type="button"
        onClick={onInspect}
        aria-label={`Inspect detection ${detectionLabel(detection)}`}
      >
        Inspect <ArrowRight size={11} />
      </button>
    </div>
  </li>
);
