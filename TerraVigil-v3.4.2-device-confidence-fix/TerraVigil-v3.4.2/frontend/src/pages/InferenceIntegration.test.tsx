// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ScanSession } from '../domain/types';
import { useSessionStore } from '../state/sessionStore';
import { ModelInferencePage } from './ModelInferencePage';
import { ReportsPage } from './ReportsPage';

const service = vi.hoisted(() => ({
  getInferenceStatus: vi.fn(),
  predictImage: vi.fn(),
  getSession: vi.fn(),
  getReports: vi.fn(),
  generateReport: vi.fn(),
}));
vi.mock('../services/api', () => ({ api: service }));
const model = {
  name: 'best.pt',
  sha256: 'model-checksum',
  task: 'detect',
  device: 'cpu',
  classes: [{ id: 1, name: 'land_mines' }],
};
const status = {
  ready: true,
  status: 'ready',
  model,
  runtime: { python: '3.11' },
  limits: {
    maxImageBytes: 10485760,
    maxImagePixels: 20000000,
    minConfidence: 0.01,
    maxConfidence: 1,
  },
};
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const commit = async (action?: () => void) =>
  act(async () => {
    action?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
const runButton = () =>
  [...container.querySelectorAll('button')].find((button) =>
    button.textContent.includes('Run inference'),
  );
const render = async () => {
  await commit(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ModelInferencePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await commit();
};
const upload = async (file = new File(['image bytes'], 'survey.png', { type: 'image/png' })) => {
  await commit(() => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input) {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await commit();
};
const field = async (name: string, value: string) =>
  commit(() => {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  service.getInferenceStatus.mockResolvedValue(status);
  service.getSession.mockResolvedValue({
    id: 'MODEL-1',
    siteName: 'Inference survey',
    isSample: false,
  });
  service.getReports.mockResolvedValue([]);
  service.generateReport.mockResolvedValue({ id: 'R1', reportNumber: 1, status: 'ready' });
  service.predictImage.mockResolvedValue({
    runId: 'run1',
    missionId: 'MODEL-1',
    model,
    image: { width: 400, height: 300 },
    imageUrl: '/api/inference/files/run1.png',
    annotatedImageUrl: '/api/inference/files/run1-annotated.jpg',
    persistedObservations: 1,
    predictions: [
      {
        classId: 1,
        className: 'land_mines',
        confidence: 0.87,
        bbox: [10, 20, 30, 40],
        normalizedCenter: { x: 0.05, y: 0.1 },
      },
    ],
  });
  useSessionStore.setState({
    activeSession: {
      id: 'SAMPLE-TV001',
      siteName: 'Synthetic sample',
      isSample: true,
    } as ScanSession,
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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

it('runs a selected image with zero-valued GPS and links the actual new inference mission', async () => {
  await render();
  await upload();
  await field('Latitude', '0');
  await field('Longitude', '0');
  await commit(() => runButton()?.click());
  await commit();
  expect(service.predictImage).toHaveBeenCalledWith(
    expect.objectContaining({
      filename: 'survey.png',
      confidence: 0.25,
      latitude: 0,
      longitude: 0,
      missionId: 'SAMPLE-TV001',
    }),
  );
  expect(container.querySelector('img[alt="Model annotated result"]')?.getAttribute('src')).toBe(
    '/api/inference/files/run1-annotated.jpg',
  );
  expect(container.textContent).toContain('land_mines');
  expect(container.textContent).toContain('87.0%');
  expect(container.textContent).toContain('1 unconfirmed observation');
  expect(container.querySelector('a[href="/sessions/MODEL-1"]')).not.toBeNull();
  expect(container.textContent).toContain('Image location');
});

it('blocks incomplete GPS pairs and invalid image files without submitting inference', async () => {
  await render();
  await upload(new File(['text'], 'notes.txt', { type: 'text/plain' }));
  expect(runButton()?.disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/JPEG.*PNG.*WebP/);
  await upload();
  await field('Latitude', '10');
  await commit(() => runButton()?.click());
  expect(service.predictImage).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/both.*coordinates/i);
});

it('shows a runtime readiness error and never enables inference while unavailable', async () => {
  service.getInferenceStatus.mockResolvedValue({
    ...status,
    ready: false,
    status: 'unavailable',
    error: { code: 'INFERENCE_RUNTIME_UNAVAILABLE', message: 'Python dependencies are missing.' },
  });
  await render();
  await upload();
  expect(container.textContent).toContain('Python dependencies are missing.');
  expect(runButton()?.disabled).toBe(true);
  expect(service.predictImage).not.toHaveBeenCalled();
});

it('keeps a validated but busy model unavailable for another upload', async () => {
  service.getInferenceStatus.mockResolvedValue({ ...status, ready: true, status: 'busy' });
  await render();
  await upload();
  expect(container.textContent).toContain('Model is processing an image');
  expect(runButton()?.disabled).toBe(true);
});

it('selects the returned inference mission before navigation so report generation uses its records', async () => {
  await commit(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<ModelInferencePage />} />
            <Route path="/sessions/:id" element={<Link to="/reports">Open reports</Link>} />
            <Route path="/reports" element={<ReportsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await commit();
  await upload();
  await commit(() => runButton()?.click());
  await commit();
  await commit(() =>
    container.querySelector<HTMLAnchorElement>('a[href="/sessions/MODEL-1"]')?.click(),
  );
  await commit();
  expect(useSessionStore.getState().activeSession?.id).toBe('MODEL-1');
  expect(service.getSession).toHaveBeenCalledWith('MODEL-1');
  await commit(() => container.querySelector<HTMLAnchorElement>('a[href="/reports"]')?.click());
  await commit();
  expect(container.querySelector('.ev-current-context')?.textContent).toContain('Inference survey');
  await commit(() =>
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Generate report')
      ?.click(),
  );
  expect(service.generateReport).toHaveBeenCalledWith('MODEL-1', false);
});

it('keeps the inference result visible and exposes an error if its mission cannot be resolved', async () => {
  service.getSession.mockResolvedValue(null);
  await render();
  await upload();
  await commit(() => runButton()?.click());
  await commit();
  await commit(() =>
    container.querySelector<HTMLAnchorElement>('a[href="/sessions/MODEL-1"]')?.click(),
  );
  await commit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Inference mission could not be loaded',
  );
  expect(useSessionStore.getState().activeSession?.id).toBe('SAMPLE-TV001');
  expect(container.querySelector('img[alt="Model annotated result"]')).not.toBeNull();
});
