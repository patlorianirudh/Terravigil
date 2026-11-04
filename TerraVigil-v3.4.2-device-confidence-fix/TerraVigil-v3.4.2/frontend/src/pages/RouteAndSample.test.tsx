import { ServiceError } from '../services/errors';
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Coordinate, SafePathResult, ScanSession } from '../domain/types';
import { toMission } from '../services/missionMappers';
import { useSessionStore } from '../state/sessionStore';
import { useTelemetryStore } from '../state/telemetryStore';
import { RoutePlannerPage } from './RoutePlannerPage';
import { SessionsPage } from './SessionsPage';
import { SessionDetailPage } from './SessionDetailPage';

const service = vi.hoisted(() => ({
  calculateSafePath: vi.fn(),
  loadSampleMission: vi.fn(),
  getDetections: vi.fn(),
  getSession: vi.fn(),
  getSessions: vi.fn(),
  getTrack: vi.fn(),
  getCoverage: vi.fn(),
  getMissionStatistics: vi.fn(),
}));
vi.mock('../services/api', () => ({ api: service }));
const appConfig = vi.hoisted(() => ({ dataMode: 'live', backendStyle: 'missions', wsUrl: '' }));
vi.mock('../config', () => ({ config: appConfig }));
vi.mock('../components/map/TacticalMap', () => ({
  TacticalMap: ({ onPickPoint }: { onPickPoint?: (point: Coordinate) => void }) => (
    <div>
      <button onClick={() => onPickPoint?.({ lat: 17.445, lon: 78.3465 })}>Pick origin</button>
      <button onClick={() => onPickPoint?.({ lat: 17.445, lon: 78.3495 })}>Pick destination</button>
    </div>
  ),
}));

const mission = (id: string): ScanSession => {
  const result = toMission({
    mission_id: id,
    location: id,
    status: 'COMPLETED',
    date: '2026-09-14T09:00:00Z',
  });
  if (result === null) throw new Error('The mission fixture must map to a session.');
  return result;
};
const endpoints = { start: { lat: 17.445, lon: 78.3465 }, end: { lat: 17.445, lon: 78.3495 } };
const sample = () => ({
  ...mission('SAMPLE-TV001'),
  isSample: true,
  sampleRoute: endpoints,
  notes: 'Synthetic practice survey.',
});
const foundRoute: SafePathResult = {
  sessionId: 'M1',
  pathFound: true,
  waypoints: [endpoints.start, { lat: 17.4449, lon: 78.348 }, endpoints.end],
  totalDistanceM: 321,
  minStandoffAchievedM: 7.4,
  confirmedDetectionsNearRoute: 1,
  unconfirmedDetectionsNearRoute: 2,
  disclaimer: 'Planning aid; ground clearance is not established.',
};

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function commit(action?: () => void) {
  await act(async () => {
    action?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent.trim() === label,
  );
}

async function renderPage(path = '/route') {
  await commit(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/route" element={<RoutePlannerPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/:id" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await commit();
}

async function pickEndpoints() {
  await commit(() => button('Pick origin')?.click());
  await commit(() => button('Pick destination')?.click());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks();
  appConfig.dataMode = 'live';
  appConfig.backendStyle = 'missions';
  service.getDetections.mockResolvedValue([]);
  service.getTrack.mockResolvedValue([]);
  service.getCoverage.mockResolvedValue(null);
  service.getMissionStatistics.mockResolvedValue(null);
  service.getSession.mockImplementation((id: string) =>
    Promise.resolve(id === 'SAMPLE-TV001' ? sample() : mission(id)),
  );
  service.getSessions.mockResolvedValue([mission('M1')]);
  service.calculateSafePath.mockResolvedValue(foundRoute);
  service.loadSampleMission.mockResolvedValue({
    sessionId: 'SAMPLE-TV001',
    synthetic: true,
    created: true,
    counts: { detections: 4, observations: 4, telemetry: 20 },
    suggestedRoute: endpoints,
  });
  useSessionStore.setState({ activeSession: mission('M1'), sessions: [mission('M1')] });
  useTelemetryStore.getState().clearHistory();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(async () => {
  await commit(() => {
    root.unmount();
  });
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

describe('live mission route workflow', () => {
  it('enables Compute route after both map endpoints and renders the returned metrics', async () => {
    await renderPage();
    expect(button('Compute route')?.disabled).toBe(true);
    await pickEndpoints();
    expect(button('Compute route')?.disabled).toBe(false);
    await commit(() => button('Compute route')?.click());
    await commit();
    expect(service.calculateSafePath).toHaveBeenCalledWith({
      sessionId: 'M1',
      ...endpoints,
      minStandoffM: 5,
      cautionWeight: 0.6,
    });
    expect(container.textContent).toContain('Computed route');
    expect(container.textContent).toContain('321');
    expect(container.textContent).toContain('7.4');
    expect(container.textContent).toContain('detections and observations');
    expect(container.textContent).toContain('Nearest evidence');
    expect(button('Export GeoJSON')).toBeDefined();
    await commit(() => button('Reset endpoints')?.click());
    expect(button('Export GeoJSON')).toBeUndefined();
    expect(button('Compute route')?.disabled).toBe(true);
  });

  it('renders an endpoint-blocked result with no route export or fabricated achieved standoff', async () => {
    service.calculateSafePath.mockResolvedValue({
      ...foundRoute,
      pathFound: false,
      waypoints: [],
      totalDistanceM: null,
      minStandoffAchievedM: null,
      confirmedDetectionsNearRoute: null,
      unconfirmedDetectionsNearRoute: null,
      failureReason: 'An endpoint is within the requested standoff of recorded evidence.',
    });
    await renderPage();
    await pickEndpoints();
    await commit(() => button('Compute route')?.click());
    await commit();
    expect(container.textContent).toContain('No route available');
    expect(container.textContent).toContain('An endpoint is within');
    expect(button('Export GeoJSON')).toBeUndefined();
    expect(container.querySelector('.map-sidebar-content dl')).toBeNull();
  });

  it('discards a result when preferences change and when an old mission reply arrives', async () => {
    await renderPage();
    await pickEndpoints();
    await commit(() => button('Compute route')?.click());
    await commit();
    expect(button('Export GeoJSON')).toBeDefined();
    await commit(() => {
      const input = container.querySelector<HTMLInputElement>('#standoff');
      if (input) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          '10',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    expect(button('Export GeoJSON')).toBeUndefined();
    let reply: ((value: SafePathResult) => void) | undefined;
    service.calculateSafePath.mockImplementation(
      () =>
        new Promise<SafePathResult>((resolve) => {
          reply = resolve;
        }),
    );
    await commit(() => button('Compute route')?.click());
    expect(button('Computing route…')?.disabled).toBe(true);
    await commit(() => {
      useSessionStore.getState().setActiveSession(mission('M2'));
    });
    await commit(() => reply?.({ ...foundRoute, totalDistanceM: 987 }));
    expect(container.textContent).not.toContain('987');
    expect(button('Export GeoJSON')).toBeUndefined();
    expect(button('Compute route')?.disabled).toBe(true);
  });

  it('shows a retryable error and resets it on new endpoints', async () => {
    service.calculateSafePath.mockRejectedValue(
      new ServiceError('unavailable', 'Route service is unavailable.'),
    );
    await renderPage();
    await pickEndpoints();
    await commit(() => button('Compute route')?.click());
    await commit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Route service is unavailable.',
    );
    expect(button('Try again')?.disabled).toBe(false);
    await commit(() => button('Pick origin')?.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('prefills only explicitly marked sample endpoints', async () => {
    useSessionStore.getState().setActiveSession(sample());
    await renderPage();
    expect(button('Use sample endpoints')).toBeDefined();
    await commit(() => button('Use sample endpoints')?.click());
    expect(button('Compute route')?.disabled).toBe(false);
    await commit(() => button('Compute route')?.click());
    expect(service.calculateSafePath).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'SAMPLE-TV001', ...endpoints }),
    );
    await commit(() => {
      useSessionStore.getState().setActiveSession(mission('M1'));
    });
    expect(button('Use sample endpoints')).toBeUndefined();
  });
});

describe('production mission selection', () => {
  it('hides practice missions and offers no sample loading action', async () => {
    service.getSessions.mockResolvedValue([sample(), mission('M1')]);
    useSessionStore.getState().setActiveSession(sample());
    await renderPage('/sessions');
    expect(button('Load sample mission')).toBeUndefined();
    expect(container.querySelector('.ev-session-list')?.textContent).toContain('M1');
    expect(container.querySelector('.ev-session-list')?.textContent).not.toContain('SAMPLE-TV001');
    expect(useSessionStore.getState().activeSession?.id).toBe('M1');
    expect(service.loadSampleMission).not.toHaveBeenCalled();
  });
});
