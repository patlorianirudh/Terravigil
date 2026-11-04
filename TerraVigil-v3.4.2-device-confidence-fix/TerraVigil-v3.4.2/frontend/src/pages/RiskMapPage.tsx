import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { TacticalMap } from '../components/map/TacticalMap';
import { Button } from '../components/ui/Button';
import { SweptNotClearedBanner } from '../components/ui/AlertNotice';
import { KeyValueRow } from '../components/ui/KeyValueRow';
import { useDetections } from '../hooks/useDetections';
import { useMissionStatistics } from '../hooks/useMissionStatistics';
import { config } from '../config';
import { useRiskSurface } from '../hooks/useRiskSurface';
import { useLiveTelemetry } from '../hooks/useLiveTelemetry';
import { useCoverage } from '../hooks/useCoverage';
import { useTrack } from '../hooks/useTrack';
import { useSessionStore } from '../state/sessionStore';
import { useUIStore } from '../state/uiStore';
import { ABSENT, fmtArea, fmtNum } from '../lib/formatters';
const LAYERS = [
  { key: 'confirmedMines', label: 'Confirmed detections', glyph: '●' },
  { key: 'unconfirmedVisual', label: 'Visual detections', glyph: '△' },
  { key: 'unresolvedMetal', label: 'Unresolved metal', glyph: '◇' },
  { key: 'flightTrack', label: 'Flown track', glyph: '—' },
  { key: 'uncertaintyCircles', label: 'CEP95 uncertainty', glyph: '◌' },
] as const;
export const RiskMapPage: React.FC = () => {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const selectedId = search.get('detection');
  const activeSession = useSessionStore((s) => s.activeSession);
  const {
    data: riskPoints,
    isError: riskError,
    refetch: refetchRisk,
  } = useRiskSurface(activeSession?.id);
  const {
    detections: observations,
    isSuccess: observationsKnown,
    isError: observationsError,
    refetch: refetchObservations,
  } = useDetections(activeSession?.id);
  // Demo/PRD risk surfaces contain confirmed records only. Retain the other
  // evidence classes from the register and deduplicate mission record identities.
  const detections = [
    ...new Map(
      [
        ...(riskPoints ?? []),
        ...observations.filter((record) => record.classification !== 'confirmed'),
      ]
        .filter((record) => record.sessionId === activeSession?.id)
        .map((record) => [`${record.sessionId}:${record.id}`, record]),
    ).values(),
  ];
  const confirmed = detections.filter((record) => record.classification === 'confirmed');
  const unconfirmed = detections.filter((record) => record.classification !== 'confirmed');
  const { data: statistics, isError: statisticsError } = useMissionStatistics(activeSession?.id);
  const missionBackend = config.dataMode === 'live' && config.backendStyle === 'missions';
  const stream = useLiveTelemetry();
  const { data: recordedTrack = [] } = useTrack(activeSession?.id);
  const sessionTrack = stream.trackHistory.filter((point) => point.sessionId === activeSession?.id);
  const trackHistory = sessionTrack.length > 0 ? sessionTrack : recordedTrack;
  const latestTelemetry =
    stream.latestTelemetry?.sessionId === activeSession?.id
      ? stream.latestTelemetry
      : (trackHistory.at(-1) ?? null);
  const { data: coverage } = useCoverage(activeSession?.id);
  const layers = useUIStore((s) => s.layers);
  const toggleLayer = useUIStore((s) => s.toggleLayer);
  const counts = {
    high: detections.filter((d) => d.riskBand === 'high').length,
    medium: detections.filter((d) => d.riskBand === 'medium').length,
    low: detections.filter((d) => d.riskBand === 'low').length,
  };
  return (
    <div className="field-workspace">
      <header className="field-page-header">
        <div>
          <p className="type-eyebrow">SPATIAL INTELLIGENCE</p>
          <h1>Risk map</h1>
          <p className="field-page-subtitle">
            {activeSession?.siteName ?? 'No scan session selected'} · Evidence in geographic context
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowUpRight size={14} />}
          onClick={() => {
            navigate('/route');
          }}
        >
          Open route planner
        </Button>
      </header>
      {selectedId && (
        <p className="workflow-shortcut">
          Selected capture position.{' '}
          <Link
            to={`/detections/${selectedId}?mission=${encodeURIComponent(activeSession?.id ?? '')}`}
          >
            Open detection details →
          </Link>
        </p>
      )}
      <section className="risk-summary-strip" aria-label="Session observation summary">
        <div>
          <span>Confirmed detections</span>
          <strong>
            {missionBackend
              ? (statistics?.confirmed ?? ABSENT)
              : riskPoints === undefined
                ? ABSENT
                : confirmed.length}
            <small>stored confirmations</small>
          </strong>
        </div>
        <div>
          <span>Visual detections</span>
          <strong>
            {missionBackend
              ? (statistics?.unconfirmed ?? ABSENT)
              : observationsKnown
                ? detections.filter((record) => record.classification === 'unconfirmed_visual')
                    .length
                : ABSENT}
            <small>visual evidence only</small>
          </strong>
        </div>
        <div>
          <span>Unresolved metal</span>
          <strong>
            {observationsKnown
              ? detections.filter((d) => d.classification === 'unresolved_metal').length
              : ABSENT}
            <small>metal evidence only</small>
          </strong>
        </div>
        <div>
          <span>Track length</span>
          <strong>
            {fmtNum(coverage?.trackLengthM, 0)}
            <small>metres derived from GPS</small>
          </strong>
        </div>
      </section>
      {(riskError || observationsError) && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-warning-border bg-warning-fill p-3 text-xs text-warning"
        >
          <span>
            Stored risk evidence could not be loaded. Any displayed records are from the last
            successful read.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void refetchRisk();
              void refetchObservations();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {missionBackend && (
        <p className="text-xs text-text-muted">
          {statisticsError
            ? 'Mission statistics could not be loaded.'
            : `Server statistics: ${statistics?.totalRecords ?? ABSENT} records across both collections. Map summaries below use records with valid GPS.`}
        </p>
      )}
      {detections.some((row) => row.validationIssue) && (
        <p role="alert">
          Some stored classifications need validation. Inspect flagged sensor records.
        </p>
      )}
      <div className="map-page-body">
        <div className="map-page-map">
          <TacticalMap
            key={activeSession?.id ?? 'none'}
            title="Detection distribution"
            subtitle="Select a marker to inspect evidence"
            detections={detections}
            selectedDetectionId={selectedId}
            trackPoints={trackHistory}
            currentDronePoint={latestTelemetry}
            visualThreshold={activeSession?.config.visualConfidenceThreshold ?? null}
            metalThreshold={activeSession?.config.metalThresholdNorm ?? null}
            onSelectDetection={(d) => {
              navigate(`/detections/${d.id}`);
            }}
          />
        </div>
        <aside className="map-page-sidebar">
          <section className="map-sidebar-block">
            <div className="map-sidebar-title">
              <span>01</span>
              <h2>Evidence layers</h2>
            </div>
            <div className="map-sidebar-content">
              {LAYERS.map((row) => (
                <label className="map-layer-row" key={row.key}>
                  <span aria-hidden>{row.glyph}</span>
                  <span>{row.label}</span>
                  <input
                    type="checkbox"
                    checked={layers[row.key]}
                    onChange={() => {
                      toggleLayer(row.key);
                    }}
                  />
                </label>
              ))}
            </div>
          </section>
          <section className="map-sidebar-block">
            <div className="map-sidebar-title">
              <span>02</span>
              <h2>Stored risk distribution</h2>
            </div>
            <div className="map-sidebar-content">
              {[
                {
                  band: 'high',
                  name: 'HIGH risk',
                  color: 'text-risk-high',
                },
                {
                  band: 'medium',
                  name: 'MEDIUM risk',
                  color: 'text-risk-medium',
                },
                {
                  band: 'low',
                  name: 'LOW risk',
                  color: 'text-risk-low',
                },
              ].map((item) => (
                <div className={`risk-band-row ${item.color}`} key={item.band}>
                  <i className={`map-dot ${item.band}`} />
                  <div>
                    <strong>{item.name}</strong>
                    <p>
                      {confirmed.filter((record) => record.riskBand === item.band).length} confirmed
                      · {unconfirmed.filter((record) => record.riskBand === item.band).length}{' '}
                      unconfirmed
                    </p>
                  </div>
                  <span>
                    {riskPoints === undefined ? ABSENT : counts[item.band as keyof typeof counts]}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="map-sidebar-block">
            <div className="map-sidebar-title">
              <span>03</span>
              <h2>Derived swept ground</h2>
            </div>
            <div className="map-sidebar-content">
              <dl className="space-y-3">
                <KeyValueRow
                  label="Visually swept"
                  value={fmtArea(coverage?.visualSweptAreaM2)}
                  mono
                />
                <KeyValueRow label="Dual swept" value={fmtArea(coverage?.dualSweptAreaM2)} mono />
                <KeyValueRow label="Degraded" value={fmtArea(coverage?.degradedAreaM2)} mono />
              </dl>
              <p className="mt-4 border-t border-border pt-3">
                Sensor footprints differ. Visual and metal swept areas are reported independently.
              </p>
            </div>
          </section>
          <SweptNotClearedBanner />
        </aside>
      </div>
    </div>
  );
};
