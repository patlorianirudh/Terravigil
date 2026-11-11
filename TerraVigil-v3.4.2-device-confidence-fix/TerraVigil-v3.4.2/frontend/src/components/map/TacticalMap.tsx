import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  CircleMarker,
  LayerGroup,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { Check, Crosshair, Expand, Layers3, MapPin, Minus, Plus } from 'lucide-react';
import type { Coordinate, Detection, SafePathResult, TrackPoint } from '../../domain/types';
import { useUIStore } from '../../state/uiStore';
import { RiskBadge } from '../ui/RiskBadge';
import { ClassificationBadge } from '../ui/ClassificationBadge';
import { ConfidenceLedger } from '../ui/ConfidenceLedger';
import { TOKENS } from '../../styles/tokens';
import { config } from '../../config';
import { ScaleBar } from './GraticuleLayer';
import { ABSENT, fmtNum } from '../../lib/formatters';
import { detectionClassLabel, detectionLabel, sensorConfidenceLabel } from '../../lib/classification';
import { BasemapLayer, type BasemapMode } from './BasemapLayer';
import '../../styles/maps.css';

const BASEMAP_LABELS = {
  satellite: 'Satellite imagery',
  street: 'Street map',
  grid: 'Coordinate grid',
};

interface TacticalMapProps {
  center?: [number, number];
  zoom?: number;
  detections?: Detection[];
  trackPoints?: TrackPoint[];
  currentDronePoint?: TrackPoint | null;
  routeResult?: SafePathResult | null;
  endpoints?: { start: Coordinate | null; end: Coordinate | null };
  onPickPoint?: (position: Coordinate) => void;
  visualThreshold?: number | null;
  metalThreshold?: number | null;
  onSelectDetection?: (detection: Detection) => void;
  selectedDetectionId?: string | null;
  title?: string;
  subtitle?: string;
  reticle?: boolean;
  className?: string;
}
const LAYERS = [
  { key: 'confirmedMines', label: 'Confirmed detections', glyph: '●' },
  { key: 'unconfirmedVisual', label: 'Visual detections', glyph: '△' },
  { key: 'unresolvedMetal', label: 'Unresolved metal', glyph: '◇' },
  { key: 'flightTrack', label: 'Flown track', glyph: '—' },
  { key: 'riskHeatmap', label: 'High-risk display halos', glyph: '◉' },
  { key: 'uncertaintyCircles', label: 'CEP95 uncertainty', glyph: '◌' },
] as const;
function validCoordinate(value: Coordinate | null | undefined): value is Coordinate {
  return (
    value != null &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lon) &&
    Math.abs(value.lat) <= 90 &&
    Math.abs(value.lon) <= 180
  );
}
function altitudeText(position: Coordinate): string {
  if (position.altAglM != null && Number.isFinite(position.altAglM))
    return `Altitude ${fmtNum(position.altAglM, 2, 'm AGL')}`;
  if (position.altAmslM != null && Number.isFinite(position.altAmslM))
    return `Altitude ${fmtNum(position.altAmslM, 2, 'm AMSL')}`;
  return `Altitude (datum unreported) ${fmtNum(position.altitudeM, 2, 'm')}`;
}
function riskColor(band: Detection['riskBand']): string {
  return band === 'high'
    ? TOKENS.risk.high
    : band === 'medium'
      ? TOKENS.risk.medium
      : band === 'low'
        ? TOKENS.risk.low
        : TOKENS.text.secondary;
}
/**
 * Colour for a marker whose risk band was never assessed (Firebase sensor
 * events store risk_level null). Distinct per sensor so the map stays readable
 * and never implies a risk assessment that was not made: camera = cyan,
 * metal = orange. Both are visible on satellite imagery and distinct from the
 * red/yellow/green risk palette.
 */
function sensorColor(detection: Detection): string {
  if (detection.riskBand !== null && detection.riskBand !== undefined)
    return riskColor(detection.riskBand);
  return detection.classification === 'unresolved_metal'
    ? 'rgb(251, 146, 60)' // orange — metal
    : 'rgb(56, 189, 248)'; // cyan — camera
}
function droneIcon(heading: number | null): L.DivIcon {
  if (heading !== null && !Number.isFinite(heading)) heading = null;
  const symbol =
    heading === null
      ? `<circle cx="23" cy="23" r="5" fill="${TOKENS.accent.primary}"/>`
      : `<path d="M23 9 33 34 23 28 13 34Z" fill="${TOKENS.accent.primary}" transform="rotate(${String(heading)} 23 23)"/>`;
  const label =
    heading === null
      ? 'Aircraft position, heading unreported'
      : `Aircraft heading ${String(heading)} degrees`;
  return L.divIcon({
    className: 'aircraft-marker',
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    html: `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}" viewBox="0 0 46 46" width="46" height="46"><circle cx="23" cy="23" r="21" fill="${TOKENS.surfaces.background}" stroke="${TOKENS.accent.primary}" stroke-width="1"/>${symbol}<path d="M23 1V5M23 41V45M1 23H5M41 23H45" stroke="${TOKENS.accent.primary}"/></svg>`,
  });
}
function endpointIcon(label: 'A' | 'B'): L.DivIcon {
  return L.divIcon({
    className: 'route-endpoint-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<span aria-label="Route ${label}">${label}</span>`,
  });
}
const ClickCapture: React.FC<{ onPick: (position: Coordinate) => void }> = ({ onPick }) => {
  useMapEvents({
    click: (event) => {
      const point = event.latlng.wrap();
      onPick({ lat: point.lat, lon: point.lng });
    },
  });
  return null;
};
const Viewport: React.FC<{
  coordinates: [number, number][];
  hasDetections: boolean;
  hasTrack: boolean;
  hasEndpoints: boolean;
  routeSignature: string;
  selected?: Detection | undefined;
}> = ({ coordinates, hasDetections, hasTrack, hasEndpoints, routeSignature, selected }) => {
  const map = useMap();
  const fitted = useRef(false);
  const fittedSources = useRef(0);
  const fittedRoute = useRef('');
  useEffect(() => {
    const sources = (hasDetections ? 1 : 0) | (hasTrack ? 2 : 0) | (hasEndpoints ? 4 : 0);
    // Detections and recorded track are independent requests. Fit each source
    // once when it first arrives; subsequent live samples must not undo a pan.
    const sourceArrived = (sources & ~fittedSources.current) !== 0;
    const routeArrived = routeSignature !== '' && routeSignature !== fittedRoute.current;
    if (coordinates.length > 0 && (!fitted.current || sourceArrived || routeArrived)) {
      map.fitBounds(L.latLngBounds(coordinates), {
        padding: [60, 75],
        maxZoom: 19,
        animate: false,
      });
      fitted.current = true;
      fittedSources.current |= sources;
    }
    fittedRoute.current = routeSignature;
  }, [map, coordinates, hasDetections, hasTrack, hasEndpoints, routeSignature]);
  const selectedId = selected?.id;
  const selectedLat = selected?.position.lat;
  const selectedLon = selected?.position.lon;
  useEffect(() => {
    if (selectedLat !== undefined && selectedLon !== undefined)
      map.panTo([selectedLat, selectedLon], { animate: false });
  }, [map, selectedId, selectedLat, selectedLon]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    observer.observe(map.getContainer());
    return () => {
      observer.disconnect();
    };
  }, [map]);
  return null;
};
const MapControls: React.FC<{
  focus: [number, number] | null;
  coordinates: [number, number][];
}> = ({ focus, coordinates }) => {
  const map = useMap();
  const controlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    L.DomEvent.disableClickPropagation(controls);
    L.DomEvent.disableScrollPropagation(controls);
    return () => {
      L.DomEvent.off(controls);
    };
  }, []);
  return (
    <div ref={controlsRef} className="survey-map-controls">
      <div className="map-north" aria-label="North is up">
        <span>N</span>
        <span aria-hidden>↑</span>
      </div>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => {
          map.zoomIn();
        }}
      >
        <Plus size={17} />
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => {
          map.zoomOut();
        }}
      >
        <Minus size={17} />
      </button>
      <button
        type="button"
        aria-label="Fit survey to map"
        title="Fit survey to map"
        disabled={coordinates.length === 0}
        onClick={() => {
          if (coordinates.length)
            map.fitBounds(L.latLngBounds(coordinates), { padding: [55, 75], maxZoom: 19 });
        }}
      >
        <Expand size={16} />
      </button>
      <button
        type="button"
        aria-label="Centre on aircraft"
        title="Centre on aircraft"
        disabled={focus === null}
        onClick={() => {
          if (focus) map.panTo(focus);
        }}
      >
        <Crosshair size={17} />
      </button>
    </div>
  );
};
/** Fixed-pixel observation geometry drawn by Leaflet's shared canvas renderer. */
const ObservationMarker: React.FC<{
  detection: Detection;
  onSelect: () => void;
  children: React.ReactNode;
}> = ({ detection, onSelect, children }) => {
  const map = useMap();
  const [zoomLevel, setZoomLevel] = useState(map.getZoom());
  useEffect(() => {
    const synchronizeZoom = () => {
      setZoomLevel(map.getZoom());
    };
    // Keep the listener attached across renders: Viewport can fit between a
    // changing event handler's cleanup and its re-subscription. Reconcile once
    // after subscribing to catch a fit that preceded this marker's mount.
    map.on('zoomend', synchronizeZoom);
    synchronizeZoom();
    return () => {
      map.off('zoomend', synchronizeZoom);
    };
  }, [map]);
  // Sensor modality decides the shape so the map is readable at a glance:
  // camera candidates are dots, metal candidates are crosses. Shape — not
  // colour — carries the distinction (P-20.12).
  const isMetal = detection.classification === 'unresolved_metal';
  const crossArms = useMemo(() => {
    if (!isMetal) return null;
    const center = map.project([detection.position.lat, detection.position.lon], zoomLevel);
    const arm = 9;
    const toLatLng = (x: number, y: number) =>
      map.unproject(L.point(center.x + x, center.y + y), zoomLevel);
    // Two separate arms so the cross reads as a clean '+', not a zigzag.
    return [
      [toLatLng(0, -arm), toLatLng(0, arm)],
      [toLatLng(-arm, 0), toLatLng(arm, 0)],
    ];
  }, [map, detection.position.lat, detection.position.lon, isMetal, zoomLevel]);
  const color = sensorColor(detection);
  return (
    <>
      {isMetal && crossArms ? (
        <>
          {/* Dark underlay for contrast on bright imagery. */}
          {crossArms.map((arm, index) => (
            <Polyline
              key={`under-${index}`}
              positions={arm}
              interactive={false}
              pathOptions={{ color: 'rgb(10, 14, 12)', weight: 6, opacity: 0.9, lineCap: 'round' }}
            />
          ))}
          {crossArms.map((arm, index) => (
            <Polyline
              key={`arm-${index}`}
              positions={arm}
              bubblingMouseEvents={false}
              pathOptions={{ color, weight: 3, opacity: 1, lineCap: 'round' }}
              eventHandlers={{ click: onSelect }}
            >
              {index === 0 ? children : null}
            </Polyline>
          ))}
        </>
      ) : (
        <CircleMarker
          center={[detection.position.lat, detection.position.lon]}
          radius={6}
          bubblingMouseEvents={false}
          pathOptions={{
            color: 'rgb(10, 14, 12)',
            fillColor: color,
            fillOpacity: 1,
            weight: 1.5,
          }}
          eventHandlers={{ click: onSelect }}
        >
          {children}
        </CircleMarker>
      )}
    </>
  );
};
const DetectionPopup: React.FC<{
  detection: Detection;
  visualThreshold: number | null;
  metalThreshold: number | null;
}> = ({ detection, visualThreshold, metalThreshold }) => {
  const isMetal = detection.classification === 'unresolved_metal';
  const isCamera = detection.classification === 'unconfirmed_visual';
  const observed = detection.lastObservedAt
    ? new Date(detection.lastObservedAt).toLocaleString()
    : ABSENT;
  return (
    <div className="min-w-[248px] space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <ClassificationBadge
          classification={detection.classification}
          validationIssue={detection.validationIssue ?? null}
        />
        <RiskBadge band={detection.riskBand} score={detection.riskScore} />
      </div>
      <div>
        <strong className="block text-[14px] text-text-primary">
          {detectionClassLabel(detection)}
        </strong>
        <p className="mt-0.5 text-[11px] text-text-muted">
          {isMetal ? 'Metal detector hit' : isCamera ? 'Camera detection' : 'Observation'} ·{' '}
          {observed}
        </p>
      </div>
      {sensorConfidenceLabel(detection) && (
        <p className="text-[12px] font-medium text-text-primary">
          {sensorConfidenceLabel(detection)}
        </p>
      )}
      {detection.targetLocationKnown === false && (
        <div className="map-image-context-note">
          <strong>
            {detection.locationSource === 'aircraft_gps_at_capture'
              ? 'Aircraft position at capture'
              : 'Image context only'}
          </strong>
          <p>
            {detection.locationSource === 'aircraft_gps_at_capture'
              ? 'Timestamp matched to Pixhawk telemetry. Exact ground target position is unknown.'
              : (detection.confirmationSource ??
                'This point locates the image. The detected target has not been localized.')}
          </p>
        </div>
      )}
      <dl className="map-popup-facts">
        <div>
          <dt>Position</dt>
          <dd>
            {detection.position.lat.toFixed(6)}, {detection.position.lon.toFixed(6)}
          </dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd>{altitudeText(detection.position)}</dd>
        </div>
        {detection.bestVisualConfidence != null && (
          <div>
            <dt>YOLO confidence</dt>
            <dd>{(detection.bestVisualConfidence * 100).toFixed(1)}%</dd>
          </div>
        )}
        {detection.bestMetalSignalNorm != null && (
          <div>
            <dt>Metal signal</dt>
            <dd>{detection.bestMetalSignalNorm}</dd>
          </div>
        )}
        {detection.metalDetected != null && (
          <div>
            <dt>Metal detected</dt>
            <dd>{detection.metalDetected ? 'Yes' : 'No'}</dd>
          </div>
        )}
        <div>
          <dt>Status</dt>
          <dd>{detection.sourceStatus ?? ABSENT}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd className="break-all">{detection.sourceRecordId ?? detectionLabel(detection)}</dd>
        </div>
      </dl>
      {detection.validationIssue && (
        <p className="text-[11px] text-warning">{detection.validationIssue}</p>
      )}
      <ConfidenceLedger
        visualConfidence={detection.bestVisualConfidence}
        metalSignalNorm={detection.bestMetalSignalNorm}
        visualThreshold={visualThreshold}
        metalThreshold={metalThreshold}
        corroborationCount={detection.corroborationCount}
        compact
      />
    </div>
  );
};

export const TacticalMap: React.FC<TacticalMapProps> = ({
  center = [0, 0],
  zoom = 17,
  detections = [],
  trackPoints = [],
  currentDronePoint,
  routeResult,
  endpoints,
  onPickPoint,
  visualThreshold = null,
  metalThreshold = null,
  onSelectDetection,
  selectedDetectionId,
  title = 'Survey map',
  subtitle,
  reticle = true,
  className = '',
}) => {
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const layers = useUIStore((s) => s.layers);
  const toggleLayer = useUIStore((s) => s.toggleLayer);
  const [showLayers, setShowLayers] = useState(false);
  const [basemap, setBasemap] = useState<BasemapMode>(() => {
    if (config.tileUrl === '') return 'grid';
    try {
      const saved = sessionStorage.getItem('terravigil.basemap.v1');
      if (saved === 'satellite' || saved === 'street' || saved === 'grid') return saved;
    } catch {
      /* Storage is optional. */
    }
    return 'satellite';
  });
  const validDetections = useMemo(
    () => detections.filter((d) => validCoordinate(d.position)),
    [detections],
  );
  const validTrack = useMemo(
    () => trackPoints.filter((p) => validCoordinate(p.position)),
    [trackPoints],
  );
  const chronologicalTrack = useMemo(
    () =>
      validTrack
        .filter((p) => Number.isFinite(Date.parse(p.tUtc)))
        .sort((a, b) => Date.parse(a.tUtc) - Date.parse(b.tUtc)),
    [validTrack],
  );
  const dronePos: [number, number] | null =
    currentDronePoint && validCoordinate(currentDronePoint.position)
      ? [currentDronePoint.position.lat, currentDronePoint.position.lon]
      : null;
  const trackCoords = useMemo(
    () => chronologicalTrack.map((p): [number, number] => [p.position.lat, p.position.lon]),
    [chronologicalTrack],
  );
  const coordinates = useMemo(
    () => [
      ...validTrack.map((p): [number, number] => [p.position.lat, p.position.lon]),
      ...validDetections.map((d): [number, number] => [d.position.lat, d.position.lon]),
    ],
    [validTrack, validDetections],
  );
  const visibleDetections = validDetections.filter((detection) =>
    detection.classification === 'confirmed'
      ? layers.confirmedMines
      : detection.classification === 'unconfirmed_visual'
        ? layers.unconfirmedVisual
        : layers.unresolvedMetal,
  );
  const routeCoords = useMemo(
    () =>
      (routeResult?.waypoints ?? [])
        .filter(validCoordinate)
        .map((w): [number, number] => [w.lat, w.lon]),
    [routeResult],
  );
  const start = validCoordinate(endpoints?.start) ? endpoints.start : null;
  const end = validCoordinate(endpoints?.end) ? endpoints.end : null;
  const allCoords: [number, number][] = [
    ...coordinates,
    ...(dronePos ? [dronePos] : []),
    ...(start ? [[start.lat, start.lon] as [number, number]] : []),
    ...(end ? [[end.lat, end.lon] as [number, number]] : []),
    ...routeCoords,
  ];
  // Picking endpoints preserves the operator's view, including on an empty map.
  // Manual Fit still receives allCoords; loaded routes retain automatic fitting.
  const autoFitCoords: [number, number][] = onPickPoint
    ? [...coordinates, ...(dronePos ? [dronePos] : []), ...routeCoords]
    : allCoords;
  const initialCenter: [number, number] =
    dronePos ??
    allCoords[0] ??
    (validCoordinate({ lat: center[0], lon: center[1] }) ? center : [0, 0]);
  const routeSignature = routeCoords.map((point) => point.join(',')).join(';');
  const selected = validDetections.find((d) => d.id === selectedDetectionId);
  const geometrySession =
    currentDronePoint?.sessionId ?? trackPoints[0]?.sessionId ?? detections[0]?.sessionId ?? 'none';
  return (
    <section
      className={`survey-map ${reticle ? 'survey-map--reticle' : ''} ${onPickPoint ? 'survey-map--picking' : ''} ${className}`}
      aria-label={title}
    >
      <div className="survey-map-header">
        <div className="survey-map-heading">
          <MapPin size={15} />
          <strong>{title}</strong>
          <span>{subtitle ?? BASEMAP_LABELS[basemap]}</span>
        </div>
        <label className="map-basemap-control">
          <span>Basemap</span>
          <select
            aria-label="Basemap"
            value={basemap}
            onChange={(event) => {
              const value = event.target.value as BasemapMode;
              setBasemap(value);
              try {
                sessionStorage.setItem('terravigil.basemap.v1', value);
              } catch {
                /* Storage is optional. */
              }
            }}
          >
            <option value="satellite" disabled={config.tileUrl === ''}>
              Satellite
            </option>
            <option value="street">Street</option>
            <option value="grid">Grid</option>
          </select>
        </label>
        <button
          type="button"
          className={showLayers ? 'map-layers-button is-active' : 'map-layers-button'}
          aria-label="Map layers"
          aria-expanded={showLayers}
          onClick={() => {
            setShowLayers(!showLayers);
          }}
        >
          <Layers3 size={14} />
          <span>Layers</span>
          <span className="map-layer-count">{LAYERS.filter((l) => layers[l.key]).length}</span>
        </button>
      </div>
      <div className="survey-map-canvas">
        <MapContainer
          center={initialCenter}
          zoom={allCoords.length ? zoom : 2}
          scrollWheelZoom
          zoomControl={false}
          zoomAnimation={false}
          preferCanvas
          renderer={canvasRenderer}
          zoomSnap={0.5}
          zoomDelta={0.5}
          attributionControl
          className="h-full w-full"
        >
          <BasemapLayer key={basemap} mode={basemap} />
          <ScaleBar />
          <Viewport
            key={geometrySession}
            coordinates={autoFitCoords}
            hasDetections={validDetections.length > 0}
            hasTrack={validTrack.length > 1}
            hasEndpoints={onPickPoint === undefined && start !== null && end !== null}
            routeSignature={routeSignature}
            selected={selected}
          />
          <MapControls focus={dronePos} coordinates={allCoords} />
          {onPickPoint && <ClickCapture onPick={onPickPoint} />}
          {start && (
            <Marker position={[start.lat, start.lon]} icon={endpointIcon('A')}>
              <Tooltip permanent direction="bottom" className="map-point-label">
                Route A
              </Tooltip>
            </Marker>
          )}
          {end && (
            <Marker position={[end.lat, end.lon]} icon={endpointIcon('B')}>
              <Tooltip permanent direction="bottom" className="map-point-label">
                Route B
              </Tooltip>
            </Marker>
          )}
          <LayerGroup>
            {layers.flightTrack && trackCoords.length > 1 && (
              <>
                <Polyline
                  positions={trackCoords}
                  pathOptions={{ color: TOKENS.surfaces.background, weight: 6, opacity: 1 }}
                />
                <Polyline
                  positions={trackCoords}
                  pathOptions={{
                    color: TOKENS.accent.primary,
                    weight: 1.8,
                    opacity: 0.8,
                    lineCap: 'square',
                  }}
                />
                <CircleMarker
                  center={trackCoords[0] ?? initialCenter}
                  radius={4}
                  pathOptions={{
                    color: TOKENS.accent.primary,
                    fillColor: TOKENS.surfaces.background,
                    fillOpacity: 1,
                    weight: 1.5,
                  }}
                >
                  <Tooltip direction="bottom" permanent className="map-point-label">
                    Flight start
                  </Tooltip>
                </CircleMarker>
                <CircleMarker
                  center={trackCoords.at(-1) ?? initialCenter}
                  radius={4}
                  interactive={false}
                  pathOptions={{
                    color: TOKENS.accent.primary,
                    fillColor: TOKENS.accent.primary,
                    fillOpacity: 1,
                    weight: 1.5,
                  }}
                >
                  <Tooltip direction="top" permanent className="map-point-label">
                    Flight end
                  </Tooltip>
                </CircleMarker>
              </>
            )}
          </LayerGroup>
          {routeCoords.length > 1 && (
            <Polyline
              positions={routeCoords}
              pathOptions={{
                color: TOKENS.text.primary,
                weight: 3,
                opacity: 0.95,
                dashArray: '7, 6',
              }}
            />
          )}
          <LayerGroup>
            {layers.riskHeatmap &&
              visibleDetections
                .filter(
                  (detection) =>
                    detection.riskBand === 'high' && detection.targetLocationKnown !== false,
                )
                .map((detection) => (
                  <React.Fragment key={detection.id}>
                    {[24, 18, 12].map((radius) => (
                      <CircleMarker
                        key={radius}
                        center={[detection.position.lat, detection.position.lon]}
                        radius={radius}
                        interactive={false}
                        pathOptions={{
                          stroke: false,
                          fillColor: TOKENS.risk.high,
                          fillOpacity: 0.08,
                        }}
                      />
                    ))}
                  </React.Fragment>
                ))}
          </LayerGroup>
          {(['confirmed', 'unconfirmed_visual', 'unresolved_metal'] as const).map((family) => (
            <LayerGroup key={family}>
              {visibleDetections
                .filter((detection) => detection.classification === family)
                .map((detection) => {
                  const at: [number, number] = [detection.position.lat, detection.position.lon];
                  const { classification } = detection;
                  const color = riskColor(detection.riskBand);
                  const popup = (
                    <Popup>
                      <DetectionPopup
                        detection={detection}
                        visualThreshold={visualThreshold}
                        metalThreshold={metalThreshold}
                      />
                    </Popup>
                  );
                  const label = (
                    <Tooltip
                      direction="right"
                      offset={[10, 0]}
                      permanent
                      className={`map-point-label ${detection.id === selectedDetectionId ? 'is-selected' : ''}`}
                    >
                      {detectionLabel(detection)}
                    </Tooltip>
                  );
                  return (
                    <React.Fragment key={detection.id}>
                      {layers.uncertaintyCircles &&
                        detection.targetLocationKnown !== false &&
                        detection.localizationUncertaintyM !== null &&
                        Number.isFinite(detection.localizationUncertaintyM) &&
                        detection.localizationUncertaintyM >= 0 && (
                          <Circle
                            center={at}
                            radius={detection.localizationUncertaintyM}
                            interactive={false}
                            pathOptions={{
                              color,
                              fillColor: color,
                              fillOpacity: 0.08,
                              opacity: 0.55,
                              weight: 1,
                              dashArray: '3, 4',
                            }}
                          />
                        )}
                      {detection.id === selectedDetectionId && (
                        <CircleMarker
                          center={at}
                          radius={16}
                          interactive={false}
                          pathOptions={{
                            color: TOKENS.accent.primary,
                            fill: false,
                            weight: 1.5,
                            dashArray: '3, 3',
                          }}
                        />
                      )}
                      {classification === 'confirmed' ? (
                        <CircleMarker
                          center={at}
                          radius={7}
                          bubblingMouseEvents={false}
                          pathOptions={{
                            color,
                            fillColor:
                              detection.riskBand === 'low' ? TOKENS.surfaces.background : color,
                            fillOpacity: detection.riskBand === 'medium' ? 0.45 : 1,
                            weight: detection.riskBand === 'high' ? 2 : 1.5,
                          }}
                          eventHandlers={{
                            click: () => {
                              onSelectDetection?.(detection);
                            },
                          }}
                        >
                          {popup}
                          {label}
                        </CircleMarker>
                      ) : (
                        <ObservationMarker
                          detection={detection}
                          onSelect={() => {
                            onSelectDetection?.(detection);
                          }}
                        >
                          {popup}
                          {label}
                        </ObservationMarker>
                      )}
                    </React.Fragment>
                  );
                })}
            </LayerGroup>
          ))}
          {dronePos && currentDronePoint && (
            <Marker
              position={dronePos}
              icon={droneIcon(currentDronePoint.headingDeg)}
              zIndexOffset={1000}
            >
              <Tooltip direction="bottom" offset={[0, 23]} permanent className="map-aircraft-label">
                AIRCRAFT <span>{fmtNum(currentDronePoint.position.altAglM, 1, 'm AGL')}</span>
              </Tooltip>
              <Popup>
                <div className="space-y-1 font-mono text-xs">
                  <p>{altitudeText(currentDronePoint.position)}</p>
                  <p>Speed {fmtNum(currentDronePoint.groundSpeedMs, 1, 'm/s')}</p>
                  <p>Heading {fmtNum(currentDronePoint.headingDeg, 0, '°')}</p>
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
        {showLayers && (
          <div className="map-layer-menu">
            <p>Visible evidence</p>
            {LAYERS.map((layer) => (
              <button
                key={layer.key}
                type="button"
                aria-pressed={layers[layer.key]}
                onClick={() => {
                  toggleLayer(layer.key);
                }}
              >
                <span className="map-layer-glyph">{layer.glyph}</span>
                <span>{layer.label}</span>
                <span className={layers[layer.key] ? 'map-checkbox is-checked' : 'map-checkbox'}>
                  {layers[layer.key] && <Check size={11} />}
                </span>
              </button>
            ))}
            <small className="block px-2 py-2 text-[10px] leading-relaxed text-text-muted">
              High-risk halos highlight records only; size has no ground-distance meaning.
            </small>
          </div>
        )}
        {allCoords.length === 0 && (
          <div className="map-empty">
            <Crosshair size={30} />
            <strong>Awaiting survey geometry</strong>
            <span>Track and geolocated observations appear here.</span>
          </div>
        )}
        {onPickPoint && (
          <div className="map-pick-instruction">
            <span>{!endpoints?.start ? '01' : !endpoints.end ? '02' : '✓'}</span>
            {!endpoints?.start
              ? 'Click the map to place your origin'
              : !endpoints.end
                ? 'Click the map to place your destination'
                : 'Endpoints ready. Compute your route.'}
          </div>
        )}
        <div className="map-reference-label">
          {BASEMAP_LABELS[basemap].toUpperCase()}
          <span>WGS84 · NORTH UP</span>
        </div>
      </div>
      <div className="survey-map-footer">
        <div className="map-legend">
          <span>
            <i className="map-dot high" />
            High risk
          </span>
          <span>
            <i className="map-dot medium" />
            Medium risk
          </span>
          <span>
            <i className="map-dot low" />
            Low risk
          </span>
          <span>⬤ Stored confirmed</span>
          <span>● Camera detection</span>
          <span>✚ Metal detection</span>
          <span>
            <i className="map-line-key flight" /> Flight start/end
          </span>
          <span>
            <i className="map-line-key route" /> Route A/B · advisory
          </span>
        </div>
        <span className="map-footnote">
          {visibleDetections.length} visible / {validDetections.length} valid GPS
        </span>
      </div>
    </section>
  );
};
