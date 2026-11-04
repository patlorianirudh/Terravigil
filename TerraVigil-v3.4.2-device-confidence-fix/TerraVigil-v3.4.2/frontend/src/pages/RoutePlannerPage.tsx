import { config } from '../config';
import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Download, Route, RotateCcw } from 'lucide-react';
import { TacticalMap } from '../components/map/TacticalMap';
import { Button } from '../components/ui/Button';
import { KeyValueRow } from '../components/ui/KeyValueRow';
import { useDetections } from '../hooks/useDetections';
import { useLiveTelemetry } from '../hooks/useLiveTelemetry';
import { useTrack } from '../hooks/useTrack';
import { useSafePath } from '../hooks/useSafePath';
import { useSessionStore } from '../state/sessionStore';
import { ABSENT, fmtCount, fmtDistance, fmtLatLon, fmtNum } from '../lib/formatters';
import type { Coordinate } from '../domain/types';
import { ServiceError } from '../services/errors';

export const RoutePlannerPage: React.FC = () => {
  const activeSession = useSessionStore((s) => s.activeSession);
  // Remount planning state when the operator changes the session.
  return <RouteWorkspace key={activeSession?.id ?? 'none'} />;
};
const RouteWorkspace: React.FC = () => {
  const activeSession = useSessionStore((s) => s.activeSession);
  const { detections: receivedDetections } = useDetections(activeSession?.id);
  const detections = receivedDetections.filter((d) => d.sessionId === activeSession?.id);
  const stream = useLiveTelemetry();
  const { data: recordedTrack = [] } = useTrack(activeSession?.id);
  const sessionTrack = stream.trackHistory.filter((point) => point.sessionId === activeSession?.id);
  const trackHistory = sessionTrack.length > 0 ? sessionTrack : recordedTrack;
  const latestTelemetry =
    stream.latestTelemetry?.sessionId === activeSession?.id
      ? stream.latestTelemetry
      : (trackHistory.at(-1) ?? null);
  const { calculateSafePath, isCalculating, result, error, reset } = useSafePath();
  const [start, setStart] = useState<Coordinate | null>(null);
  const [end, setEnd] = useState<Coordinate | null>(null);
  const [minStandoff, setMinStandoff] = useState('5');
  const [cautionWeight, setCautionWeight] = useState(60);
  const validStandoff =
    minStandoff.trim() !== '' &&
    Number.isFinite(Number(minStandoff)) &&
    Number(minStandoff) >= 3.5 &&
    Number(minStandoff) <= 20;
  const unavailable = config.dataMode === 'demo' && activeSession?.isSample !== true;
  const sampleRoute = activeSession?.isSample === true ? activeSession.sampleRoute : undefined;
  const canSolve =
    !unavailable &&
    activeSession !== null &&
    start !== null &&
    end !== null &&
    (start.lat !== end.lat || start.lon !== end.lon) &&
    validStandoff &&
    !isCalculating;
  const handlePick = (position: Coordinate): void => {
    if (isCalculating) return;
    reset();
    if (start === null) setStart(position);
    else if (end === null) setEnd(position);
    else {
      setStart(position);
      setEnd(null);
    }
  };
  const handleSolve = async (): Promise<void> => {
    if (!canSolve) return;
    try {
      await calculateSafePath({
        sessionId: activeSession.id,
        start,
        end,
        minStandoffM: Number(minStandoff),
        cautionWeight: cautionWeight / 100,
      });
    } catch {
      /* The mutation's error is rendered in the result panel. */
    }
  };
  const exportRoute = (): void => {
    if (!result?.pathFound) return;
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            sessionId: result.sessionId,
            purpose: 'Minimum-risk route (planning aid)',
            disclaimer: result.disclaimer,
            minStandoffM: result.minStandoffAchievedM,
          },
          geometry: {
            type: 'LineString',
            coordinates: result.waypoints.map((point) => [point.lon, point.lat]),
          },
        },
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'terravigil-route.geojson';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="field-workspace">
      <header className="field-page-header">
        <div>
          <p className="type-eyebrow">SPATIAL INTELLIGENCE / PLANNING AID</p>
          <h1>Minimum-risk route</h1>
          <p className="field-page-subtitle">
            Evaluate a route against observed evidence.{' '}
            {activeSession?.siteName ?? 'No scan session selected.'}
          </p>
        </div>
        <span className="live-heading-status">
          <Route size={13} />
          PLANNING ONLY
        </span>
      </header>
      <div className="route-planning-notice">
        <AlertTriangle size={17} />
        <div>
          <strong>A planning aid, based on an incomplete survey</strong>
          <p>
            This route is not a cleared lane and confers no guarantee. Ground on or near it has not
            been examined to depth.
          </p>
        </div>
      </div>
      <div className="map-page-body">
        <div className="map-page-map">
          <TacticalMap
            title="Route workspace"
            subtitle="Place two endpoints"
            detections={detections}
            trackPoints={trackHistory}
            currentDronePoint={latestTelemetry}
            routeResult={result ?? null}
            endpoints={{ start, end }}
            onPickPoint={handlePick}
            visualThreshold={activeSession?.config.visualConfidenceThreshold ?? null}
            metalThreshold={activeSession?.config.metalThresholdNorm ?? null}
          />
        </div>
        <aside className="map-page-sidebar">
          <section className="map-sidebar-block">
            <div className="map-sidebar-title">
              <span>01</span>
              <h2>Set your endpoints</h2>
            </div>
            <div className="map-sidebar-content">
              <p>Click the map to place A, then B. A third click starts a new route.</p>
              {sampleRoute && (
                <Button
                  className="mb-3"
                  size="sm"
                  variant="secondary"
                  disabled={isCalculating}
                  onClick={() => {
                    setStart(sampleRoute.start);
                    setEnd(sampleRoute.end);
                    reset();
                  }}
                >
                  Use sample endpoints
                </Button>
              )}
              <div className="route-endpoint-card">
                <span>A</span>
                <div>
                  <span>Origin</span>
                  <p>{start ? fmtLatLon(start.lat, start.lon) : 'Select a point on the map'}</p>
                </div>
              </div>
              <div className="route-endpoint-card">
                <span>B</span>
                <div>
                  <span>Destination</span>
                  <p>{end ? fmtLatLon(end.lat, end.lon) : 'Select a point on the map'}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={12} />}
                disabled={isCalculating || (start === null && end === null)}
                onClick={() => {
                  setStart(null);
                  setEnd(null);
                  reset();
                }}
              >
                Reset endpoints
              </Button>
            </div>
          </section>
          <section className="map-sidebar-block">
            <div className="map-sidebar-title">
              <span>02</span>
              <h2>Set route preferences</h2>
            </div>
            <div className="map-sidebar-content">
              <div className="route-parameter">
                <label htmlFor="caution">
                  <span>Hazard avoidance</span>
                  <span>{cautionWeight}%</span>
                </label>
                <input
                  id="caution"
                  type="range"
                  min={10}
                  max={100}
                  value={cautionWeight}
                  disabled={isCalculating || unavailable}
                  onChange={(e) => {
                    setCautionWeight(Number(e.target.value));
                    reset();
                  }}
                  className="field-range mt-4"
                />
                <p>
                  Higher values give more weight to distance from recorded detections and
                  observations.
                </p>
              </div>
              <div className="route-parameter">
                <label htmlFor="standoff">
                  <span>Minimum standoff</span>
                  <span>metres</span>
                </label>
                <input
                  id="standoff"
                  type="number"
                  min={3.5}
                  max={20}
                  step={0.5}
                  value={minStandoff}
                  disabled={isCalculating || unavailable}
                  onChange={(e) => {
                    setMinStandoff(e.target.value);
                    reset();
                  }}
                  className="field mt-3 font-mono text-xs"
                  aria-invalid={!validStandoff}
                />
                <p>
                  {validStandoff
                    ? 'Requested distance from recorded detections and observations. Range: 3.5–20 m.'
                    : 'Enter a standoff between 3.5 and 20 metres.'}
                </p>
              </div>
              {unavailable && (
                <p role="status">
                  Select the built-in sample mission to compute a route in this preview.
                </p>
              )}
              <Button
                className="mt-5 w-full"
                variant="primary"
                disabled={!canSolve}
                icon={<ArrowRight size={14} />}
                onClick={() => {
                  void handleSolve();
                }}
              >
                {isCalculating ? 'Computing route…' : 'Compute route'}
              </Button>
              {!activeSession && (
                <p className="mt-3 text-warning">Select a scan session before computing a route.</p>
              )}
            </div>
          </section>
          {error && (
            <section className="map-sidebar-block" role="alert">
              <div className="map-sidebar-title">
                <AlertTriangle size={14} className="text-critical" />
                <h2>Route computation failed</h2>
              </div>
              <div className="map-sidebar-content">
                <p>
                  {error instanceof ServiceError
                    ? error.message
                    : 'The route could not be computed. Try again.'}
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  disabled={!canSolve}
                  onClick={() => {
                    void handleSolve();
                  }}
                >
                  Try again
                </Button>
              </div>
            </section>
          )}
          {result && !result.pathFound && (
            <section className="map-sidebar-block" role="status">
              <div className="map-sidebar-title">
                <AlertTriangle size={14} className="text-warning" />
                <h2>No route available</h2>
              </div>
              <div className="map-sidebar-content">
                <p>
                  {result.failureReason ??
                    'No corridor satisfies the requested constraints. Reassess the endpoints and survey evidence.'}
                </p>
              </div>
            </section>
          )}
          {result?.pathFound && (
            <section className="map-sidebar-block">
              <div className="map-sidebar-title">
                <span>03</span>
                <h2>Computed route</h2>
              </div>
              <div className="map-sidebar-content">
                <dl className="space-y-3">
                  <KeyValueRow label="Distance" value={fmtDistance(result.totalDistanceM)} mono />
                  <KeyValueRow
                    label="Nearest evidence standoff"
                    value={
                      result.minStandoffAchievedM === null
                        ? ABSENT
                        : fmtNum(result.minStandoffAchievedM, 1, 'm')
                    }
                    mono
                  />
                  <KeyValueRow
                    label="Confirmed near route"
                    value={fmtCount(result.confirmedDetectionsNearRoute)}
                    mono
                  />
                  <KeyValueRow
                    label="Unconfirmed near route"
                    value={fmtCount(result.unconfirmedDetectionsNearRoute)}
                    mono
                  />
                  <KeyValueRow label="Waypoints" value={fmtCount(result.waypoints.length)} mono />
                </dl>
                {result.disclaimer && (
                  <p className="mt-4 border-t border-border pt-3">{result.disclaimer}</p>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-4 w-full"
                  icon={<Download size={13} />}
                  onClick={exportRoute}
                >
                  Export GeoJSON
                </Button>
              </div>
            </section>
          )}
          {!result && !error && (
            <div className="route-result-empty">
              <Route size={24} />
              <strong>
                {isCalculating ? 'Evaluating observed evidence' : 'Your route starts here'}
              </strong>
              <p>Place two endpoints and set your preferences to request a minimum-risk route.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
