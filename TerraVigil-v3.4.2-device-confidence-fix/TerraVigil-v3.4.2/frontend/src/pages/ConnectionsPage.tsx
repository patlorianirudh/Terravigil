import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Cloud, MapPin, Radio, RefreshCw } from 'lucide-react';
import { bridgeApi, bridgeEvidenceId } from '../services/bridge';
import { api } from '../services/api';
import { useSessionStore } from '../state/sessionStore';
import { Button } from '../components/ui/Button';
import '../styles/connections.css';

const labels: Record<string, string> = {
  connected: 'Firebase connected',
  connecting: 'Connecting',
  needs_setup: 'Add your credential file',
  stopped: 'Not started',
  disabled: 'Disabled',
  error: 'Connection needs attention',
  matched: 'Mapped',
  outside_tolerance: 'Time gap too large',
  waiting_for_telemetry: 'Waiting for GPS',
  invalid_timestamp: 'Check timestamp',
  invalid_record: 'Check record',
  removed: 'Removed at source',
};
const utc = (value?: string | null) =>
  value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC') : 'Not received';

export function ConnectionsPage() {
  const navigate = useNavigate();
  const [actionError, setActionError] = useState('');
  const status = useQuery({
    queryKey: ['bridge-status'],
    queryFn: bridgeApi.status,
    refetchInterval: 3000,
  });
  const connection = status.data;
  const missionId = connection?.mission_id;
  const records = useQuery({
    queryKey: ['bridge-events', missionId],
    queryFn: () => bridgeApi.events(missionId),
    enabled: !!missionId,
    refetchInterval: 3000,
  });
  const restart = useMutation({
    mutationFn: bridgeApi.restart,
    onSuccess: () => {
      void status.refetch();
    },
  });
  async function openMission(destination: string, eventId?: string) {
    setActionError('');
    try {
      if (!missionId) return;
      const mission = await api.getSession(missionId);
      if (!mission)
        throw new Error(
          'This mission has no imported data yet. Check Firebase and wait for telemetry records.',
        );
      const store = useSessionStore.getState();
      store.setSessions([...store.sessions.filter((row) => row.id !== mission.id), mission]);
      const query = new URLSearchParams({ mission: missionId });
      if (eventId) query.set('detection', bridgeEvidenceId(missionId, eventId));
      navigate(`${destination}?${query.toString()}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not open mission.');
    }
  }
  const rows = records.data ?? [];
  const counts = connection?.counts;
  return (
    <div className="connections-page">
      <header className="connections-header">
        <div>
          <p className="type-eyebrow">{connection?.test_mode ? 'REAL FIREBASE · TEST IMAGES' : 'AUTOMATIC CAPTURE WORKFLOW'}</p>
          <h1>Firebase &amp; telemetry</h1>
          <p>New captures are matched to Pixhawk GPS and added to the map automatically.</p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={15} />}
          disabled={restart.isPending}
          onClick={() => {
            restart.mutate();
          }}
        >
          {restart.isPending ? 'Reconnecting…' : 'Reconnect'}
        </Button>
      </header>
      {(status.isError || records.isError || restart.isError || actionError) && (
        <p role="alert" className="connection-error">
          {actionError ||
            (restart.error?.message ??
              'Could not refresh the connection. Check the backend terminal and retry.')}
        </p>
      )}
      <section className="connection-flow" aria-label="Detection to map workflow">
        <div>
          <Cloud />
          <span>01 / Firebase</span>
          <strong>{labels[connection?.state ?? ''] ?? 'Checking connection…'}</strong>
          <p>{connection?.config?.database_path ?? 'detections'}</p>
        </div>
        <ArrowRight className="flow-arrow" />
        <div>
          <Radio />
          <span>02 / Telemetry CSV</span>
          <strong>
            {connection?.telemetry?.valid_rows
              ? `${connection.telemetry.valid_rows.toLocaleString()} valid GPS samples`
              : connection?.telemetry?.rows ? 'CSV received · no usable GPS' : 'Waiting for telemetry'}
          </strong>
          <p>{connection?.config?.max_gap_seconds ?? 2} second maximum time gap</p>
        </div>
        <ArrowRight className="flow-arrow" />
        <div>
          <MapPin />
          <span>03 / Map</span>
          <strong>{connection?.counts.matched ?? 0} matched detections</strong>
          <p>Aircraft position at image capture</p>
        </div>
      </section>
      <div className="connection-status">
        <i className={connection?.state === 'connected' ? 'is-connected' : ''} />
        <div>
          <strong>{connection?.message ?? 'Reading backend connection status…'}</strong>
          <small>Last successful Firebase read: {utc(connection?.last_sync)}</small>
        </div>
      </div>
      {!!connection?.telemetry?.rows && connection.telemetry.valid_rows === 0 && (
        <section className="connection-card" role="status">
          <h2>Telemetry is arriving without a usable position</h2>
          <p>
            {connection.telemetry.rows.toLocaleString()} rows read ·{' '}
            {connection.telemetry.rejection_reasons?.zero_coordinates ?? 0} with (0, 0) coordinates ·{' '}
            {connection.telemetry.rejection_reasons?.missing_coordinates ?? 0} with missing coordinates.
          </p>
          <p>Wait for a fresh 3D GPS fix in Mission Planner. New captures will map automatically when valid GPS exists at their capture time.</p>
          <small>Latest CSV record: {utc(connection.telemetry.last_record_timestamp)}. Old captures still require telemetry from the same time.</small>
        </section>
      )}
      <div className="connection-two-column">
        <section className="connection-card">
          <p className="type-eyebrow">FIRST RUN</p>
          <h2>Connect in three steps</h2>
          <ol>
            <li>
              Place <code>serviceAccountKey.json</code> in the app’s <code>backend</code> folder.
            </li>
            <li>
              Run <code>python start_terravigil.py --setup</code> once.
            </li>
            <li>
              Run <code>python start_terravigil.py</code> for live telemetry, or add <code>--mode test</code> to send three images through real Firebase without a drone.
            </li>
          </ol>
          <details>
            <summary>Files and timestamp settings</summary>
            <dl>
              <dt>Credential</dt>
              <dd>
                {connection?.config?.credentials_present
                  ? 'File found on backend'
                  : 'File not found'}
              </dd>
              <dt>Telemetry CSV</dt>
              <dd>
                <code>
                  {connection?.config?.csv_path ?? 'telemetry/DroneTelemetry/telemetry.csv'}
                </code>
              </dd>
              <dt>Image folder</dt>
              <dd>
                <code>{connection?.config?.image_directory ?? 'images'}</code>
              </dd>
              <dt>Timezone for bare Firebase timestamps</dt>
              <dd>{connection?.config?.detection_timezone ?? 'Asia/Kolkata'}</dd>
              <dt>Detection clock correction</dt>
              <dd>{connection?.config?.clock_offset_seconds ?? 0} seconds</dd>
              <dt>Valid GPS time range (UTC)</dt>
              <dd>
                {utc(connection?.telemetry?.first_timestamp)} to{' '}
                {utc(connection?.telemetry?.last_timestamp)}
              </dd>
            </dl>
            <p>
              Explicit timestamp offsets take priority. Use image capture time, keep the camera and
              ground computer clocks synchronized, and change settings in <code>backend/.env</code>{' '}
              before restarting the app.
            </p>
          </details>
        </section>
        <section className="connection-card">
          <Radio />
          <p className="type-eyebrow">CAMERA DETECTIONS</p>
          <h2>Raspberry Pi Camera Module 2 · CSI</h2>
          <p>
            Your onboard model sends the image path and capture timestamp to Firebase. Pixhawk GPS
            arrives through Mission Planner and the telemetry logger.
          </p>
          <p>
            Use the image capture timestamp with a UTC offset. The app downloads photos from Firebase Storage or an allowed HTTPS URL, or copies files arriving in the configured image folder. Each copy gets a unique capture-time filename; originals are preserved.
          </p>
          <small>Filename-only records need the image file transferred from the camera. The timestamp field controls GPS matching.</small>
        </section>
      </div>
      <section className="connection-card connection-register">
        <div className="connection-register-header">
          <div>
            <p className="type-eyebrow">DETECTION INBOX</p>
            <h2>Firebase detections · newest capture first</h2>
          </div>
          <div className="connection-actions">
            <Button
              variant="secondary"
              onClick={() => {
                void openMission('/risk-map');
              }}
              disabled={!rows.some((r) => r.status === 'matched')}
            >
              Open map <ArrowRight size={14} />
            </Button>
          </div>
        </div>
        <div className="connection-counts">
          <span>
            <strong>{counts?.total ?? 0}</strong> received
          </span>
          <span>
            <strong>{counts?.matched ?? 0}</strong> mapped
          </span>
          <span>
            <strong>{counts?.pending ?? 0}</strong> waiting for a match
          </span>
          <span>
            <strong>{counts?.invalid ?? 0}</strong> invalid
          </span>
        </div>
        <div className="connection-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Detection</th>
                <th>Capture time / image</th>
                <th>GPS match</th>
                <th>Time difference</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.event_id}>
                  <td>
                    <strong>{row.status === 'invalid_record' ? 'Invalid record' : (['camera', 'metal', 'metal_detector'].includes(row.device?.trim().toLowerCase() ?? '') ? 'Landmine' : (row.class_name ?? 'Class not supplied'))}</strong>
                    <small>{row.firebase_id}</small>
                    {(['camera', 'metal', 'metal_detector'].includes(row.device?.trim().toLowerCase() ?? '')) && (
                      <small>Source: {row.device?.trim().toLowerCase() === 'metal' || row.device?.trim().toLowerCase() === 'metal_detector' ? 'Metal detector' : 'Camera'}</small>
                    )}
                    <small>
                      {row.confidence_percent != null
                        ? `${row.confidence_percent.toFixed(2)}% confidence${row.confidence_score == null ? '' : ` · score ${row.confidence_score.toFixed(4)}`}`
                        : row.confidence_score != null
                          ? `${(row.confidence_score * 100).toFixed(2)}% confidence · score ${row.confidence_score.toFixed(4)}`
                          : row.confidence == null
                            ? 'Confidence unreported'
                            : `${(row.confidence * 100).toFixed(2)}% confidence`}
                    </small>
                  </td>
                  <td>
                    <time>{String(row.timestamp_original ?? 'Missing timestamp')}</time>
                    <small>Original: {row.image_path || 'Storage / URL'}</small>
                    {row.image?.state === 'ready' ? (
                      <a className="connection-image" href={`/api/bridge/images/${row.event_id}`} target="_blank" rel="noreferrer">
                        <img src={`/api/bridge/images/${row.event_id}`} alt={row.class_name || 'Captured evidence'} loading="lazy" />
                        <span>Saved: {row.image.filename}</span>
                      </a>
                    ) : <small>{row.image?.message || 'Waiting for image file'}</small>}
                    {row.test_record && <small className="connection-test-label">TEST IMAGE · NO INFERENCE</small>}
                  </td>
                  <td>
                    <span
                      className={`connection-match ${row.status === 'matched' ? 'matched' : ''}`}
                    >
                      {row.status === 'matched' && <CheckCircle2 size={13} />}
                      {labels[row.status] ?? row.status}
                    </span>
                    <small>
                      {row.status === 'matched'
                        ? `${row.match.latitude?.toFixed(7)}, ${row.match.longitude?.toFixed(7)}`
                        : row.match.reason}
                    </small>
                  </td>
                  <td>
                    {row.match.gap_seconds == null
                      ? 'No GPS sample'
                      : `${row.match.gap_seconds.toFixed(3)} s`}
                    <small>
                      {row.match.telemetry_timestamp ? utc(row.match.telemetry_timestamp) : ''}
                    </small>
                    {row.match.gap_seconds == null && row.match.nearest_record_gap_seconds != null && (
                      <small>
                        Closest CSV row: {row.match.nearest_record_gap_seconds.toFixed(3)} s away;
                        GPS unusable. {utc(row.match.nearest_record_timestamp)}
                      </small>
                    )}
                  </td>
                  <td>
                    {row.status === 'matched' ? (
                      <button
                        className="connection-map-link"
                        onClick={() => {
                          void openMission('/risk-map', row.event_id);
                        }}
                      >
                        View on map <ArrowRight size={14} />
                      </button>
                    ) : (
                      <span className="connection-muted">Retries automatically</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="connection-empty">
            {records.isPending
              ? 'Loading detection records…'
              : 'No records imported yet. Check the connection status and credential file above.'}
          </p>
        )}
        <p className="connection-footnote">
          Only matched observations appear on the map. Visual detections remain unconfirmed. These
          markers show aircraft GPS at capture time; the object’s exact ground position is not
          measured. Up to 500 recent records are shown here.
        </p>
      </section>
      <nav className="connection-next" aria-label="Next workflow steps">
        <Link to="/detections">
          Detection register <ArrowRight size={14} />
        </Link>
        <Link to="/live">
          Live console <ArrowRight size={14} />
        </Link>
        <Link to="/reports">
          Reports <ArrowRight size={14} />
        </Link>
      </nav>
    </div>
  );
}
