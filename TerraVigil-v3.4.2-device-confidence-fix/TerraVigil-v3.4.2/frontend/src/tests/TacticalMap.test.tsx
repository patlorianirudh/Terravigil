// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import L from 'leaflet';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TacticalMap } from '../components/map/TacticalMap';
import { toDetection, toTrackPoint } from '../services/mappers';
import { useUIStore } from '../state/uiStore';
import type { Coordinate, Detection, TrackPoint } from '../domain/types';
import { TOKENS } from '../styles/tokens';

let container: HTMLDivElement;
let root: Root;
let map: L.Map | undefined;
// Retain the real method and supply its map receiver explicitly in the spy.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalFitBounds = L.Map.prototype.fitBounds;
const fitBounds = vi.spyOn(L.Map.prototype, 'fitBounds').mockImplementation(function (
  this: L.Map,
  bounds,
  options,
) {
  map = originalFitBounds.call(this, bounds, options);
  return map;
});

function detection(id: string, lat: number, lon: number): Detection {
  const value = toDetection({
    id,
    sessionId: 'S1',
    classification: 'confirmed',
    position: { lat, lon },
    riskBand: 'high',
    riskScore: 0.8,
  });
  if (!value) throw new Error('Invalid detection fixture');
  return value;
}

function track(lat: number, lon: number, seconds: number): TrackPoint {
  const value = toTrackPoint({
    sessionId: 'S1',
    position: { lat, lon },
    tUtc: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(),
  });
  if (!value) throw new Error('Invalid track fixture');
  return value;
}

function activeMap(): L.Map {
  if (!map) throw new Error('Map has not mounted');
  return map;
}

function mapLayers(): L.Layer[] {
  const result: L.Layer[] = [];
  activeMap().eachLayer((layer) => result.push(layer));
  return result;
}

function labelledPoint(label: string): L.CircleMarker | undefined {
  return mapLayers().find(
    (layer): layer is L.CircleMarker =>
      layer instanceof L.CircleMarker && layer.getTooltip()?.getElement()?.textContent === label,
  );
}

async function commit(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

beforeAll(() => {
  L.Map.addInitHook(function (this: L.Map) {
    // Leaflet exposes maps with no fitted geometry through this public hook receiver.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    map = this;
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* JSDOM dimensions remain fixed. */
      }
      disconnect() {
        /* No native observer to release. */
      }
      unobserve() {
        /* No native observer to release. */
      }
    },
  );
  // Keep Leaflet's projection, layers, bounds, and events real. JSDOM lacks only
  // canvas drawing and element layout, which are covered by browser checks.
  const context = new Proxy({}, { get: () => () => undefined });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as CanvasRenderingContext2D,
  );
  for (const [property, size] of Object.entries({
    clientWidth: 800,
    clientHeight: 500,
    offsetWidth: 800,
    offsetHeight: 500,
  })) {
    Object.defineProperty(HTMLElement.prototype, property, { configurable: true, get: () => size });
  }
});

beforeEach(() => {
  sessionStorage.clear();
  useUIStore.setState({
    layers: {
      riskHeatmap: true,
      confirmedMines: true,
      unconfirmedVisual: true,
      unresolvedMetal: true,
      flightTrack: true,
      visualCoverage: true,
      dualCoverage: true,
      uncertaintyCircles: true,
    },
  });
  fitBounds.mockClear();
  map = undefined;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  // Flush the canvas paint queue before disposing JSDOM's map. Leaflet can
  // enqueue more than one paint during synchronous fit/zoom assertions.
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
  });
  await commit(() => {
    root.unmount();
  });
  container.remove();
});

describe('survey map geometry', () => {
  it('shows unlocalized image context explicitly without drawing risk or uncertainty halos around its GPS point', async () => {
    const imageContext = {
      ...detection('image-context', 17.38, 78.48),
      classification: 'unconfirmed_visual' as const,
      targetLocationKnown: false,
      locationSource: 'user_supplied_image_location',
      confirmationSource: 'Visual prediction only; no metal sensor evidence.',
      localizationUncertaintyM: 20,
    };
    await commit(() => {
      root.render(<TacticalMap detections={[imageContext]} />);
    });
    expect(mapLayers().filter((layer) => layer instanceof L.CircleMarker)).toHaveLength(0);
    expect(mapLayers().filter((layer) => layer instanceof L.Circle)).toHaveLength(0);
    expect(container.querySelector('.image-context-marker')).not.toBeNull();
    const marker = mapLayers().find(
      (layer) => layer.getTooltip()?.getElement()?.textContent === 'image-context',
    );
    await commit(() => {
      marker?.openPopup();
    });
    expect(container.querySelector('.leaflet-popup')?.textContent).toContain(
      'Image location (target not localized)',
    );
    expect(container.querySelector('.leaflet-popup')?.textContent).toContain(
      'Visual prediction only; no metal sensor evidence.',
    );
  });

  it('defaults to satellite imagery and retains evidence while switching the basemap', async () => {
    await commit(() => {
      root.render(<TacticalMap detections={[detection('satellite-test', 17.445, 78.348)]} />);
    });
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Basemap"]');
    expect(select?.value).toBe('satellite');
    const tiles = mapLayers().find((layer): layer is L.TileLayer => layer instanceof L.TileLayer);
    expect(tiles?.getTileUrl(Object.assign(L.point(47031, 29542), { z: 16 }))).toContain(
      'World_Imagery/MapServer/tile/',
    );
    const count = mapLayers().filter((layer) => layer instanceof L.CircleMarker).length;
    await commit(() => {
      if (select) {
        select.value = 'grid';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(mapLayers().some((layer) => layer instanceof L.TileLayer)).toBe(false);
    expect(mapLayers().filter((layer) => layer instanceof L.CircleMarker)).toHaveLength(count);
    expect(container.textContent).toContain('COORDINATE GRID');
    await commit(() => {
      if (select) {
        select.value = 'satellite';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(mapLayers().some((layer) => layer instanceof L.TileLayer)).toBe(true);
  });

  it('shows imagery failures and keeps retry clicks out of route endpoint picking', async () => {
    const pick = vi.fn();
    await commit(() => {
      root.render(<TacticalMap onPickPoint={pick} />);
    });
    const tiles = mapLayers().find((layer): layer is L.TileLayer => layer instanceof L.TileLayer);
    await commit(() => {
      tiles?.fire('tileerror');
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'unavailable or incomplete',
    );
    await commit(() => {
      container.querySelector<HTMLButtonElement>('.map-tile-notice button')?.click();
    });
    expect(pick).not.toHaveBeenCalled();
    expect(container.querySelector('.map-tile-notice')).toBeNull();
  });

  it('keeps an unknown aircraft heading neutral and identifies raw altitude with its unreported datum', async () => {
    const point = {
      ...track(17.38, 78.48, 0),
      position: { lat: 17.38, lon: 78.48, altitudeM: 42, altAglM: null },
    };
    await commit(() => {
      root.render(<TacticalMap currentDronePoint={point} />);
    });
    expect(container.querySelector('.aircraft-marker svg')?.getAttribute('aria-label')).toContain(
      'heading unreported',
    );
    const aircraft = mapLayers().find((layer): layer is L.Marker => layer instanceof L.Marker);
    await commit(() => {
      aircraft?.openPopup();
    });
    const popup = container.querySelector('.leaflet-popup');
    expect(popup?.textContent).toContain('Altitude (datum unreported) 42.00 m');
    expect(popup?.textContent).not.toContain('AGL');
  });

  it('keeps observation shapes at fixed pixel size through initial fitting, late data and zooming', async () => {
    const visual = {
      ...detection('fixed-size-visual', 17.38, 78.48),
      classification: 'unconfirmed_visual' as const,
    };
    const metal = {
      ...detection('fixed-size-metal', 17.3801, 78.4801),
      classification: 'unresolved_metal' as const,
    };
    const assertPixelSize = (index: number, height: number) => {
      const marker = mapLayers().filter((layer): layer is L.Polygon => layer instanceof L.Polygon)[
        index
      ];
      if (!marker) throw new Error(`Missing observation marker ${String(index)}`);
      const bounds = marker.getBounds();
      const nw = activeMap().project(bounds.getNorthWest(), activeMap().getZoom());
      const se = activeMap().project(bounds.getSouthEast(), activeMap().getZoom());
      expect(se.x - nw.x).toBeCloseTo(18, 4);
      expect(se.y - nw.y).toBeCloseTo(height, 4);
    };
    await commit(() => {
      root.render(<TacticalMap detections={[visual, metal]} zoom={17} />);
    });
    expect(activeMap().getZoom()).not.toBe(17);
    assertPixelSize(0, 16);
    assertPixelSize(1, 18);

    // A newly arriving marker mounts in the same commit as the late track fit.
    const late = {
      ...visual,
      id: 'late-visual',
      position: { lat: 17.395, lon: 78.495 },
    };
    await commit(() => {
      root.render(
        <TacticalMap
          detections={[visual, metal, late]}
          trackPoints={[track(17.37, 78.47, 0), track(17.4, 78.5, 10)]}
          zoom={17}
        />,
      );
    });
    assertPixelSize(0, 16);
    assertPixelSize(1, 18);
    assertPixelSize(2, 16);
    await commit(() => {
      activeMap().setZoom(18, { animate: false });
    });
    assertPixelSize(0, 16);
    assertPixelSize(1, 18);
    assertPixelSize(2, 16);
  });

  it('fits route endpoints and returned waypoints, including maps without survey records', async () => {
    const start = { lat: 17.38, lon: 78.48 };
    const end = { lat: 17.385, lon: 78.487 };
    const detour = { lat: 17.388, lon: 78.481 };
    await commit(() => {
      root.render(<TacticalMap endpoints={{ start, end }} />);
    });
    expect(fitBounds).toHaveBeenCalledTimes(1);
    for (const point of [start, end]) {
      expect(activeMap().getBounds().contains([point.lat, point.lon])).toBe(true);
    }
    await commit(() => {
      root.render(
        <TacticalMap
          endpoints={{ start, end }}
          routeResult={{
            sessionId: 'S1',
            pathFound: true,
            waypoints: [start, detour, end],
            totalDistanceM: null,
            minStandoffAchievedM: null,
            confirmedDetectionsNearRoute: null,
            unconfirmedDetectionsNearRoute: null,
            disclaimer: '',
            failureReason: null,
          }}
        />,
      );
    });
    expect(fitBounds).toHaveBeenCalledTimes(2);
    for (const point of [start, detour, end]) {
      expect(activeMap().getBounds().contains([point.lat, point.lon])).toBe(true);
    }
    expect(container.querySelector('.map-empty')).toBeNull();
  });

  it('uses chronological flight endpoints without changing their GPS positions', async () => {
    const first = track(17.38, 78.48, 0);
    const middle = track(17.381, 78.481, 10);
    const last = track(17.382, 78.482, 20);
    await commit(() => {
      root.render(<TacticalMap trackPoints={[last, first, middle]} />);
    });
    expect(labelledPoint('Flight start')?.getLatLng()).toEqual(L.latLng(17.38, 78.48));
    expect(labelledPoint('Flight end')?.getLatLng()).toEqual(L.latLng(17.382, 78.482));
    const line = mapLayers().find((layer) => layer instanceof L.Polyline);
    expect(line).toBeInstanceOf(L.Polyline);
    expect((line as L.Polyline).getLatLngs()).toEqual([
      L.latLng(17.38, 78.48),
      L.latLng(17.381, 78.481),
      L.latLng(17.382, 78.482),
    ]);
  });

  it('does not assign chronological endpoints to telemetry with unreported time', async () => {
    const undated = { ...track(17.4, 78.5, 0), tUtc: '' };
    const first = track(17.38, 78.48, 10);
    const last = track(17.39, 78.49, 20);
    await commit(() => {
      root.render(<TacticalMap trackPoints={[undated, last, first]} />);
    });
    expect(labelledPoint('Flight start')?.getLatLng()).toEqual(L.latLng(17.38, 78.48));
    expect(labelledPoint('Flight end')?.getLatLng()).toEqual(L.latLng(17.39, 78.49));
    expect(activeMap().getBounds().contains([17.4, 78.5])).toBe(true);
    await commit(() => {
      root.render(
        <TacticalMap
          trackPoints={[undated, { ...undated, position: { lat: 17.41, lon: 78.51 } }]}
        />,
      );
    });
    expect(labelledPoint('Flight start')).toBeUndefined();
    expect(labelledPoint('Flight end')).toBeUndefined();
  });

  it('excludes nonfinite and out-of-range positions from every map geometry input', async () => {
    const valid = detection('valid-record', 17.38, 78.48);
    const bad = { ...detection('bad-record', 17.38, 78.48), position: { lat: 95, lon: 78.48 } };
    await commit(() => {
      root.render(
        <TacticalMap
          detections={[valid, bad]}
          trackPoints={[{ ...track(17.38, 78.48, 0), position: { lat: Number.NaN, lon: 78.48 } }]}
          currentDronePoint={{
            ...track(17.38, 78.48, 0),
            position: { lat: 17.38, lon: Number.POSITIVE_INFINITY },
          }}
          endpoints={{ start: { lat: 17.38, lon: 200 }, end: null }}
          routeResult={{
            sessionId: 'S1',
            pathFound: true,
            waypoints: [{ lat: 91, lon: 78.48 }],
            totalDistanceM: null,
            minStandoffAchievedM: null,
            confirmedDetectionsNearRoute: null,
            unconfirmedDetectionsNearRoute: null,
            disclaimer: '',
          }}
          selectedDetectionId={bad.id}
        />,
      );
    });
    expect(labelledPoint(valid.id)).toBeDefined();
    expect(labelledPoint(bad.id)).toBeUndefined();
    expect(container.querySelector('.aircraft-marker')).toBeNull();
    expect(container.querySelector('.route-endpoint-marker')).toBeNull();
    expect(activeMap().getCenter().lat).toBeCloseTo(17.38, 4);
    expect(activeMap().getCenter().lng).toBeCloseTo(78.48, 4);
  });

  it('refits when the recorded track arrives after detections, then preserves operator panning', async () => {
    const detections = [detection('actual-record-id', 17.38, 78.48)];
    await commit(() => {
      root.render(<TacticalMap detections={detections} />);
    });
    expect(fitBounds).toHaveBeenCalledTimes(1);
    const first = track(17.37, 78.47, 0);
    const last = track(17.39, 78.49, 10);
    await commit(() => {
      root.render(<TacticalMap detections={detections} trackPoints={[first, last]} />);
    });
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect(activeMap().getBounds().contains([last.position.lat, last.position.lon])).toBe(true);
    await commit(() => {
      activeMap().panTo([17.4, 78.5], { animate: false });
      root.render(
        <TacticalMap
          detections={detections}
          trackPoints={[first, last, track(17.391, 78.491, 20)]}
        />,
      );
    });
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it('keeps detection labels tied to record IDs when the input order changes', async () => {
    const a = { ...detection('detection:S1:mongo-record-a', 17.38, 78.48), sourceId: 'D001' };
    const b = { ...detection('detection:S1:mongo-record-b', 17.381, 78.481), sourceId: 'D002' };
    await commit(() => {
      root.render(<TacticalMap detections={[a, b]} />);
    });
    expect(labelledPoint('D001')?.getLatLng()).toEqual(L.latLng(a.position.lat, a.position.lon));
    await commit(() => {
      root.render(<TacticalMap detections={[b, a]} />);
    });
    expect(labelledPoint('D001')?.getLatLng()).toEqual(L.latLng(a.position.lat, a.position.lon));
  });

  it('does not undo a pan when polling refreshes an unchanged selected record', async () => {
    const selected = detection('selected-record', 17.38, 78.48);
    await commit(() => {
      root.render(<TacticalMap detections={[selected]} selectedDetectionId={selected.id} />);
    });
    await commit(() => activeMap().panTo([17.4, 78.5], { animate: false }));
    await commit(() => {
      root.render(<TacticalMap detections={[{ ...selected }]} selectedDetectionId={selected.id} />);
    });
    expect(activeMap().getCenter().lat).toBeCloseTo(17.4, 4);
    expect(activeMap().getCenter().lng).toBeCloseTo(78.5, 4);
  });

  it('distinguishes duplicate source IDs by the stored record identity in each popup', async () => {
    const a = {
      ...detection('detection:S1:record-a', 17.38, 78.48),
      sourceId: 'D001',
      sourceRecordId: 'record-a',
      metalDetected: true,
      lastObservedAt: '2026-01-01T00:00:10Z',
    };
    const b = { ...a, id: 'detection:S1:record-b', sourceRecordId: 'record-b' };
    await commit(() => {
      root.render(<TacticalMap detections={[a, b]} />);
    });
    const markers = mapLayers().filter(
      (layer) => layer.getTooltip()?.getElement()?.textContent === 'D001',
    );
    expect(markers).toHaveLength(2);
    await commit(() => {
      markers[0]?.openPopup();
    });
    expect(container.querySelector('.leaflet-popup')?.textContent).toContain('record-a');
    expect(container.querySelector('.leaflet-popup')?.textContent).toContain('Metal detected: Yes');
  });

  it('shows mission, collection, raw evidence and a contradictory stored-status warning in the popup', async () => {
    const record = {
      ...detection('status-record', 17.3812345, 78.4812345),
      sourceId: 'D001',
      sourceRecordId: 'mongo-status-record',
      sourceType: 'detection' as const,
      sourceStatus: 'CONFIRMED',
      validationIssue: 'Stored confirmation contradicts the supplied sensor evidence.',
      position: { lat: 17.3812345, lon: 78.4812345, altitudeM: 42, altAglM: null },
      metalDetected: false,
      bestVisualConfidence: 0.6234,
      bestMetalSignalNorm: null,
      riskScore: null,
      lastObservedAt: '2026-01-01T00:00:10.000Z',
    };
    await commit(() => {
      root.render(<TacticalMap detections={[record]} />);
    });
    await commit(() =>
      mapLayers()
        .find((layer) => layer instanceof L.CircleMarker && layer.options.radius === 7)
        ?.openPopup(),
    );
    const popup = container.querySelector('.leaflet-popup');
    for (const value of [
      'Mission S1',
      'Collection detection',
      'mongo-status-record',
      '17.3812345',
      '78.4812345',
      '0.6234',
      'Metal detected: No',
      'Stored status CONFIRMED',
      '2026-01-01T00:00:10.000Z',
      record.validationIssue,
    ]) {
      expect(popup?.textContent).toContain(value);
    }
    expect(popup?.textContent).toContain('Stored status · needs validation');
    expect(popup?.textContent).toContain('Altitude (datum unreported) 42.00 m');
    expect(popup?.textContent).toContain('Metal signal —');
    expect(popup?.textContent).toContain('Risk score —');
  });

  it('uses reported risk colors for unconfirmed shapes and can hide the high-risk overlay alone', async () => {
    const visual = {
      ...detection('visual-risk', 17.38, 78.48),
      classification: 'unconfirmed_visual' as const,
    };
    const metal = {
      ...detection('metal-risk', 17.381, 78.481),
      classification: 'unresolved_metal' as const,
      riskBand: 'medium' as const,
    };
    await commit(() => {
      root.render(<TacticalMap detections={[visual, metal]} />);
    });
    const shapes = () =>
      mapLayers().filter((layer): layer is L.Polygon => layer instanceof L.Polygon);
    expect(shapes()[0]?.options.color).toBe(TOKENS.risk.high);
    expect(shapes()[1]?.options.color).toBe(TOKENS.risk.medium);
    const highlights = () =>
      mapLayers().filter(
        (layer) => layer instanceof L.CircleMarker && layer.options.interactive === false,
      );
    expect(highlights().length).toBeGreaterThan(0);
    await commit(() => {
      useUIStore.getState().setLayer('riskHeatmap', false);
    });
    expect(highlights()).toHaveLength(0);
    expect(shapes()).toHaveLength(2);
  });

  it('uses red, yellow and green for risk independently of confirmation', async () => {
    const records = (['high', 'medium', 'low'] as const).flatMap((band, index) => [
      { ...detection(`confirmed-${band}`, 17.38 + index / 1000, 78.48), riskBand: band },
      {
        ...detection(`visual-${band}`, 17.38 + index / 1000, 78.481),
        riskBand: band,
        classification: 'unconfirmed_visual' as const,
      },
    ]);
    await commit(() => {
      root.render(<TacticalMap detections={records} />);
    });
    const confirmed = mapLayers().filter(
      (layer): layer is L.CircleMarker =>
        layer instanceof L.CircleMarker && layer.options.radius === 7,
    );
    const visual = mapLayers().filter((layer): layer is L.Polygon => layer instanceof L.Polygon);
    for (const markers of [confirmed, visual]) {
      expect(markers.map((marker) => marker.options.color)).toEqual([
        'rgb(248, 113, 113)',
        'rgb(250, 204, 21)',
        'rgb(74, 222, 128)',
      ]);
    }
    await commit(() => labelledPoint('confirmed-low')?.openPopup());
    const popup = container.querySelector('.leaflet-popup');
    expect(popup?.textContent).toContain('LOW risk');
    expect(popup?.querySelector('.text-risk-high')).toBeNull();
    expect(container.querySelector('.map-legend')?.textContent).not.toContain('Confirmed high');
  });

  it('keeps map controls from placing endpoints and preserves clicked WGS84 coordinates', async () => {
    const onPick = vi.fn<(point: { lat: number; lon: number }) => void>();
    await commit(() => {
      root.render(<TacticalMap detections={[detection('A', 17.38, 78.48)]} onPickPoint={onPick} />);
    });
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      '.survey-map-controls button',
    )) {
      await commit(() => {
        button.click();
      });
    }
    expect(onPick).not.toHaveBeenCalled();
    await commit(() => activeMap().fire('click', { latlng: L.latLng(17.381234, 78.481234) }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0].lat).toBeCloseTo(17.381234, 10);
    expect(onPick.mock.calls[0]?.[0].lon).toBeCloseTo(78.481234, 10);
    const picked = onPick.mock.calls[0]?.[0];
    if (!picked) throw new Error('Map click did not produce an endpoint');
    await commit(() => {
      root.render(
        <TacticalMap
          endpoints={{ start: picked, end: { lat: 17.382, lon: 78.483 } }}
          onPickPoint={onPick}
        />,
      );
    });
    const anchors = mapLayers().filter((layer): layer is L.Marker => layer instanceof L.Marker);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.getLatLng().lat).toBeCloseTo(17.381234, 10);
    expect(anchors[0]?.getLatLng().lng).toBeCloseTo(78.481234, 10);
    expect(anchors[1]?.getLatLng()).toEqual(L.latLng(17.382, 78.483));
    for (const marker of anchors) expect(marker.options.icon?.options.iconAnchor).toEqual([15, 15]);
  });

  it.each(['recorded mission', 'empty mission'])(
    'preserves the chosen view and pixel anchors when picking A/B on a map with %s',
    async (scenario) => {
      const detections = scenario === 'recorded mission' ? [detection('record', 17.38, 78.48)] : [];
      function EndpointPicker() {
        const [points, setPoints] = useState<Coordinate[]>([]);
        return (
          <TacticalMap
            detections={detections}
            endpoints={{ start: points[0] ?? null, end: points[1] ?? null }}
            onPickPoint={(position) => {
              setPoints((previous) => [...previous, position]);
            }}
          />
        );
      }
      await commit(() => {
        root.render(<EndpointPicker />);
      });
      await commit(() => activeMap().setView([17.4, 78.5], 18, { animate: false }));
      expect(activeMap().getZoom()).toBe(18);
      const center = activeMap().getCenter();
      const pixels = [L.point(240, 225), L.point(496, 310)];
      for (const pixel of pixels) {
        await commit(() =>
          activeMap().fire('click', { latlng: activeMap().containerPointToLatLng(pixel) }),
        );
        expect(activeMap().getZoom()).toBe(18);
        expect(activeMap().getCenter()).toEqual(center);
        const anchors = mapLayers().filter((layer): layer is L.Marker => layer instanceof L.Marker);
        for (const [index, anchor] of anchors.entries()) {
          const actual = activeMap().latLngToContainerPoint(anchor.getLatLng());
          expect(actual.x).toBeCloseTo(pixels[index]?.x ?? Number.NaN, 0);
          expect(actual.y).toBeCloseTo(pixels[index]?.y ?? Number.NaN, 0);
        }
      }
      const anchors = mapLayers().filter((layer): layer is L.Marker => layer instanceof L.Marker);
      expect(anchors).toHaveLength(2);
      await commit(() => activeMap().setView([0, 0], 8, { animate: false }));
      await commit(() => {
        container.querySelector<HTMLButtonElement>('[aria-label="Fit survey to map"]')?.click();
      });
      for (const anchor of anchors)
        expect(activeMap().getBounds().contains(anchor.getLatLng())).toBe(true);
    },
  );

  it('owns each evidence family in a Leaflet group so toggling one removes its markers only', async () => {
    const confirmed = detection('confirmed-id', 17.38, 78.48);
    const visual = {
      ...detection('visual-id', 17.381, 78.481),
      classification: 'unconfirmed_visual' as const,
    };
    await commit(() => {
      root.render(
        <TacticalMap
          detections={[confirmed, visual]}
          trackPoints={[track(17.37, 78.47, 0), track(17.39, 78.49, 10)]}
        />,
      );
    });
    const groups = mapLayers().filter(
      (layer): layer is L.LayerGroup => layer instanceof L.LayerGroup,
    );
    expect(groups.length).toBeGreaterThanOrEqual(4);
    const confirmedMarker = labelledPoint(confirmed.id);
    expect(confirmedMarker).toBeDefined();
    const visualMarker = mapLayers().find(
      (layer) => layer.getTooltip()?.getElement()?.textContent === visual.id,
    );
    if (!confirmedMarker || !visualMarker) throw new Error('Missing evidence family marker');
    const confirmedGroup = groups.find((group) => group.hasLayer(confirmedMarker));
    const visualGroup = groups.find((group) => group.hasLayer(visualMarker));
    expect(confirmedGroup).toBeDefined();
    expect(visualGroup).toBeDefined();
    expect(confirmedGroup).not.toBe(visualGroup);
    const trackLine = mapLayers().find(
      (layer) => layer instanceof L.Polyline && !(layer instanceof L.Polygon),
    );
    if (!trackLine) throw new Error('Missing recorded track');
    expect(groups.some((group) => group.hasLayer(trackLine))).toBe(true);
    await commit(() => {
      useUIStore.getState().setLayer('confirmedMines', false);
    });
    expect(labelledPoint(confirmed.id)).toBeUndefined();
    expect(
      mapLayers().some((layer) => layer.getTooltip()?.getElement()?.textContent === visual.id),
    ).toBe(true);
    expect(activeMap().hasLayer(trackLine)).toBe(true);
    await commit(() => {
      useUIStore.getState().setLayer('flightTrack', false);
    });
    expect(activeMap().hasLayer(trackLine)).toBe(false);
    expect(activeMap().hasLayer(visualMarker)).toBe(true);
  });
});
