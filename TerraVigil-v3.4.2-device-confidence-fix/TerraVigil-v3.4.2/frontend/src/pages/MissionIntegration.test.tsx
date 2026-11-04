// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, Detection, ScanSession } from '../domain/types';
import { useSessionStore } from '../state/sessionStore';
import { RiskBadge } from '../components/ui/RiskBadge';
import { useRiskSurface } from '../hooks/useRiskSurface';
import { AssistantPage } from './AssistantPage';
import { DetectionDetailPage } from './DetectionDetailPage';
import { LiveConsolePage } from './LiveConsolePage';
import { useTelemetryStore } from '../state/telemetryStore';

const service = vi.hoisted(() => ({
  getRiskSurface: vi.fn(),
  queryAssistant: vi.fn(),
  getDetection: vi.fn(),
  getDetections: vi.fn(),
  getSession: vi.fn(),
  getTrack: vi.fn(),
  getCoverage: vi.fn(),
  getMissionStatistics: vi.fn(),
  prepareMission: vi.fn(),
  getMe: vi.fn(),
  getSessions: vi.fn(),
  getDetectionClasses: vi.fn(),
}));
vi.mock('../services/api', () => ({ api: service }));
const mapDetections = vi.hoisted(() => vi.fn<(records: Detection[]) => void>());
vi.mock('../components/map/TacticalMap', () => ({
  TacticalMap: ({ detections = [] }: { detections?: Detection[] }) => {
    mapDetections(detections);
    return null;
  },
}));
const appConfig = vi.hoisted(() => ({
  dataMode: 'live',
  backendStyle: 'missions',
  wsUrl: '',
  apiBaseUrl: '/api',
}));
vi.mock('../config', () => ({ config: appConfig }));

const mission = (id: string) => ({ id, siteName: id, config: {} }) as ScanSession;
const observation = {
  id: 'observation:OBS-1',
  sessionId: 'M1',
  classification: 'unconfirmed_visual',
  riskBand: 'high',
  riskScore: null,
  riskInputs: null,
  position: { lat: 10, lon: 106 },
  visualCandidateIds: [],
  metalHitIds: [],
  reviewHistory: [],
  reviewState: null,
  imageRef: 'captures/OBS-1.jpg',
  bestVisualConfidence: 0.8,
  bestMetalSignalNorm: null,
  vlmVerdict: 'not_run',
  firstObservedAt: '2026-09-20T10:00:00.000Z',
  lastObservedAt: '2026-09-20T10:00:00.000Z',
} as unknown as Detection;

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function commit(action?: () => void) {
  await act(async () => {
    action?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  appConfig.dataMode = 'live';
  appConfig.backendStyle = 'missions';
  service.getRiskSurface.mockResolvedValue([observation]);
  service.getDetection.mockResolvedValue(observation);
  service.getDetections.mockResolvedValue([observation]);
  service.getSession.mockResolvedValue(mission('M1'));
  service.getTrack.mockResolvedValue([]);
  service.getCoverage.mockResolvedValue(null);
  service.getMissionStatistics.mockResolvedValue({
    sessionId: 'M1',
    totalRecords: 15,
    confirmed: 7,
    unconfirmed: 8,
    risk: { high: 8, medium: 4, low: 2 },
  });
  service.prepareMission.mockResolvedValue({
    sessionId: 'M1',
    status: 'ready',
    indexedChunks: 3,
    sourceHash: 'test-hash',
    generation: 'test-generation',
    model: 'test-model',
    reused: true,
  });
  service.getMe.mockResolvedValue(null);
  service.getSessions.mockResolvedValue([mission('M1'), mission('M2')]);
  service.getDetectionClasses.mockResolvedValue([]);
  useTelemetryStore.getState().clearHistory();
  useSessionStore.setState({
    activeSession: mission('M1'),
    sessions: [mission('M1'), mission('M2')],
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  vi.useRealTimers();
  await commit(() => {
    root.unmount();
  });
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

describe('mission evidence presentation', () => {
  it('identifies uploaded inference imagery and supplied image coordinates without claiming a radio capture', async () => {
    service.getDetection.mockResolvedValue({
      ...observation,
      inferenceRunId: 'run1',
      locationSource: 'user_supplied_image_location',
      targetLocationKnown: false,
      fullFrameUrl: '/api/inference/files/run1.jpg',
      thumbnailUrl: '/api/inference/files/run1.jpg',
    });
    await commit(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/detections/inference']}>
            <Routes>
              <Route path="/detections/:id" element={<DetectionDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await commit();
    expect(container.textContent).toContain('Image location supplied');
    expect(container.textContent).toContain('Image location (target not localized)');
    expect(container.textContent).toContain('Uploaded image');
    expect(container.textContent).not.toContain('Radio frame');
  });

  it('shows risk without asserting confirmation', async () => {
    await commit(() => {
      root.render(<RiskBadge band="high" />);
    });
    expect(container.textContent).toContain('HIGH risk');
    expect(container.textContent).not.toContain('Confirmed');
  });

  it('retains high-risk unconfirmed observations in the risk query', async () => {
    function RiskRecords() {
      const { data } = useRiskSurface('M1');
      return <span>{data?.map((record) => record.id).join(',')}</span>;
    }
    await commit(() => {
      root.render(
        <QueryClientProvider client={client}>
          <RiskRecords />
        </QueryClientProvider>,
      );
    });
    await commit();
    expect(container.textContent).toContain('observation:OBS-1');
  });

  it('renders an unconfirmed high-risk detail without inventing a numeric score', async () => {
    await commit(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/detections/observation:OBS-1']}>
            <Routes>
              <Route path="/detections/:id" element={<DetectionDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await commit();
    expect(container.querySelector('.ev-risk-body')?.textContent).toContain('HIGH risk');
    expect(container.querySelector('.ev-risk-body')?.textContent).not.toContain('Not risk-scored');
    expect(container.querySelector('.ev-risk-score strong')?.textContent).toBe('—');
    expect(service.getDetections).not.toHaveBeenCalled();
    expect(container.querySelector('.ev-image-unavailable')?.textContent).toContain(
      'captures/OBS-1.jpg',
    );
    expect(container.querySelector('img[src="captures/OBS-1.jpg"]')).toBeNull();
  });

  it('shows a raw altitude without assigning an AGL datum', async () => {
    service.getTrack.mockResolvedValue([
      {
        sessionId: 'M1',
        tUtc: '2026-09-20T10:00:00.000Z',
        position: { lat: 10, lon: 106, altAglM: null, altitudeM: 25.4 },
      },
    ]);
    await commit(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <LiveConsolePage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await commit();
    const readout = container.querySelector('.telemetry-cell');
    expect(readout?.querySelector('strong')?.textContent).toBe('25.4');
    expect(readout?.textContent).toContain('Datum unreported');
    expect(readout?.textContent).not.toContain('AGL');
  });
});

describe('mission assistant scope', () => {
  it('shows actual model preparation for synthetic records and exposes provider failures', async () => {
    useSessionStore.getState().setActiveSession({ ...mission('M1'), isSample: true });
    service.queryAssistant.mockRejectedValue(new Error('Gemini is not configured on the backend.'));
    await commit(() => {
      root.render(<AssistantPage />);
    });
    await commit(() =>
      container.querySelector<HTMLButtonElement>('.assistant-prompts button')?.click(),
    );
    await commit(() =>
      container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(container.textContent).toContain('3 chunks');
    expect(container.textContent).toContain('test-model');
    expect(container.textContent).toContain('Synthetic');
    expect(container.textContent).not.toContain('No AI model is connected');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Gemini is not configured',
    );
  });

  it('resets conversation on mission changes and discards an old mission reply', async () => {
    let finishFirst: ((reply: AssistantMessage) => void) | undefined;
    service.queryAssistant.mockImplementation(
      () =>
        new Promise<AssistantMessage>((resolve) => {
          finishFirst = resolve;
        }),
    );
    await commit(() => {
      root.render(<AssistantPage />);
    });
    await commit(() =>
      container.querySelector<HTMLButtonElement>('.assistant-prompts button')?.click(),
    );
    await commit(() =>
      container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(service.queryAssistant).toHaveBeenCalledWith(expect.any(String), 'M1');
    expect(container.querySelectorAll('.assistant-message')).toHaveLength(1);
    await commit(() => {
      useSessionStore.getState().setActiveSession(mission('M2'));
    });
    expect(container.querySelectorAll('.assistant-message')).toHaveLength(0);
    await commit(() =>
      finishFirst?.({
        id: 'reply-1',
        sender: 'assistant',
        text: 'M1 private reply',
        timestamp: '2026-09-20T10:00:00.000Z',
      }),
    );
    expect(container.textContent).not.toContain('M1 private reply');
    expect(container.textContent).toContain('M2');
  });
});

describe('mission REST polling', () => {
  it('refreshes displayed records at five seconds while mounted, replaces track rereads and ignores old mission replies', async () => {
    const { useRealtimeBridge } = await import('../hooks/useRealtimeBridge');
    const { useDetections } = await import('../hooks/useDetections');
    const { useTrack } = await import('../hooks/useTrack');
    function Records() {
      useRealtimeBridge();
      const id = useSessionStore((state) => state.activeSession?.id);
      const { detections } = useDetections(id);
      const { data: track = [] } = useTrack(id);
      return (
        <p>
          {detections.map((record) => record.id).join(',')} / {track.length} points
        </p>
      );
    }
    const point = { sessionId: 'M1', tUtc: '2026-01-01T00:00:00Z', position: { lat: 17, lon: 78 } };
    service.getTrack.mockResolvedValue([point]);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await commit(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Records />
        </QueryClientProvider>,
      );
    });
    await commit();
    service.getDetections.mockResolvedValue([observation, { ...observation, id: 'new-record' }]);
    service.getTrack.mockResolvedValue([point, { ...point, tUtc: '2026-01-01T00:00:01Z' }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await commit();
    expect(container.textContent).toContain('new-record');
    expect(container.textContent).toContain('2 points');
    expect(useTelemetryStore.getState().trackHistory).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await commit();
    expect(useTelemetryStore.getState().trackHistory).toHaveLength(2);
    let reply: ((value: unknown[]) => void) | undefined;
    service.getTrack.mockImplementation((id: string) =>
      id === 'M1'
        ? new Promise<unknown[]>((resolve) => {
            reply = resolve;
          })
        : Promise.resolve([]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await commit();
    act(() => {
      useSessionStore.getState().setActiveSession(mission('M2'));
    });
    expect(useTelemetryStore.getState().trackHistory).toEqual([]);
    await commit(() => {
      reply?.([point]);
    });
    expect(useTelemetryStore.getState().latestTelemetry?.sessionId).not.toBe('M1');
    vi.useRealTimers();
  });
});

it('shows backend mission counts and separates confirmed and unconfirmed HIGH risk', async () => {
  const { RiskMapPage } = await import('./RiskMapPage');
  service.getRiskSurface.mockResolvedValue([
    observation,
    { ...observation, id: 'confirmed-1', classification: 'confirmed' },
  ]);
  await commit(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RiskMapPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await commit();
  const totals = container.querySelectorAll('.risk-summary-strip strong');
  expect(totals[0]?.textContent).toContain('7');
  expect(totals[1]?.textContent).toContain('8');
  const high = container.querySelector('.risk-band-row');
  expect(high?.textContent).toContain('1 confirmed');
  expect(high?.textContent).toContain('1 unconfirmed');
  expect(container.textContent).not.toContain('Score ≥');
});

it('switches the selected mission using the existing workspace chrome', async () => {
  const { TopBar } = await import('../components/layout/TopBar');
  await commit(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TopBar />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await commit();
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Selected mission"]',
  );
  expect(select).not.toBeNull();
  await commit(() => {
    if (select) {
      select.value = 'M2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  expect(useSessionStore.getState().activeSession?.id).toBe('M2');
});

it('shows a stored confirmation warning alongside contradictory sensor evidence', async () => {
  service.getDetection.mockResolvedValue({
    ...observation,
    sourceStatus: 'CONFIRMED',
    classification: 'confirmed',
    metalDetected: false,
    validationIssue: 'Stored confirmation contradicts the supplied sensor evidence.',
  });
  await commit(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/detections/problem']}>
          <Routes>
            <Route path="/detections/:id" element={<DetectionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await commit();
  expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/contradicts/);
  expect(container.textContent).toContain('Metal detected');
  expect(container.textContent).not.toContain('Confirmed mine');
});

it('keeps undated observations in all-time analytics without inventing a day or duration', async () => {
  const { AnalyticsPage } = await import('./AnalyticsPage');
  service.getDetections.mockResolvedValue([
    { ...observation, firstObservedAt: '', lastObservedAt: '' },
  ]);
  service.getSessions.mockResolvedValue([
    { ...mission('M1'), startedAt: '', endedAt: null, state: 'ended' },
  ]);
  await commit(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AnalyticsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await commit();
  expect(container.querySelector('.workspace-stat strong')?.textContent).toBe('1');
  expect(container.querySelector('.workspace-stat-time')?.textContent).toBe('—');
  expect(container.textContent).toContain('1 observation without a reported date');
  expect(container.textContent).not.toContain(
    'Single-sensor observations do not receive a risk band',
  );
});

describe('preserved adapter page behavior', () => {
  it.each(['demo', 'prd'] as const)(
    'keeps all mission observation classes on the %s risk map without duplicates',
    async (adapter) => {
      const { RiskMapPage } = await import('./RiskMapPage');
      const { DemoApiService } = await import('../services/demo');
      const demo = new DemoApiService(false);
      const session = await demo.getSession('SAMPLE-TV001');
      const records = await demo.getDetections('SAMPLE-TV001');
      const risk = await demo.getRiskSurface('SAMPLE-TV001');
      const firstVisual = records.find((record) => record.classification === 'unconfirmed_visual');
      expect(firstVisual).toBeDefined();
      appConfig.dataMode = adapter === 'demo' ? 'demo' : 'live';
      appConfig.backendStyle = 'prd';
      useSessionStore.getState().setActiveSession(session);
      service.getRiskSurface.mockResolvedValue([...risk, ...risk]);
      service.getDetections.mockResolvedValue([
        ...records,
        firstVisual,
        { ...firstVisual, sessionId: 'another-mission' },
      ]);
      await commit(() => {
        root.render(
          <QueryClientProvider client={client}>
            <MemoryRouter>
              <RiskMapPage />
            </MemoryRouter>
          </QueryClientProvider>,
        );
      });
      await commit();
      const totals = container.querySelectorAll('.risk-summary-strip strong');
      expect(totals[1]?.firstChild?.textContent).toBe('4');
      expect(totals[2]?.firstChild?.textContent).toBe('0');
      const displayed = mapDetections.mock.lastCall?.[0] ?? [];
      expect(
        displayed.filter((record) => record.classification === 'unconfirmed_visual'),
      ).toHaveLength(4);
      expect(
        displayed.filter((record) => record.classification === 'unresolved_metal'),
      ).toHaveLength(0);
      expect(new Set(displayed.map((record) => record.id)).size).toBe(displayed.length);
      expect(displayed.every((record) => record.sessionId === 'SAMPLE-TV001')).toBe(true);
    },
  );

  it('removes only the visual summary card and shows all classes without inflating confirmations', async () => {
    const { DetectionsPage } = await import('./DetectionsPage');
    service.getDetections.mockResolvedValue([
      { ...observation, id: 'camera-landmine', className: 'land_mines', classId: '12' },
      { ...observation, id: 'camera-no-class', className: null, classId: null },
      { ...observation, id: 'corroborated', classification: 'confirmed', className: 'land_mines' },
    ]);
    await commit(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <DetectionsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await commit();
    const cards = [...container.querySelectorAll<HTMLButtonElement>('.ev-stat')];
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.querySelector('.ev-stat-top > span')?.textContent)).toEqual([
      'Confirmed mines',
      'Metal observations',
      'Review queue',
    ]);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(container.querySelector('#detection-tab-all')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(container.querySelector('tbody')?.textContent).toContain('land_mines');
    expect(container.querySelector('tbody')?.textContent).toContain('Class not supplied');
    expect(container.querySelector('tbody')?.textContent).toContain('Visual detection');
    expect(
      container.querySelector('[title="Camera detection only; no confirmed metal corroboration."]'),
    ).not.toBeNull();
    expect(cards[0]?.querySelector('strong')?.textContent).toBe('01');
    await commit(() => cards[0]?.click());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('tbody')?.textContent).toContain('corroborated');
    await commit(() =>
      container.querySelector<HTMLButtonElement>('#detection-tab-unconfirmed_visual')?.click(),
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelector('tbody')?.textContent).not.toContain('corroborated');
  });

  it('keeps camera detections in the live map and feed without counting metal confirmation', async () => {
    const cameraRecord = {
      ...observation,
      className: 'land_mines',
      classId: '12',
      metalDetected: null,
    };
    service.getDetections.mockResolvedValue([cameraRecord]);
    await commit(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <LiveConsolePage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await commit();
    expect(container.querySelector('.evidence-count-note')?.textContent).toBe('0 confirmed');
    expect(container.querySelector('.field-detection-row')?.textContent).toContain('land_mines');
    expect(container.querySelector('.field-detection-row')?.textContent).toContain(
      'Visual detection',
    );
    expect(mapDetections.mock.lastCall?.[0]).toEqual([cameraRecord]);
    expect(container.querySelector('[aria-label="Flight and sensor telemetry"]')).not.toBeNull();
    expect(container.querySelector('.swept-summary')?.textContent).toContain(
      'Derived swept ground',
    );
  });

  it('shows mission review status as unavailable and keeps disabled review filters from hiding records', async () => {
    const { DetectionsPage } = await import('./DetectionsPage');
    service.getDetections.mockResolvedValue([
      { ...observation, classification: 'confirmed', reviewState: null },
    ]);
    await commit(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <DetectionsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await commit();
    const queue = [...container.querySelectorAll<HTMLButtonElement>('.ev-stat')].find((button) =>
      button.textContent.includes('Review queue'),
    );
    const filter = container.querySelector<HTMLButtonElement>('.ev-filter-button');
    expect(queue?.querySelector('strong')?.textContent).toBe('—');
    expect(queue?.textContent).toContain('Review unavailable');
    expect(queue?.disabled).toBe(true);
    expect(filter?.disabled).toBe(true);
    await commit(() => {
      queue?.click();
      filter?.click();
    });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.textContent).not.toContain('No matching observations');
  });

  it('preserves the usable review queue for an adapter that supplies review data', async () => {
    const { DetectionsPage } = await import('./DetectionsPage');
    appConfig.dataMode = 'demo';
    service.getDetections.mockResolvedValue([
      {
        ...observation,
        id: 'pending-review',
        classification: 'confirmed',
        reviewState: 'unreviewed',
      },
      {
        ...observation,
        id: 'endorsed-review',
        classification: 'confirmed',
        reviewState: 'operator_endorsed',
      },
    ]);
    await commit(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <DetectionsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await commit();
    const queue = [...container.querySelectorAll<HTMLButtonElement>('.ev-stat')].find((button) =>
      button.textContent.includes('Review queue'),
    );
    expect(queue?.disabled).toBe(false);
    expect(queue?.querySelector('strong')?.textContent).toBe('01');
    await commit(() => {
      queue?.click();
    });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('tbody')?.textContent).toContain('pending-review');
    expect(container.querySelector('tbody')?.textContent).not.toContain('endorsed-review');
  });
});
