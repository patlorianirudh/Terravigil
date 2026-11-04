import { useQuery } from '@tanstack/react-query';
import { bridgeApi } from '../services/bridge';
import { useMissionStatistics } from '../hooks/useMissionStatistics';
import { detectionLabel } from '../lib/classification';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  ScanLine,
  Radio,
  Target,
  Layers3,
  Clock3,
  Crosshair,
  ChevronRight,
} from 'lucide-react';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ClassificationBadge } from '../components/ui/ClassificationBadge';
import { RiskBadge } from '../components/ui/RiskBadge';
import { ConfidenceLedger } from '../components/ui/ConfidenceLedger';
import { SweptNotClearedBanner } from '../components/ui/AlertNotice';
import { TacticalMap } from '../components/map/TacticalMap';
import { useSessionStore } from '../state/sessionStore';
import { useSessions } from '../hooks/useSessions';
import { useDetections } from '../hooks/useDetections';
import { useCoverage } from '../hooks/useCoverage';
import { useTrack } from '../hooks/useTrack';
import { useLiveTelemetry } from '../hooks/useLiveTelemetry';
import { useSystemHealth, useSystemEvents } from '../hooks/useSystem';
import { config } from '../config';
import { ABSENT, fmtArea, fmtCount, fmtNum, fmtShortId, fmtTime } from '../lib/formatters';
import '../styles/operations.css';
import '../styles/connections.css';

export function OperationsPage() {
  const navigate = useNavigate();
  const { data: bridge } = useQuery({
    queryKey: ['bridge-status'],
    queryFn: bridgeApi.status,
    refetchInterval: 3000,
  });
  const session = useSessionStore((s) => s.activeSession);
  const { sessions, isError: sessionError } = useSessions();
  const {
    detections: sessionDetections,
    isSuccess: detectionsReady,
    isError: detectionError,
  } = useDetections(session?.id);
  const detections = session ? sessionDetections.filter((d) => d.sessionId === session.id) : [];
  const { data: statistics, isError: statisticsError } = useMissionStatistics(session?.id);
  const missionBackend = config.dataMode === 'live' && config.backendStyle === 'missions';
  const { data: coverage } = useCoverage(session?.id);
  const { latestTelemetry: pushedTelemetry, trackHistory: pushedTrack } = useLiveTelemetry();
  const { data: recordedTrack = [] } = useTrack(session?.id);
  const sessionPushedTrack = pushedTrack.filter((p) => p.sessionId === session?.id);
  const trackHistory =
    sessionPushedTrack.length > 0 && session?.state === 'active'
      ? sessionPushedTrack
      : recordedTrack;
  const latestTelemetry =
    pushedTelemetry?.sessionId === session?.id && session?.state === 'active'
      ? pushedTelemetry
      : (trackHistory.at(-1) ?? null);
  const samplingKnown = latestTelemetry?.achievedFps != null && latestTelemetry.requiredFps != null;
  const { data: subsystems = [], isError: healthError } = useSystemHealth();
  const { data: events = [] } = useSystemEvents(session?.id);
  const confirmed = detections.filter((d) => d.classification === 'confirmed');
  const visual = detections.filter((d) => d.classification === 'unconfirmed_visual');
  const metal = detections.filter((d) => d.classification === 'unresolved_metal');
  const recent = [...detections]
    .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt))
    .slice(0, 3);
  const healthy = subsystems.filter((item) => item.status === 'ok').length;
  const review = detections.filter((d) => d.reviewState === 'unreviewed').length;
  const valuesKnown = Boolean(session) && detectionsReady;
  return (
    <div className="operations-page">
      <Link to="/connections" className="workflow-shortcut">
        <div>
          <strong>Firebase → telemetry → map</strong>
          <span>
            Camera Module 2 detections and Pixhawk GPS update automatically.
          </span>
        </div>
        <ArrowUpRight size={20} />
      </Link>
      <section className="workflow-shortcut" aria-label="Live Firebase matching">
        <div>
          <strong>
            {bridge?.state === 'connected'
              ? 'Firebase connected'
              : 'Firebase connection: ' + (bridge?.state ?? 'checking')}
          </strong>
          <span>
            {bridge?.counts.matched ?? 0} mapped · {bridge?.counts.pending ?? 0} waiting for GPS ·{' '}
            {bridge?.counts.invalid ?? 0} invalid records
          </span>
          <span>
            Input mission: {bridge?.mission_id ?? 'Waiting for configuration'}. Map below:{' '}
            {session?.id ?? 'No mission selected'}.
          </span>
          <span>{bridge?.message ?? 'Starting the automatic detection feed…'}</span>
          {!!bridge?.telemetry?.rows && bridge.telemetry.valid_rows === 0 && (
            <span>{bridge.telemetry.rows.toLocaleString()} CSV rows read, but no usable GPS position. Check the GPS fix in Mission Planner.</span>
          )}
        </div>
        {bridge?.mission_id && (
          <Link
            to={`/?mission=${encodeURIComponent(bridge.mission_id)}`}
            onClick={() => {
              const selected = sessions.find((item) => item.id === bridge.mission_id);
              if (selected) useSessionStore.getState().setActiveSession(selected);
            }}
          >
            View incoming mission <ArrowUpRight size={16} />
          </Link>
        )}
      </section>
      <header className="ops-intro">
        <div className="ops-intro-heading">
          <p className="type-eyebrow">
            <span>01 / OPERATIONS</span> FIELD INTELLIGENCE
          </p>
          <h1 className="ops-intro-title">
            Your survey.
            <br />
            <span>In full context.</span>
          </h1>
          <p className="ops-intro-description">
            CSI Camera Module 2 · Firebase detections · Pixhawk GPS
          </p>
        </div>
        <div className="ops-intro-actions">
          <Link className="ops-briefing-link" to="/briefing">
            Explore the TerraVigil project <ArrowUpRight size={14} />
          </Link>
          <div className="page-header-actions">
            <Button
              onClick={() => {
                navigate('/sessions');
              }}
              icon={<Layers3 size={14} />}
            >
              Scan sessions
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                navigate('/live');
              }}
              icon={<Radio size={14} />}
            >
              Open live console
              <ArrowUpRight size={14} />
            </Button>
          </div>
          <p className="ops-intro-principle">
            OBSERVE <span>/</span> CORROBORATE <span>/</span> REVIEW
          </p>
        </div>
      </header>

      <section className="ops-session-strip" aria-label="Selected scan session">
        <div className="ops-session-icon">
          <ScanLine size={19} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2>{session?.siteName ?? 'Your next survey starts here'}</h2>
            {session && (
              <span className="ops-session-state">
                <span
                  className={`size-1.5 rounded-full ${session.state === 'active' ? 'bg-ok' : 'bg-offline'}`}
                />
                {config.dataMode === 'demo' ? 'DEMO SESSION' : session.state.toUpperCase()}
              </span>
            )}
          </div>
          <p>
            {session ? (
              <>
                <span className="font-mono">{fmtShortId(session.id, 14)}</span>
                <span> / </span>
                {session.flightMode === null
                  ? 'Flight mode unreported'
                  : session.flightMode === 'rc_manual'
                    ? 'RC manual'
                    : 'ArduPilot auto'}
                <span> / </span>
                {session.operatorName ?? 'Operator unreported'}
              </>
            ) : (
              'Create a scan session to organize observations and sensor evidence.'
            )}
          </p>
        </div>
        <Link to={session ? `/sessions/${session.id}` : '/sessions'} className="ops-session-link">
          Session details
          <ChevronRight size={15} />
        </Link>
      </section>

      <div className="ops-metrics">
        <article className="ops-metric">
          <div className="ops-metric-label">
            Confirmed detections
            <Target size={15} />
          </div>
          <div className="ops-number">
            {missionBackend
              ? fmtCount(statistics?.confirmed)
              : valuesKnown
                ? fmtCount(confirmed.length)
                : ABSENT}
            <span className="ops-metric-tag">Stored status</span>
          </div>
          <div className="ops-metric-note">
            <span className="size-1.5 rounded-full bg-risk-high" />
            {valuesKnown
              ? `${confirmed.filter((d) => d.riskBand === 'high').length} confirmed · HIGH risk`
              : 'Awaiting sensor evidence'}
          </div>
        </article>
        <article className="ops-metric">
          <div className="ops-metric-label">
            Awaiting confirmation
            <Crosshair size={15} />
          </div>
          <div className="ops-number">
            {missionBackend
              ? fmtCount(statistics?.unconfirmed)
              : valuesKnown
                ? fmtCount(visual.length + metal.length)
                : ABSENT}
            <span className="ops-metric-tag">Single sensor</span>
          </div>
          <div className="ops-metric-note">
            {valuesKnown
              ? `${visual.length} visual observations · ${metal.length} metal signatures`
              : 'Separate from confirmed detections'}
          </div>
        </article>
        <article className="ops-metric">
          <div className="ops-metric-label">
            Visually swept
            <ScanLine size={15} />
          </div>
          <div className="ops-number ops-number-accent">{fmtArea(coverage?.visualSweptAreaM2)}</div>
          <div className="ops-metric-note">
            <span className="size-1.5 rounded-full bg-accent" />
            {fmtArea(coverage?.dualSweptAreaM2)} dual-swept · swept ≠ cleared
          </div>
        </article>
        <article className="ops-metric">
          <div className="ops-metric-label">
            Sensor sampling
            <ActivityGlyph />
          </div>
          <div className="ops-number">
            {fmtNum(latestTelemetry?.achievedFps, 1)}
            <span className="ops-unit">fps</span>
          </div>
          <div
            className={`ops-metric-note ${latestTelemetry?.isUndersampled ? 'text-warning' : ''}`}
          >
            {samplingKnown ? (
              <>
                <span
                  className={`size-1.5 rounded-full ${latestTelemetry.isUndersampled ? 'bg-warning' : 'bg-ok'}`}
                />
                {fmtNum(latestTelemetry.requiredFps, 1)} fps required ·{' '}
                {latestTelemetry.isUndersampled ? 'Below requirement' : 'Sampling sufficient'}
              </>
            ) : (
              'Sampling requirement not reported'
            )}
          </div>
        </article>
      </div>

      {missionBackend && (
        <p className="text-xs text-text-muted">
          {statisticsError
            ? 'Mission statistics could not be loaded.'
            : `Server statistics: ${statistics?.totalRecords ?? ABSENT} stored records · HIGH ${statistics?.risk.high ?? ABSENT} · MEDIUM ${statistics?.risk.medium ?? ABSENT} · LOW ${statistics?.risk.low ?? ABSENT} ${session?.isSample ? 'among confirmed detections' : 'across both collections'}.`}
        </p>
      )}
      {detections.some((row) => row.validationIssue) && (
        <p role="alert">
          Some stored classifications need validation. Inspect the flagged sensor records.
        </p>
      )}
      <div className="ops-primary-grid">
        <section className="ops-map-panel panel">
          <div className="panel-heading">
            <div className="flex items-center gap-2.5">
              <span className="ops-section-index">01</span>
              <h2 className="type-section-heading">Recorded capture positions</h2>
            </div>
            <Link
              to={session ? `/risk-map?mission=${encodeURIComponent(session.id)}` : '/risk-map'}
              className="ops-text-link"
            >
              Explore map
              <ArrowUpRight size={13} />
            </Link>
          </div>
          <p className="p-3 text-xs text-text-muted">
            {detections.length
              ? 'Markers show matched aircraft positions. Target ground coordinates are not measured.'
              : 'Waiting for timestamp-matched detections. No sample markers are loaded.'}
          </p>
          <div className="ops-map-stage">
            <TacticalMap
              detections={detections}
              trackPoints={trackHistory}
              currentDronePoint={latestTelemetry}
              visualThreshold={session?.config.visualConfidenceThreshold ?? null}
              metalThreshold={session?.config.metalThresholdNorm ?? null}
              onSelectDetection={(d) => {
                navigate(`/detections/${d.id}?mission=${encodeURIComponent(d.sessionId)}`);
              }}
              reticle={false}
            />
          </div>
          <div className="ops-map-footer">
            <span>
              <span className="font-mono text-accent">{fmtNum(coverage?.trackLengthM, 0)}</span> m
              flown track
            </span>
            <span>
              <span className="font-mono text-text-primary">
                {valuesKnown ? fmtCount(detections.length) : ABSENT}
              </span>{' '}
              observations
            </span>
            <span className="ml-auto">Aircraft GPS at image capture</span>
          </div>
        </section>
        <Panel
          flush
          className="ops-evidence-panel"
          title="Latest observations"
          headerRight={
            <Link to="/detections" className="ops-text-link" aria-label="View all detections">
              <ArrowUpRight size={15} />
            </Link>
          }
        >
          {recent.length ? (
            <div>
              {recent.map((d) => (
                <button
                  type="button"
                  className="ops-detection"
                  key={d.id}
                  onClick={() => {
                    navigate(`/detections/${d.id}?mission=${encodeURIComponent(d.sessionId)}`);
                  }}
                >
                  <div className="ops-detection-top">
                    <span className="font-mono text-[11px] text-text-primary">
                      {detectionLabel(d)}
                    </span>
                    <span className="font-mono text-[9px] text-text-muted">
                      {fmtTime(d.lastObservedAt)}
                    </span>
                    <ChevronRight size={12} className="text-text-muted" />
                  </div>
                  <div className="my-3">
                    <ClassificationBadge
                      classification={d.classification}
                      validationIssue={d.validationIssue ?? null}
                    />
                    <RiskBadge band={d.riskBand} score={d.riskScore} />
                  </div>
                  <ConfidenceLedger
                    compact
                    visualConfidence={d.bestVisualConfidence}
                    metalSignalNorm={d.bestMetalSignalNorm}
                    visualThreshold={session?.config.visualConfidenceThreshold ?? null}
                    metalThreshold={session?.config.metalThresholdNorm ?? null}
                  />
                  <p className="mt-2.5 font-mono text-[9px] text-text-muted">
                    CEP95 ±{fmtNum(d.localizationUncertaintyM, 1)} m ·{' '}
                    {d.reviewState === null
                      ? 'Review unavailable'
                      : d.reviewState === 'unreviewed'
                        ? 'Awaiting review'
                        : 'Reviewed'}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-5">
              <EmptyState
                title={detectionError ? 'Evidence unavailable' : 'Evidence will appear here'}
                description={
                  detectionError
                    ? 'The observation register could not be retrieved. Check the ground-station connection.'
                    : 'Visual candidates and metal signatures are listed as the survey progresses.'
                }
              />
            </div>
          )}
          <Link to="/detections" className="ops-review-link">
            <span>
              {review ? `${review} observations awaiting review` : 'Open detection register'}
            </span>
            <ArrowRight size={14} />
          </Link>
        </Panel>
      </div>
      <SweptNotClearedBanner />
      <div className="ops-secondary-grid">
        <Panel
          flush
          title="Instrument health"
          headerRight={
            <Link to="/system" className="ops-text-link">
              Diagnostics
              <ArrowUpRight size={13} />
            </Link>
          }
        >
          <div className="ops-health-summary">
            <span>
              <strong>{subsystems.length ? `${healthy}/${subsystems.length}` : ABSENT}</strong>{' '}
              reported systems nominal
            </span>
            <span className="type-code">
              {config.dataMode === 'demo' ? 'DEMO SNAPSHOT' : 'REPORTED STATUS'}
            </span>
          </div>
          {subsystems.length ? (
            <div className="ops-health-grid">
              {subsystems.slice(0, 6).map((sub) => (
                <Link to="/system" key={sub.id} className="ops-health-item">
                  <span
                    className={`ops-health-dot ${sub.status === 'ok' ? 'bg-ok' : sub.status === 'warning' ? 'bg-warning' : sub.status === 'critical' ? 'bg-critical' : 'bg-offline'}`}
                  />
                  <span>{sub.name}</span>
                  <StatusBadge status={sub.status} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-5 text-text-muted">
              {healthError
                ? 'Instrument health could not be retrieved.'
                : 'Waiting for subsystem reports.'}
            </p>
          )}
        </Panel>
        <Panel
          flush
          title="Survey activity"
          headerRight={
            <Link to="/system" className="ops-text-link">
              Event log
              <ArrowUpRight size={13} />
            </Link>
          }
        >
          <div className="ops-activity">
            {events.length ? (
              events.slice(0, 3).map((event) => (
                <Link to="/system" className="ops-event" key={event.id}>
                  <span
                    className={`ops-event-dot ${event.severity === 'critical' ? 'bg-critical' : event.severity === 'warning' ? 'bg-warning' : 'bg-accent'}`}
                  />
                  <div>
                    <p>{event.message}</p>
                    <span>
                      {event.code.replaceAll('_', ' ')} · {fmtTime(event.tUtc)}
                    </span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="ops-event">
                <Clock3 size={17} className="text-text-muted" />
                <div>
                  <p>
                    {sessions.length
                      ? `${sessions.length} scan sessions in the workspace`
                      : 'No session events yet'}
                  </p>
                  <span>Events appear as the ground station reports them.</span>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>
      {sessionError && (
        <EmptyState
          title="Sessions unavailable"
          description="The session archive could not be retrieved. Check your ground-station connection."
          action={
            <Button
              onClick={() => {
                navigate('/system');
              }}
            >
              Check connection
            </Button>
          }
        />
      )}
      <footer className="ops-footer">
        <span>OBSERVE. CORROBORATE. UNDERSTAND.</span>
        <span>TerraVigil · Aerial survey intelligence</span>
      </footer>
    </div>
  );
}
function ActivityGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1 8h3l2-5 4 10 2-5h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
