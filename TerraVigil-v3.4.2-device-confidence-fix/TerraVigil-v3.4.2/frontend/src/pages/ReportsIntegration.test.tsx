// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReportItem, ScanSession } from '../domain/types';
import { useSessionStore } from '../state/sessionStore';
import { ReportsPage } from './ReportsPage';

const service = vi.hoisted(() => ({ getReports: vi.fn(), generateReport: vi.fn() }));
vi.mock('../services/api', () => ({ api: service }));
vi.mock('../config', () => ({
  config: { dataMode: 'live', backendStyle: 'missions', apiBaseUrl: '/api' },
}));
const report: ReportItem = {
  id: 'R1',
  reportNumber: 1,
  sessionId: 'M1',
  siteName: 'Test survey',
  generatedAt: '2026-09-23T10:00:00Z',
  status: 'ready',
  formulaVersion: 'stored-v1',
  contentHash: 'sha256-content',
  downloadUrl: '/api/reports/R1/download?format=pdf',
  csvDownloadUrl: '/api/reports/R1/download?format=csv',
  generationMode: 'factual',
  synthetic: false,
  hardware: {
    edgeComputer: 'NVIDIA Jetson Nano 4GB',
    aircraft: 'ZD550',
    flightController: 'Pixhawk',
  },
  recordCounts: {
    firebaseEvents: 3,
    firebaseMatched: 2,
    firebasePending: 1,
    firebaseInvalid: 0,
    firebaseRemoved: 0,
    imageInferenceRuns: 0,
    imagePredictions: 0,
    unlocalizedImagePredictions: 0,
  },
  summary: {
    confirmedMinesCount: 2,
    unconfirmedVisualCount: 1,
    unresolvedMetalCount: 0,
    highRiskCount: 1,
    mediumRiskCount: 1,
    lowRiskCount: 1,
    visualSweptAreaM2: null,
    dualSweptAreaM2: null,
  },
};
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const commit = async (action?: () => void) =>
  act(async () => {
    action?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent.includes(text));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  service.getReports.mockResolvedValue([report]);
  service.generateReport.mockImplementation((_id: string, includeAi: boolean) =>
    Promise.resolve({
      ...report,
      generationMode: includeAi ? 'rag' : 'factual',
    }),
  );
  useSessionStore.setState({
    activeSession: { id: 'M1', siteName: 'Test survey', isSample: false } as ScanSession,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await commit(() => {
    root.unmount();
  });
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
const render = async () => {
  await commit(() => {
    root.render(
      <QueryClientProvider client={client}>
        <ReportsPage />
      </QueryClientProvider>,
    );
  });
  await commit();
};

it('generates factual editions by default and opens exact PDF and CSV download routes', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  await render();
  expect(button('Generate report')?.disabled).toBe(false);
  await commit(() => button('Generate report')?.click());
  expect(service.generateReport).toHaveBeenCalledWith('M1', false);
  expect(container.textContent).toContain('Factual snapshot');
  expect(container.textContent).not.toContain('Synthetic mission data');
  expect(container.textContent).toContain('NVIDIA Jetson Nano 4GB');
  expect(container.textContent).toContain('Firebase records / mapped');
  await commit(() => button('Download survey PDF')?.click());
  expect(open).toHaveBeenLastCalledWith(
    '/api/reports/R1/download?format=pdf',
    '_blank',
    'noopener,noreferrer',
  );
  await commit(() => button('Download evidence CSV')?.click());
  expect(open).toHaveBeenLastCalledWith(
    '/api/reports/R1/download?format=csv',
    '_blank',
    'noopener,noreferrer',
  );
  open.mockRestore();
});

it('requests AI narrative only when selected and exposes missing-provider failures without a success notice', async () => {
  service.generateReport.mockRejectedValue(new Error('Gemini is not configured on the backend.'));
  await render();
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Report generation mode"]',
  );
  expect(select).not.toBeNull();
  await commit(() => {
    if (select) {
      select.value = 'rag';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await commit(() => button('Generate report')?.click());
  expect(service.generateReport).toHaveBeenCalledWith('M1', true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Gemini is not configured',
  );
  expect(container.querySelector('.ev-notice')).toBeNull();
});

it('displays archived AI narrative and its citations with generation provenance', async () => {
  service.getReports.mockResolvedValue([
    {
      ...report,
      generationMode: 'rag',
      narrative: 'One visual observation needs review.',
      sources: [{ document: 'Observation OBS1', section: 'M1', snippet: 'Visual record only.' }],
    },
  ]);
  await render();
  expect(container.textContent).toContain('AI narrative · RAG');
  expect(container.textContent).toContain('One visual observation needs review.');
  expect(container.textContent).toContain('Observation OBS1');
  expect(container.querySelector('[aria-label="Archived source references"]')).not.toBeNull();
  expect(container.textContent).toContain('Numbered AI references are unavailable');
});

it('matches AI reference numbers to narrative sources while keeping factual records unnumbered', async () => {
  service.getReports.mockResolvedValue([
    {
      ...report,
      generationMode: 'rag',
      narrative: 'The retrieved observation needs review [1].',
      sources: [
        { document: 'Mission snapshot', section: 'M1', snippet: 'Factual mission record.' },
        { document: 'Flight telemetry', section: 'M1', snippet: 'Factual telemetry record.' },
      ],
      narrativeSources: [
        {
          citationNumber: 1,
          document: 'Retrieved observation OBS9',
          section: 'M1',
          sourceRecordId: 'OBS9',
          snippet: 'Visual evidence used in the narrative.',
        },
      ],
    },
  ]);
  await render();
  const narrativeSources = container.querySelector('[aria-label="AI narrative citations"]');
  const factualSources = container.querySelector('[aria-label="Factual source records"]');
  expect(narrativeSources?.textContent).toContain('[1] Retrieved observation OBS9');
  expect(narrativeSources?.textContent).not.toContain('Mission snapshot');
  expect(factualSources?.textContent).toContain('Mission snapshot');
  expect(factualSources?.textContent).toContain('Flight telemetry');
  expect(factualSources?.textContent).not.toContain('[1]');
  expect(factualSources?.textContent).not.toContain('Retrieved observation OBS9');
});

it('shows image-only run and prediction counts without treating them as confirmed observations', async () => {
  service.getReports.mockResolvedValue([
    {
      ...report,
      synthetic: false,
      summary: {
        ...report.summary,
        confirmedMinesCount: 0,
        unconfirmedVisualCount: 0,
        unresolvedMetalCount: 0,
      },
      recordCounts: { imageInferenceRuns: 1, imagePredictions: 5, unlocalizedImagePredictions: 5 },
    },
  ]);
  await render();
  const inference = container.querySelector('[aria-label="Image inference summary"]');
  expect(inference).not.toBeNull();
  expect(
    [...(inference?.querySelectorAll('strong') ?? [])].map((item) => item.textContent),
  ).toEqual(['1', '5', '5']);
  expect(inference?.textContent).toContain('Image runs');
  expect(inference?.textContent).toContain('Model predictions');
  expect(inference?.textContent).toContain('Targets not localized');
  expect([...container.querySelectorAll('.ev-report-metrics')][0]?.textContent).toContain(
    '0Confirmed records',
  );
});
