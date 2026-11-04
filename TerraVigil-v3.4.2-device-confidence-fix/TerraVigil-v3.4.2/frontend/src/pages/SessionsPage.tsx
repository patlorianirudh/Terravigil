import { config } from '../config';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  MapPin,
  Plus,
  Radio,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useSessions } from '../hooks/useSessions';
import { ABSENT, fmtDateTime, fmtDuration, fmtShortId } from '../lib/formatters';
import type { FlightMode, SessionState } from '../domain/types';
import '../styles/evidence.css';

const STATE_LABEL: Record<string, string> = {
  created: 'Created',
  active: 'Recording',
  ended: 'Completed',
  aborted: 'Aborted',
};

export const SessionsPage: React.FC = () => {
  const navigate = useNavigate();
  const missionBackend = config.dataMode === 'live' && config.backendStyle === 'missions';
  const { sessions, createSession, isCreating, isPending, isError, error } = useSessions();
  const [formOpen, setFormOpen] = useState(false);
  const [siteName, setSiteName] = useState('');
  const [flightMode, setFlightMode] = useState<FlightMode>('rc_manual');
  const [notes, setNotes] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<SessionState | 'all'>('all');
  const modal = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = sessions.find((session) => session.state === 'active');
  const rows = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            (stateFilter === 'all' || session.state === stateFilter) &&
            `${session.siteName} ${session.id} ${session.notes}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [sessions, stateFilter, search],
  );

  useEffect(() => {
    if (!formOpen) return;
    const triggerElement = trigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.current?.querySelector<HTMLInputElement>('#site-name')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isCreating) setFormOpen(false);
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        modal.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, [tabindex="0"]',
        ) ?? [],
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      triggerElement?.focus();
    };
  }, [formOpen, isCreating]);

  const handleCreate = async (event: React.SyntheticEvent): Promise<void> => {
    event.preventDefault();
    if (!siteName.trim()) {
      setCreateError('Enter a site or sector name to identify this survey.');
      return;
    }
    setCreateError(null);
    try {
      // The mission backend stores location and status; other fields stay unknown.
      await createSession({
        siteName: siteName.trim(),
        flightMode,
        notes: notes.trim(),
        config: {},
      });
      setFormOpen(false);
      setSiteName('');
      setNotes('');
      navigate('/live');
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'The session could not be started.');
    }
  };
  const startForm = () => {
    setCreateError(null);
    setFormOpen(true);
  };
  return (
    <div className="ev-page">
      <PageHeader
        eyebrow="Operations / Session archive"
        title="Your fieldwork, connected."
        description="A complete record of each survey, its evidence and the decisions that followed."
        actions={
          <>
            <Button
              ref={trigger}
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={startForm}
            >
              New scan session
            </Button>
          </>
        }
      />
      <div className="ev-archive-overview">
        <div className="ev-archive-intro">
          <span className="ev-kicker">Field operations</span>
          <h2>
            From first pass
            <br />
            to final record.
          </h2>
          <p>
            Every session preserves its own configuration and sensor evidence for a traceable survey
            history.
          </p>
        </div>
        <div className="ev-archive-numbers">
          <div>
            <span className="ev-kicker">Total sessions</span>
            <strong>
              {isPending || isError ? ABSENT : String(sessions.length).padStart(2, '0')}
            </strong>
            <Archive size={18} />
          </div>
          <div>
            <span className="ev-kicker">Completed</span>
            <strong>
              {isPending || isError
                ? ABSENT
                : String(sessions.filter((s) => s.state === 'ended').length).padStart(2, '0')}
            </strong>
            <Clock3 size={18} />
          </div>
          <div>
            <span className="ev-kicker">Recording now</span>
            <strong className="text-accent">
              {isPending || isError
                ? ABSENT
                : String(sessions.filter((s) => s.state === 'active').length).padStart(2, '0')}
            </strong>
            <Radio size={18} />
          </div>
        </div>
      </div>
      {current && (
        <div className="ev-current-session">
          <div className="ev-live-indicator">
            <Radio size={21} />
          </div>
          <div>
            <span className="ev-kicker">Session in progress</span>
            <h3>{current.siteName}</h3>
            <p>
              {current.flightMode === null
                ? 'Flight mode unreported'
                : current.flightMode === 'rc_manual'
                  ? 'RC manual piloting'
                  : 'ArduPilot auto'}{' '}
              <span aria-hidden>·</span> Started {fmtDateTime(current.startedAt)}
            </p>
          </div>
          <Button
            variant="secondary"
            icon={<ArrowUpRight size={16} />}
            onClick={() => navigate(`/sessions/${current.id}`)}
          >
            View session
          </Button>
        </div>
      )}
      <section className="ev-register" aria-label="Session archive">
        <div className="ev-register-heading">
          <div>
            <span className="ev-kicker">The operational record</span>
            <h2>
              All scan sessions <span className="ev-heading-count">{sessions.length}</span>
            </h2>
          </div>
        </div>
        <div className="ev-toolbar">
          <div className="ev-search">
            <Search size={17} />
            <input
              type="search"
              aria-label="Search sessions"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              placeholder="Search sites, session IDs or field notes…"
            />
          </div>
          <label className="ev-select-wrap">
            <SlidersHorizontal size={15} />
            <span className="sr-only">Session status</span>
            <select
              value={stateFilter}
              onChange={(event) => {
                setStateFilter(event.target.value as SessionState | 'all');
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Recording</option>
              <option value="ended">Completed</option>
              <option value="created">Created</option>
              <option value="aborted">Aborted</option>
            </select>
          </label>
        </div>
        {isPending && (
          <div className="ev-loading">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {!isPending && isError && (
          <EmptyState
            title="Sessions unavailable"
            description={
              error instanceof Error ? error.message : 'The session archive could not be read.'
            }
          />
        )}
        {!isPending && !isError && rows.length === 0 && (
          <div className="ev-empty">
            <EmptyState
              title={sessions.length ? 'No sessions match' : 'Your first survey starts here'}
              description={
                sessions.length
                  ? 'Try a different site name or status filter.'
                  : 'Create a scan session to begin recording your survey observations.'
              }
            />
            {!sessions.length && (
              <Button variant="primary" icon={<Plus size={16} />} onClick={startForm}>
                New scan session
              </Button>
            )}
          </div>
        )}
        {!isPending && !isError && rows.length > 0 && (
          <ul className="ev-session-list">
            {rows.map((session, index) => (
              <li key={session.id}>
                <button
                  className="ev-session-row"
                  onClick={() => navigate(`/sessions/${session.id}`)}
                >
                  <span className="ev-session-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="ev-session-name">
                    <span className="ev-kicker">{fmtShortId(session.id, 18)}</span>
                    <strong>{session.siteName}</strong>
                    <span>{session.notes || 'No field notes recorded.'}</span>
                  </span>
                  <span className="ev-session-time">
                    <span>
                      <Clock3 size={14} />
                      {fmtDateTime(session.startedAt)}
                    </span>
                    <span>
                      {session.endedAt === null && session.state !== 'active'
                        ? ABSENT
                        : fmtDuration(session.startedAt, session.endedAt)}{' '}
                      elapsed
                    </span>
                  </span>
                  <span className="ev-session-mode">
                    <span>
                      <MapPin size={14} />
                      {session.utmEpsg === null
                        ? 'Projection unavailable'
                        : `EPSG:${session.utmEpsg}`}
                    </span>
                    <span>
                      {session.flightMode === null
                        ? 'Flight mode unreported'
                        : session.flightMode === 'rc_manual'
                          ? 'RC manual'
                          : 'ArduPilot auto'}
                    </span>
                  </span>
                  <span className={`ev-status-pill ${session.state}`}>
                    <i />
                    {STATE_LABEL[session.state] ?? session.state}
                  </span>
                  <ArrowUpRight className="ev-session-arrow" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <footer className="ev-table-footer">
          <span>
            {rows.length} of {sessions.length} sessions
          </span>
          <span className="ev-subtle">Ordered by most recent survey</span>
        </footer>
      </section>
      <p className="ev-footnote">
        <span className="ev-mini-dot" />
        Session thresholds are frozen at creation. Flight control remains with the pilot and
        ArduPilot.
      </p>
      {formOpen && (
        <div
          className="ev-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isCreating) setFormOpen(false);
          }}
        >
          <div
            ref={modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-session-title"
            aria-describedby="new-session-description"
            className="ev-modal"
          >
            <header>
              <div>
                <span className="ev-kicker">Prepare to observe</span>
                <h2 id="new-session-title">New scan session</h2>
              </div>
              <button
                className="ev-icon-link"
                aria-label="Close new session"
                disabled={isCreating}
                onClick={() => {
                  setFormOpen(false);
                }}
              >
                <X size={20} />
              </button>
            </header>
            <p id="new-session-description">
              {missionBackend
                ? 'Give this mission a location. The connected backend stores location and status; flight mode, notes and sensor configuration are not saved.'
                : 'Give this survey a name. Reported sensor configuration is recorded with the session.'}
            </p>
            <form
              onSubmit={(event) => {
                void handleCreate(event);
              }}
              className="ev-form"
            >
              <label htmlFor="site-name">
                Site or sector name <span>Required</span>
              </label>
              <input
                id="site-name"
                type="text"
                required
                maxLength={120}
                value={siteName}
                onChange={(event) => {
                  setSiteName(event.target.value);
                }}
                placeholder="e.g. Northern perimeter · Sector 04"
                className="field"
              />
              <label htmlFor="flight-mode">Flight mode</label>
              <select
                id="flight-mode"
                disabled={missionBackend}
                value={flightMode}
                onChange={(event) => {
                  setFlightMode(event.target.value as FlightMode);
                }}
                className="field"
              >
                <option value="rc_manual">RC manual piloting</option>
                <option value="ardupilot_auto">ArduPilot auto survey grid</option>
              </select>
              <p className="ev-form-help">
                Records the external flight mode. This application does not send flight commands.
              </p>
              <label htmlFor="session-notes">
                Field notes <span>Optional</span>
              </label>
              <textarea
                id="session-notes"
                disabled={missionBackend}
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                }}
                rows={4}
                placeholder="Terrain, expected target types, soil conditions…"
                className="field"
              />
              {createError && (
                <p role="alert" className="ev-error">
                  {createError}
                </p>
              )}
              <footer>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isCreating}
                  onClick={() => {
                    setFormOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isCreating}
                  icon={<ArrowRight size={16} />}
                >
                  {isCreating ? 'Starting session…' : 'Start session'}
                </Button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
