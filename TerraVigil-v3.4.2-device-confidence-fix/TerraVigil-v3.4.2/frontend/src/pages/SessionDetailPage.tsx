import { useMissionStatistics } from '../hooks/useMissionStatistics';
import { config as appConfig } from '../config';
import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, History, Radio } from 'lucide-react';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { KeyValueRow } from '../components/ui/KeyValueRow';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { TacticalMap } from '../components/map/TacticalMap';
import { SweepRibbon } from '../components/ui/SweepRibbon';
import { SweptNotClearedBanner } from '../components/ui/AlertNotice';
import { useSession } from '../hooks/useSessions';
import { useDetections } from '../hooks/useDetections';
import { useCoverage } from '../hooks/useCoverage';
import { useTrack } from '../hooks/useTrack';
import { SampleMissionWorkflow } from '../components/layout/SampleMissionWorkflow';
import {
  ABSENT,
  fmtArea,
  fmtDateTime,
  fmtDuration,
  fmtNum,
  fmtScore,
  fmtTime,
} from '../lib/formatters';
const STATE_LABEL: Record<string, string> = {
  created: 'Created',
  active: 'Active',
  ended: 'Ended',
  aborted: 'Aborted',
};
export const SessionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <SessionRecord key={id ?? 'none'} />;
};
const SessionRecord: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: session, isPending, isError, refetch } = useSession(id);
  const { detections, isError: evidenceError, isSuccess: evidenceKnown } = useDetections(id);
  const { data: statistics, isError: statisticsError } = useMissionStatistics(id);
  const missionBackend = appConfig.dataMode === 'live' && appConfig.backendStyle === 'missions';
  const { data: coverage } = useCoverage(id);
  const { data: track = [], isError: trackError } = useTrack(id);
  const [replayPercent, setReplayPercent] = useState(100);
  const orderedTrack = useMemo(
    () => [...track].sort((a, b) => Date.parse(a.tUtc) - Date.parse(b.tUtc)),
    [track],
  );
  const replayCount = orderedTrack.length
    ? Math.max(1, Math.ceil((replayPercent / 100) * orderedTrack.length))
    : 0;
  const replayTrack = orderedTrack.slice(0, replayCount);
  const replayPoint = replayTrack.at(-1) ?? null;
  const replayDetections =
    replayPercent === 100 || !replayPoint
      ? detections
      : detections.filter((d) => Date.parse(d.firstObservedAt) <= Date.parse(replayPoint.tUtc));
  if (isPending)
    return (
      <div className="field-workspace">
        <Skeleton className="h-16 w-80" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  if (isError || !session)
    return (
      <div className="field-workspace">
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          icon={<ArrowLeft size={14} />}
          onClick={() => {
            navigate('/sessions');
          }}
        >
          Scan sessions
        </Button>
        <EmptyState
          title="Session unavailable"
          description="The session record could not be loaded. Check the connection and try again."
        />
        <Button
          size="sm"
          className="self-start"
          onClick={() => {
            void refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  const confirmed = detections.filter((d) => d.classification === 'confirmed');
  const config = session.config;
  return (
    <div className="field-workspace">
      <header className="field-page-header">
        <div>
          <button
            type="button"
            className="mb-3 flex items-center gap-2 text-[11px] text-text-muted hover:text-accent"
            onClick={() => {
              navigate('/sessions');
            }}
          >
            <ArrowLeft size={13} />
            Scan sessions
          </button>
          <p className="type-eyebrow">SESSION RECORD / {session.id}</p>
          <h1>
            {session.siteName}
            <span className="live-heading-status">
              {STATE_LABEL[session.state] ?? session.state}
            </span>
          </h1>
          <p className="field-page-subtitle">
            {session.operatorName ?? (session.operatorId || 'Operator unreported')} ·{' '}
            {session.flightMode === null
              ? 'Flight mode unreported'
              : session.flightMode === 'rc_manual'
                ? 'RC manual'
                : 'ArduPilot auto'}{' '}
            · {fmtDateTime(session.startedAt)}
          </p>
        </div>
        {session.state === 'active' ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Radio size={14} />}
            onClick={() => {
              navigate('/live');
            }}
          >
            Open live console
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowUpRight size={14} />}
            onClick={() => {
              navigate('/reports');
            }}
          >
            Session reports
          </Button>
        )}
      </header>
      <SampleMissionWorkflow session={session} />
      <section className="risk-summary-strip" aria-label="Complete session totals">
        <div>
          <span>Confirmed detections</span>
          <strong>
            {missionBackend
              ? (statistics?.confirmed ?? ABSENT)
              : evidenceKnown
                ? confirmed.length
                : ABSENT}
            <small>stored confirmations</small>
          </strong>
        </div>
        <div>
          <span>All observations</span>
          <strong>
            {missionBackend
              ? (statistics?.totalRecords ?? ABSENT)
              : evidenceKnown
                ? detections.length
                : ABSENT}
            <small>session total</small>
          </strong>
        </div>
        <div>
          <span>Visually swept</span>
          <strong>{fmtArea(coverage?.visualSweptAreaM2)}</strong>
        </div>
        <div>
          <span>Session duration</span>
          <strong>
            {session.endedAt === null && session.state !== 'active'
              ? ABSENT
              : fmtDuration(session.startedAt, session.endedAt)}
          </strong>
        </div>
      </section>
      {(evidenceError || trackError || statisticsError) && (
        <p role="alert">
          Some mission records could not be refreshed. Displayed records may be from the last
          successful read.
        </p>
      )}
      <div className="session-replay">
        <History size={19} className="shrink-0 text-accent" />
        <div>
          <h2>Survey replay</h2>
          <p>{fmtTime(replayPoint?.tUtc)}</p>
        </div>
        <input
          type="range"
          aria-label="Scrub survey replay"
          aria-valuetext={`${replayCount} of ${orderedTrack.length} track points, ${fmtTime(replayPoint?.tUtc)}`}
          min={0}
          max={100}
          value={replayPercent}
          disabled={orderedTrack.length < 2}
          onChange={(e) => {
            setReplayPercent(Number(e.target.value));
          }}
        />
        <span>
          {replayCount} / {orderedTrack.length} points
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={replayPercent === 100}
          onClick={() => {
            setReplayPercent(100);
          }}
        >
          Full session
        </Button>
      </div>
      <div className="map-page-body">
        <div className="map-page-map">
          <TacticalMap
            title="Recorded survey"
            subtitle={`${replayDetections.length} observations at replay position`}
            detections={replayDetections}
            trackPoints={replayTrack}
            currentDronePoint={replayPoint}
            visualThreshold={config.visualConfidenceThreshold}
            metalThreshold={config.metalThresholdNorm}
            onSelectDetection={(d) => {
              navigate(`/detections/${d.id}`);
            }}
            reticle={false}
          />
        </div>
        <aside className="map-page-sidebar">
          <Panel title="Session timeline">
            <dl className="space-y-3">
              <KeyValueRow label="Started" value={fmtDateTime(session.startedAt)} mono />
              <KeyValueRow
                label="Ended"
                value={
                  session.endedAt === null
                    ? session.state === 'active'
                      ? 'In progress'
                      : 'End time unreported'
                    : fmtDateTime(session.endedAt)
                }
                mono
              />
              <KeyValueRow
                label="Track length (derived from GPS)"
                value={fmtNum(coverage?.trackLengthM, 0, 'm')}
                mono
              />
              <KeyValueRow
                label="UTM reference"
                value={session.utmEpsg === null ? ABSENT : `EPSG:${String(session.utmEpsg)}`}
                mono
              />
            </dl>
          </Panel>
          <Panel title="Frozen configuration">
            <dl className="space-y-3">
              <KeyValueRow
                label="Visual threshold"
                value={fmtScore(config.visualConfidenceThreshold)}
                mono
              />
              <KeyValueRow
                label="Metal threshold"
                value={fmtScore(config.metalThresholdNorm)}
                mono
              />
              <KeyValueRow
                label="Nominal altitude"
                value={fmtNum(config.nominalAglM, 1, 'm AGL')}
                mono
              />
              <KeyValueRow
                label="Association radius"
                value={fmtNum(config.associationRadiusM, 1, 'm')}
                mono
              />
              <KeyValueRow
                label="Coil standoff limit"
                value={fmtNum(config.metalMaxStandoffM, 2, 'm')}
                mono
              />
              <KeyValueRow
                label="Inference width"
                value={fmtNum(config.inferenceWidthPx, 0, 'px')}
                mono
              />
            </dl>
            <p className="mt-4 border-t border-border pt-3 text-[10px] leading-relaxed text-text-muted">
              Only configuration returned with the session is shown. Missing fields are unreported.
            </p>
          </Panel>
          <Panel title="Derived swept ground">
            <dl className="space-y-3">
              <KeyValueRow
                label="Visually swept"
                value={fmtArea(coverage?.visualSweptAreaM2)}
                mono
              />
              <KeyValueRow label="Dual swept" value={fmtArea(coverage?.dualSweptAreaM2)} mono />
              <KeyValueRow label="Degraded" value={fmtArea(coverage?.degradedAreaM2)} mono />
            </dl>
            <div className="mt-4">
              <SweptNotClearedBanner compact />
            </div>
          </Panel>
        </aside>
      </div>
      <SweepRibbon
        trackPoints={replayTrack}
        detections={replayDetections}
        className="field-sweep-ribbon"
      />
      {session.notes && (
        <Panel title="Field notes">
          <p className="whitespace-pre-line text-[12px] leading-relaxed text-text-secondary">
            {session.notes}
          </p>
        </Panel>
      )}
    </div>
  );
};
