import { useLiveCsvTelemetry } from '../hooks/useLiveCsvTelemetry';
import { Panel } from '../components/ui/Panel';
import { ABSENT, fmtNum } from '../lib/formatters';
import { Activity, Clock3, FileText } from 'lucide-react';

/**
 * Live preview: a monitoring view over the telemetry CSV the MAVLink logger
 * writes. Every CSV column is shown with its live value, the update rate, and
 * a rolling change log — a quick way to verify what is updating before or
 * during a flight. Works with the full backend (start_terravigil.py) and with
 * the Vite dev server alone (npm run dev preview).
 */
export function LivePreviewPage() {
  const live = useLiveCsvTelemetry();
  const fields = live.data?.fields ?? {};
  const changed = new Set(live.lastChanges.map((change) => change.field));
  const ageSeconds =
    live.data?.age_ms != null ? Math.max(0, Math.round(live.data.age_ms / 1000)) : null;

  return (
    <div className="live-preview-page" style={{ padding: 22, display: 'grid', gap: 18 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span
          aria-hidden="true"
          className={`ops-live-dot ${live.isStreaming ? 'is-live' : live.isStale ? 'is-stale' : ''}`}
          style={{ display: 'inline-block' }}
        />
        <h1 className="type-section-heading" style={{ margin: 0 }}>
          Live preview
        </h1>
        <span className="font-mono text-[11px] text-text-muted">
          {live.isError
            ? 'Endpoint unreachable — is the backend or dev server running?'
            : live.data?.state === 'live'
              ? `streaming · updated ${ageSeconds ?? 0}s ago`
              : (live.data?.message ?? 'Waiting for telemetry…')}
        </span>
        <span className="ml-auto font-mono text-[11px] text-text-muted">
          {live.rowsPerSecond != null ? `${fmtNum(live.rowsPerSecond, 1)} rows/s` : 'measuring rate…'}
        </span>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
        <Panel title="CSV source">
          <dl className="live-preview-facts" style={{ display: 'grid', gap: 8, fontSize: 11 }}>
            <Fact label="Path" value={live.data?.csv_path ?? ABSENT} mono />
            <Fact label="Size" value={live.data?.csv_size_bytes != null ? `${(live.data.csv_size_bytes / 1024 / 1024).toFixed(2)} MB` : ABSENT} />
            <Fact label="Rows in tail window" value={live.data?.tail_rows != null ? String(live.data.tail_rows) : ABSENT} />
            <Fact label="Last modified" value={live.data?.csv_mtime ?? ABSENT} mono />
            <Fact label="Newest row timestamp" value={live.data?.timestamp ?? ABSENT} mono />
          </dl>
        </Panel>
        <Panel title="Update health">
          <dl className="live-preview-facts" style={{ display: 'grid', gap: 8, fontSize: 11 }}>
            <Fact label="State" value={live.data?.state ?? ABSENT} />
            <Fact label="Age of newest row" value={ageSeconds != null ? `${ageSeconds} s` : ABSENT} />
            <Fact label="Streaming" value={live.isStreaming ? 'yes' : live.isStale ? 'stale' : 'no'} />
            <Fact label="Update rate" value={live.rowsPerSecond != null ? `${fmtNum(live.rowsPerSecond, 1)} rows/s` : ABSENT} />
            <Fact label="GPS position valid" value={live.data?.latitude_valid ? 'yes' : 'no'} />
          </dl>
        </Panel>
      </div>

      <Panel
        title="CSV columns (live)"
        headerRight={
          <span className="font-mono text-[10px] text-text-muted">
            {Object.keys(fields).length} columns
          </span>
        }
      >
        {Object.keys(fields).length === 0 ? (
          <p className="p-5 text-text-muted text-xs">
            No telemetry rows yet. Values appear here within a second of the MAVLink logger
            appending to the CSV.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap: 10,
              padding: 14,
            }}
          >
            {Object.entries(fields).map(([column, value]) => (
              <div
                key={column}
                style={{
                  border: '1px solid rgb(var(--color-border))',
                  padding: '9px 11px',
                  borderRadius: 4,
                  minWidth: 0,
                  background: changed.has(column) ? 'rgb(var(--color-accent) / 8%)' : undefined,
                }}
              >
                <span
                  className="block text-[9px] text-text-muted"
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {column}
                </span>
                <span
                  className="block mt-1.5 text-[13px] text-text-primary"
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {value === '' ? ABSENT : value}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Change log" headerRight={<Activity size={14} className="text-text-muted" />}>
        {live.lastChanges.length === 0 ? (
          <p className="p-5 text-text-muted text-xs">
            Field changes appear here as the CSV updates. Append rows to the telemetry CSV (or
            connect the Pixhawk via Mission Planner) to see this fill up.
          </p>
        ) : (
          <ul style={{ padding: '6px 14px 14px', margin: 0, listStyle: 'none' }}>
            {live.lastChanges
              .slice()
              .reverse()
              .map((change, index) => (
                <li
                  key={`${change.field}-${index}`}
                  className="font-mono text-[10px]"
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '5px 0',
                    borderBottom: '1px solid rgb(var(--color-border) / 50%)',
                  }}
                >
                  <span className="text-text-muted" style={{ minWidth: 150, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Clock3 size={10} />
                    {change.field}
                  </span>
                  <span className="text-text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {change.from}
                  </span>
                  <span className="text-accent">→</span>
                  <span className="text-text-primary" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {change.to}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Panel>

      <p className="text-[10px] text-text-muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <FileText size={12} />
        Read-only view of the telemetry CSV. Nothing here writes to Firebase or the database.
      </p>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, minWidth: 0 }}>
      <dt className="text-text-muted">{label}</dt>
      <dd
        className="text-text-primary"
        style={{
          margin: 0,
          fontFamily: mono ? "'IBM Plex Mono', monospace" : undefined,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </dd>
    </div>
  );
}
