import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleDot,
  Layers3,
  RefreshCw,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useDetections } from '../hooks/useDetections';
import { useSessions } from '../hooks/useSessions';
import { useDetectionClasses } from '../hooks/useSystem';
import { TOKENS } from '../styles/tokens';
import { fmtCount, fmtElapsedMs, fmtDateTime } from '../lib/formatters';
import '../styles/workspace.css';

const tooltipStyle = {
  contentStyle: {
    backgroundColor: TOKENS.surfaces.surfaceElevated,
    borderColor: TOKENS.borders.border,
    borderRadius: 8,
    color: TOKENS.text.primary,
    fontSize: 12,
  },
  itemStyle: { color: TOKENS.text.primary },
};

export const AnalyticsPage: React.FC = () => {
  const [sessionId, setSessionId] = useState('all');
  const [period, setPeriod] = useState('all');
  const [referenceTime] = useState(() => Date.now());
  const { detections: register, isPending, isError, refetch, isFetching } = useDetections();
  const { sessions, isError: sessionsError } = useSessions();
  const { data: classes = [] } = useDetectionClasses();
  const selectedSessions = useMemo(
    () => sessions.filter((s) => sessionId === 'all' || s.id === sessionId),
    [sessions, sessionId],
  );
  const cutoff = period === 'all' ? 0 : referenceTime - Number(period) * 86_400_000;
  const detections = useMemo(
    () =>
      register.filter(
        (d) =>
          (sessionId === 'all' || d.sessionId === sessionId) &&
          (cutoff === 0 || Date.parse(d.firstObservedAt) >= cutoff),
      ),
    [register, sessionId, cutoff],
  );
  const composition = useMemo(
    () => [
      {
        name: 'Confirmed',
        value: detections.filter((d) => d.classification === 'confirmed').length,
        fill: TOKENS.accent.primary,
      },
      {
        name: 'Visual only',
        value: detections.filter((d) => d.classification === 'unconfirmed_visual').length,
        fill: TOKENS.status.warning,
      },
      {
        name: 'Metal only',
        value: detections.filter((d) => d.classification === 'unresolved_metal').length,
        fill: TOKENS.text.muted,
      },
    ],
    [detections],
  );
  const byDay = useMemo(() => {
    const days = new Map<
      string,
      { day: string; confirmed: number; visual: number; metal: number }
    >();
    for (const d of detections) {
      if (!Number.isFinite(Date.parse(d.firstObservedAt))) continue;
      const date = d.firstObservedAt.slice(0, 10);
      const row = days.get(date) ?? { day: date, confirmed: 0, visual: 0, metal: 0 };
      if (d.classification === 'confirmed') row.confirmed++;
      else if (d.classification === 'unconfirmed_visual') row.visual++;
      else row.metal++;
      days.set(date, row);
    }
    return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [detections]);
  const byClass = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of detections) {
      const key = d.classId ?? 'unclassified';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts]
      .map(([id, count]) => ({
        name:
          classes.find((c) => c.id === id)?.name ?? (id === 'unclassified' ? 'Unclassified' : id),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [detections, classes]);
  const completed = selectedSessions.filter(
    (s) =>
      s.endedAt !== null &&
      Number.isFinite(Date.parse(s.startedAt)) &&
      Number.isFinite(Date.parse(s.endedAt)),
  );
  const completedMs = completed.reduce((sum, s) => {
    const duration = Date.parse(s.endedAt ?? '') - Date.parse(s.startedAt);
    return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
  const confirmedCount = composition[0]?.value ?? 0;
  const undated = detections.filter((d) => !Number.isFinite(Date.parse(d.firstObservedAt))).length;
  const reviewsKnown = detections.some((d) => d.reviewState !== null);
  const unreviewed = detections.filter((d) => d.reviewState === 'unreviewed').length;
  const highCount = detections.filter(
    (d) => d.classification === 'confirmed' && d.riskBand === 'high',
  ).length;

  return (
    <div className="workspace-page">
      <PageHeader
        eyebrow="Intelligence / Analytics"
        title="The bigger picture."
        description="Turn recorded observations into a sharper understanding of every survey."
        actions={
          <Button
            icon={<RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />}
            onClick={() => {
              void refetch();
            }}
            disabled={isFetching}
          >
            Refresh data
          </Button>
        }
      />
      <div className="workspace-toolbar">
        <div className="flex items-center gap-2 text-[13px] text-text-secondary">
          <BarChart3 className="size-4 text-accent" />
          <span>Observation analysis</span>
          <span className="workspace-count">{fmtCount(detections.length)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="workspace-select">
            <Layers3 className="size-4" />
            <select
              aria-label="Analytics session"
              value={sessionId}
              onChange={(e) => {
                setSessionId(e.target.value);
              }}
            >
              <option value="all">All sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.siteName}
                </option>
              ))}
            </select>
            <ChevronDown className="size-3" />
          </label>
          <label className="workspace-select">
            <CalendarDays className="size-4" />
            <select
              aria-label="Observation date range"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
              }}
            >
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="7">Last 7 days</option>
            </select>
            <ChevronDown className="size-3" />
          </label>
        </div>
      </div>
      {isError ? (
        <div className="workspace-card">
          <EmptyState
            title="Analytics could not be loaded"
            description="The detection register is unavailable. Reconnect to the ground station and refresh to try again."
          />
        </div>
      ) : isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-80 md:col-span-2" />
        </div>
      ) : (
        <>
          <div className="workspace-stats">
            <div className="workspace-stat">
              <span>
                Total observations <Layers3 className="size-4" />
              </span>
              <strong>{fmtCount(detections.length)}</strong>
              <small>Within the selected scope</small>
            </div>
            <div className="workspace-stat">
              <span>
                Confirmed detections <CircleDot className="size-4 text-accent" />
              </span>
              <strong>{fmtCount(confirmedCount)}</strong>
              <small>
                <span className={highCount ? 'text-risk-high' : ''}>
                  {fmtCount(highCount)} high risk
                </span>{' '}
                · visual + metal evidence
              </small>
            </div>
            <div className="workspace-stat">
              <span>
                Awaiting review <ArrowUpRight className="size-4" />
              </span>
              <strong>{reviewsKnown ? fmtCount(unreviewed) : '—'}</strong>
              <small>Observations yet to be reviewed</small>
            </div>
            <div className="workspace-stat">
              <span>
                Recorded session time <CalendarDays className="size-4" />
              </span>
              <strong className="workspace-stat-time">
                {sessionsError || completed.length === 0 ? '—' : fmtElapsedMs(completedMs)}
              </strong>
              <small>All dates · completed sessions in scope</small>
            </div>
          </div>
          {detections.length === 0 ? (
            <div className="workspace-card">
              <EmptyState
                title="No observations in this view"
                description="Choose a different session or date range. Charts will appear as observations are recorded."
              />
            </div>
          ) : (
            <>
              <div className="analytics-primary-grid">
                <section className="workspace-card">
                  <div className="workspace-card-heading">
                    <div>
                      <h2>Observation activity</h2>
                      <p>New observations by reported date · UTC</p>
                      {undated > 0 && (
                        <p>
                          {undated}{' '}
                          {undated === 1
                            ? 'observation without a reported date'
                            : 'observations without a reported date'}
                          ; excluded from this timeline.
                        </p>
                      )}
                    </div>
                    <span className="workspace-kicker">
                      {byDay.length} active {byDay.length === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                  <div
                    className="analytics-chart"
                    role="img"
                    aria-label={`Daily observation counts across ${byDay.length} active days. ${confirmedCount} confirmed observations, ${composition[1]?.value ?? 0} visual-only, ${composition[2]?.value ?? 0} metal-only.`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={byDay}
                        barSize={byDay.length > 20 ? 12 : 26}
                        margin={{ top: 16, right: 4, left: -24, bottom: 0 }}
                      >
                        <CartesianGrid
                          stroke={TOKENS.borders.border}
                          strokeDasharray="3 5"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="day"
                          tickFormatter={(date: string) =>
                            new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              timeZone: 'UTC',
                            })
                          }
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: TOKENS.text.muted, fontSize: 11 }}
                          dy={8}
                          minTickGap={30}
                        />
                        <YAxis
                          allowDecimals={false}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: TOKENS.text.muted, fontSize: 11 }}
                        />
                        <Tooltip
                          {...tooltipStyle}
                          cursor={{ fill: TOKENS.surfaces.surfaceHover }}
                        />
                        <Bar
                          dataKey="confirmed"
                          name="Confirmed"
                          stackId="observations"
                          fill={TOKENS.accent.primary}
                        />
                        <Bar
                          dataKey="visual"
                          name="Visual only"
                          stackId="observations"
                          fill={TOKENS.status.warning}
                        />
                        <Bar
                          dataKey="metal"
                          name="Metal only"
                          stackId="observations"
                          fill={TOKENS.text.muted}
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="workspace-chart-legend">
                    {composition.map((c) => (
                      <span key={c.name}>
                        <i style={{ backgroundColor: c.fill }} />
                        {c.name}
                      </span>
                    ))}
                  </div>
                </section>
                <section className="workspace-card">
                  <div className="workspace-card-heading">
                    <div>
                      <h2>Evidence composition</h2>
                      <p>How observations were classified</p>
                    </div>
                  </div>
                  <div
                    className="analytics-donut"
                    role="img"
                    aria-label={composition.map((c) => `${c.name}: ${c.value}`).join(', ')}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={composition}
                          dataKey="value"
                          innerRadius={75}
                          outerRadius={92}
                          paddingAngle={3}
                          stroke="none"
                        />
                        <Tooltip {...tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="analytics-donut-label">
                      <strong>{fmtCount(detections.length)}</strong>
                      <span>observations</span>
                    </div>
                  </div>
                  <div className="analytics-composition">
                    {composition.map((c) => (
                      <div key={c.name}>
                        <span>
                          <i style={{ backgroundColor: c.fill }} />
                          {c.name}
                        </span>
                        <strong>{fmtCount(c.value)}</strong>
                        <small>{Math.round((c.value / detections.length) * 100)}%</small>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <section className="workspace-card">
                  <div className="workspace-card-heading">
                    <div>
                      <h2>Model class distribution</h2>
                      <p>Labels from the detection class catalog</p>
                    </div>
                    <span className="workspace-count">{byClass.length}</span>
                  </div>
                  <div className="analytics-class-list">
                    {byClass.map((row, index) => (
                      <div key={row.name}>
                        <span className="workspace-rank">{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <span>{row.name}</span>
                            <strong>{fmtCount(row.count)}</strong>
                          </div>
                          <div className="analytics-class-track">
                            <span
                              style={{
                                width: `${(row.count / Math.max(byClass[0]?.count ?? 1, 1)) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="workspace-card">
                  <div className="workspace-card-heading">
                    <div>
                      <h2>Stored risk bands</h2>
                      <p>Confirmation and risk are separate attributes</p>
                    </div>
                  </div>
                  <div className="analytics-risk-list">
                    {(
                      [
                        {
                          key: 'high',
                          label: 'High risk',
                          cls: 'text-risk-high',
                          bg: 'bg-risk-high',
                        },
                        {
                          key: 'medium',
                          label: 'Medium risk',
                          cls: 'text-risk-medium',
                          bg: 'bg-risk-medium',
                        },
                        { key: 'low', label: 'Low risk', cls: 'text-risk-low', bg: 'bg-risk-low' },
                      ] as const
                    ).map((band) => {
                      const confirmedBand = detections.filter(
                        (d) => d.classification === 'confirmed' && d.riskBand === band.key,
                      ).length;
                      const unconfirmedBand = detections.filter(
                        (d) => d.classification !== 'confirmed' && d.riskBand === band.key,
                      ).length;
                      const count = confirmedBand + unconfirmedBand;
                      return (
                        <div key={band.key}>
                          <span className={`workspace-risk-dot ${band.bg}`} />
                          <span className={band.cls}>{band.label}</span>
                          <strong>{fmtCount(count)}</strong>
                          <small>
                            {confirmedBand} confirmed · {unconfirmedBand} unconfirmed
                          </small>
                        </div>
                      );
                    })}
                  </div>
                  <p className="workspace-note">
                    Stored risk bands apply independently of confirmation. A missing band remains
                    unknown.{' '}
                    {detections.filter(
                      (d) => d.classification === 'confirmed' && d.riskBand === null,
                    ).length > 0 &&
                      `${detections.filter((d) => d.classification === 'confirmed' && d.riskBand === null).length} confirmed observations have no reported band.`}
                  </p>
                  <Link to="/detections" className="workspace-inline-link">
                    Open detection register <ArrowUpRight className="size-4" />
                  </Link>
                </section>
              </div>
            </>
          )}
          <section className="workspace-card">
            <div className="workspace-card-heading">
              <div>
                <h2>Session breakdown</h2>
                <p>Observation totals follow the selected date range</p>
              </div>
              <Link to="/sessions" className="workspace-inline-link">
                View sessions <ArrowUpRight className="size-4" />
              </Link>
            </div>
            {sessionsError ? (
              <p className="workspace-note">
                The session register is unavailable. Observation charts remain available.
              </p>
            ) : (
              <div className="workspace-table-wrap">
                <table className="workspace-table">
                  <thead>
                    <tr>
                      <th>Survey session</th>
                      <th>Started</th>
                      <th>Observations</th>
                      <th>Confirmed</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSessions.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link to={`/sessions/${s.id}`} className="font-medium text-text-primary">
                            {s.siteName}
                          </Link>
                          <small>{s.id.slice(-10).toUpperCase()}</small>
                        </td>
                        <td>{fmtDateTime(s.startedAt)}</td>
                        <td>{detections.filter((d) => d.sessionId === s.id).length}</td>
                        <td>
                          {
                            detections.filter(
                              (d) => d.sessionId === s.id && d.classification === 'confirmed',
                            ).length
                          }
                        </td>
                        <td>
                          <span
                            className={`workspace-state ${s.state === 'active' ? 'text-accent' : ''}`}
                          >
                            {s.state}
                          </span>
                        </td>
                        <td>
                          <Link
                            to={`/sessions/${s.id}`}
                            aria-label={`Open ${s.siteName}`}
                            className="workspace-icon-link"
                          >
                            <ArrowUpRight className="size-4" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedSessions.length === 0 && (
                  <p className="workspace-note">No sessions recorded.</p>
                )}
              </div>
            )}
          </section>
        </>
      )}
      <p className="workspace-footnote">
        Counts describe recorded observations, not ground examined. Coverage is not a measure of
        land release.
      </p>
    </div>
  );
};
