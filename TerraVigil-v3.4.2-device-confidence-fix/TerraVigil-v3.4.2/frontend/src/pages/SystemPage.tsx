import React, { useMemo, useState } from 'react';
import {
  Activity,
  Camera,
  Check,
  CircleAlert,
  Cpu,
  Database,
  Radio,
  RefreshCw,
  Satellite,
  Terminal,
  Wifi,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useSystemEvents, useSystemHealth } from '../hooks/useSystem';
import { useLiveTelemetry } from '../hooks/useLiveTelemetry';
import { useSessionStore } from '../state/sessionStore';
import { ABSENT, fmtDateTime, fmtLatLon, fmtNum, fmtTime } from '../lib/formatters';
import '../styles/workspace.css';

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'text-critical',
  warning: 'text-warning',
  info: 'text-info',
};
function subsystemIcon(id: string) {
  const key = id.toLowerCase();
  if (/camera|vision|video/.test(key)) return Camera;
  if (/gps|gnss/.test(key)) return Satellite;
  if (/link|radio|sik/.test(key)) return Radio;
  if (/database|storage|backend/.test(key)) return Database;
  if (/metal|sensor/.test(key)) return Activity;
  return Cpu;
}

export const SystemPage: React.FC = () => {
  const activeSession = useSessionStore((s) => s.activeSession);
  const [severity, setSeverity] = useState('all');
  const {
    data: subsystems = [],
    isPending: healthPending,
    isError: healthError,
    refetch: refreshHealth,
    isFetching: healthFetching,
  } = useSystemHealth();
  const {
    data: events = [],
    isPending: eventsPending,
    isError: eventsError,
    refetch: refreshEvents,
    isFetching: eventsFetching,
  } = useSystemEvents(activeSession?.id);
  const { latestTelemetry: t } = useLiveTelemetry();
  const filteredEvents = useMemo(
    () =>
      events
        .filter((e) => severity === 'all' || e.severity === severity)
        .sort((a, b) => b.tUtc.localeCompare(a.tUtc)),
    [events, severity],
  );
  const healthy = subsystems.filter((sub) => sub.status === 'ok').length;
  const attention = subsystems.filter(
    (sub) => sub.status === 'warning' || sub.status === 'critical',
  ).length;
  const offline = subsystems.filter((sub) => sub.status === 'offline').length;
  const busy = healthFetching || eventsFetching;

  return (
    <div className="workspace-page">
      <PageHeader
        eyebrow="Workspace / System health"
        title="Every signal accounted for."
        description="A live view of the hardware, connections, and events behind your survey."
        actions={
          <Button
            icon={<RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />}
            disabled={busy}
            onClick={() => {
              void Promise.all([refreshHealth(), refreshEvents()]);
            }}
          >
            Refresh status
          </Button>
        }
      />
      <div className="system-status-strip">
        <div>
          <span
            className={`system-status-symbol ${attention > 0 ? 'text-warning' : subsystems.length === 0 ? 'text-text-muted' : offline > 0 ? 'text-offline' : 'text-accent'}`}
          >
            {attention > 0 ? (
              <CircleAlert className="size-5" />
            ) : subsystems.length > 0 && offline === 0 ? (
              <Check className="size-5" />
            ) : (
              <Activity className="size-5" />
            )}
          </span>
          <div>
            <h2>
              {healthPending
                ? 'Checking subsystem reports'
                : healthError
                  ? 'System status unavailable'
                  : subsystems.length === 0
                    ? 'Waiting for subsystem reports'
                    : attention > 0
                      ? 'Some systems need your attention'
                      : offline > 0
                        ? 'Some systems are offline'
                        : 'All reported systems operational'}
            </h2>
            <p>Latest available health snapshot from the ground station</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Operational</dt>
            <dd className="text-accent">{healthError || healthPending ? '—' : healthy}</dd>
          </div>
          <div>
            <dt>Attention</dt>
            <dd className={attention ? 'text-warning' : ''}>
              {healthError || healthPending ? '—' : attention}
            </dd>
          </div>
          <div>
            <dt>Offline</dt>
            <dd>{healthError || healthPending ? '—' : offline}</dd>
          </div>
        </dl>
      </div>
      <div className="workspace-section-label">
        <h2>Subsystem diagnostics</h2>
        <span>{subsystems.length} reporting</span>
      </div>
      {healthPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : healthError || subsystems.length === 0 ? (
        <div className="workspace-card">
          <EmptyState
            title={healthError ? 'Health reports could not be loaded' : 'No subsystem reports yet'}
            description="Check the ground station connection. Hardware status will appear when reports arrive."
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {subsystems.map((sub) => {
            const Icon = subsystemIcon(`${sub.id} ${sub.name}`);
            return (
              <section key={sub.id} className="workspace-card system-subsystem">
                <div className="system-subsystem-heading">
                  <span className="workspace-icon-box">
                    <Icon className="size-5" strokeWidth={1.7} />
                  </span>
                  <StatusBadge status={sub.status} />
                </div>
                <h3>{sub.name}</h3>
                <p>{sub.details}</p>
                {sub.metrics !== undefined && Object.keys(sub.metrics).length > 0 && (
                  <dl className="system-subsystem-metrics">
                    {Object.entries(sub.metrics).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key.replace(/_/g, ' ')}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="system-heartbeat">
                  <span>
                    <i />
                    Last heartbeat
                  </span>
                  <time dateTime={sub.lastHeartbeat}>{fmtTime(sub.lastHeartbeat)}</time>
                </div>
              </section>
            );
          })}
        </div>
      )}
      <div className="system-lower-grid">
        <section className="workspace-card system-event-card">
          <div className="workspace-card-heading">
            <div>
              <h2>Event stream</h2>
              <p>{activeSession?.siteName ?? 'Across available sessions'} · most recent first</p>
            </div>
            <Terminal className="size-4 text-text-muted" />
          </div>
          <div className="workspace-segmented" aria-label="Filter events by severity">
            {(['all', 'critical', 'warning', 'info'] as const).map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={severity === level}
                className={severity === level ? 'is-selected' : ''}
                onClick={() => {
                  setSeverity(level);
                }}
              >
                {level === 'all' ? 'All events' : level.charAt(0).toUpperCase() + level.slice(1)}
                <span>
                  {level === 'all'
                    ? events.length
                    : events.filter((e) => e.severity === level).length}
                </span>
              </button>
            ))}
          </div>
          {eventsPending ? (
            <Skeleton className="m-5 h-48" />
          ) : eventsError ? (
            <EmptyState
              title="Event stream unavailable"
              description="The diagnostic log could not be read. Refresh status to try again."
            />
          ) : filteredEvents.length === 0 ? (
            <EmptyState
              title={events.length === 0 ? 'No events recorded' : 'No matching events'}
              description={
                events.length === 0
                  ? 'Sensor faults, link interruptions, and sampling alerts will be recorded here.'
                  : 'Choose another severity to inspect the event stream.'
              }
            />
          ) : (
            <ol className="system-event-list" aria-live="polite">
              {filteredEvents.map((event) => (
                <li key={event.id}>
                  <span className={`system-event-icon ${SEVERITY_STYLE[event.severity] ?? ''}`}>
                    {event.severity === 'info' ? (
                      <Activity className="size-4" />
                    ) : (
                      <CircleAlert className="size-4" />
                    )}
                  </span>
                  <div>
                    <div className="system-event-meta">
                      <strong className={SEVERITY_STYLE[event.severity]}>
                        {event.code.replace(/_/g, ' ')}
                      </strong>
                      <time dateTime={event.tUtc}>{fmtDateTime(event.tUtc)}</time>
                    </div>
                    <p>{event.message}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="workspace-card">
          <div className="workspace-card-heading">
            <div>
              <h2>Telemetry snapshot</h2>
              <p>Most recent frame as received</p>
            </div>
            <Wifi className="size-4 text-text-muted" />
          </div>
          {t === null ? (
            <EmptyState
              title="Waiting for telemetry"
              description="The realtime connection has not delivered a frame. Values appear when telemetry arrives."
            />
          ) : (
            <dl className="workspace-details system-telemetry">
              <div>
                <dt>Position</dt>
                <dd>{fmtLatLon(t.position.lat, t.position.lon)}</dd>
              </div>
              <div>
                <dt>Altitude AGL</dt>
                <dd>{fmtNum(t.position.altAglM, 2, 'm')}</dd>
              </div>
              <div>
                <dt>Altitude AMSL</dt>
                <dd>{fmtNum(t.position.altAmslM, 1, 'm')}</dd>
              </div>
              <div>
                <dt>Roll / pitch / heading</dt>
                <dd>{`${fmtNum(t.rollDeg, 1)}° / ${fmtNum(t.pitchDeg, 1)}° / ${fmtNum(t.headingDeg, 0)}°`}</dd>
              </div>
              <div>
                <dt>GNSS fix</dt>
                <dd>{t.fixType?.replace(/_/g, ' ') ?? ABSENT}</dd>
              </div>
              <div>
                <dt>HDOP / satellites</dt>
                <dd>
                  {fmtNum(t.hdop, 2)} / {fmtNum(t.satellites, 0)}
                </dd>
              </div>
              <div>
                <dt>Sampling / required</dt>
                <dd className={t.isUndersampled ? 'text-warning' : ''}>
                  {fmtNum(t.achievedFps, 1)} / {fmtNum(t.requiredFps, 1)} fps
                </dd>
              </div>
              <div>
                <dt>Monotonic clock</dt>
                <dd>{t.tMonoNs === null ? ABSENT : String(t.tMonoNs)}</dd>
              </div>
              <div>
                <dt>Received frame</dt>
                <dd>{fmtDateTime(t.tUtc)}</dd>
              </div>
            </dl>
          )}
          <p className="workspace-note flex items-start gap-2">
            <Radio className="mt-0.5 size-3.5 shrink-0" />
            Read-only telemetry. Flight control stays with the aircraft operator.
          </p>
        </section>
      </div>
    </div>
  );
};
