import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedRequest {
  path: string;
  query: string;
  method: string;
  credentials: RequestCredentials | undefined;
  headers: Headers;
  body: unknown;
}

interface Reply {
  status?: number;
  body: unknown;
}
type Route = Reply | ((request: RecordedRequest) => Reply);

function serve(routes: Record<string, Route>): RecordedRequest[] {
  const calls: RecordedRequest[] = [];
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const call: RecordedRequest = {
      path: url.pathname,
      query: url.search,
      method: init?.method ?? 'GET',
      credentials: init?.credentials,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    const response = typeof route === 'function' ? route(call) : route;
    return Promise.resolve(
      new Response(JSON.stringify(response?.body ?? { message: 'Not found' }), {
        status: response?.status ?? (route ? 200 : 404),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  return calls;
}

const mission = {
  _id: 'mongo-mission',
  mission_id: 'M1',
  location: 'North sector',
  status: 'COMPLETED',
  date: '2026-09-14T09:00:00.000Z',
};
const confirmed = {
  _id: 'mongo-detection-a',
  detection_id: 'D001',
  mission_id: 'M1',
  latitude: 17.1,
  longitude: 78.2,
  timestamp: '2026-09-14T09:01:00.000Z',
  status: 'CONFIRMED',
  yolo_confidence: 0.97,
  metal_detected: true,
  metal_signal: 0.82,
  risk_level: 'LOW',
  image_path: '/home/jetson/frame.jpg',
};
const observation = {
  _id: 'mongo-observation-a',
  mission_id: 'M1',
  latitude: 17.2,
  longitude: 78.3,
  created_at: '2026-09-14T09:03:00.000Z',
  status: 'UNCONFIRMED',
  yolo_confidence: 0.91,
  metal_detected: false,
  risk_level: 'HIGH',
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'live');
  vi.stubEnv('VITE_BACKEND_STYLE', 'missions');
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');
  vi.stubEnv('VITE_WS_URL', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('mission backend integration', () => {
  it('loads unique mission selectors without inventing flight configuration', async () => {
    const calls = serve({
      'GET /missions': {
        body: [mission, { ...mission, _id: 'duplicate-mission' }],
      },
    });
    const { api } = await import('./api');
    const sessions = await api.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'M1',
      siteName: 'North sector',
      state: 'ended',
      flightMode: null,
      startedAt: '2026-09-14T09:00:00.000Z',
      endedAt: null,
      operatorName: null,
      config: { nominalAglM: null, visualConfidenceThreshold: null },
    });
    expect(calls[0]?.credentials).toBe('omit');
    expect(calls[0]?.headers.has('Authorization')).toBe(false);
    const { config } = await import('../config');
    expect(config.isConfigured).toBe(true);
  });

  it('retains duplicate logical IDs and stored risk while isolating the requested mission', async () => {
    serve({
      'GET /missions/M1/detections': {
        body: [
          confirmed,
          { ...confirmed, _id: 'mongo-detection-b', timestamp: '2026-09-14T09:02:00.000Z' },
          { ...confirmed, _id: 'foreign', mission_id: 'M2' },
        ],
      },
      'GET /missions/M1/observations': { body: [observation] },
    });
    const { api } = await import('./api');
    const rows = await api.getDetections('M1');
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows.map((row) => row.lastObservedAt)).toEqual([
      '2026-09-14T09:03:00.000Z',
      '2026-09-14T09:02:00.000Z',
      '2026-09-14T09:01:00.000Z',
    ]);
    expect(rows[0]).toMatchObject({
      sourceId: null,
      sourceRecordId: 'mongo-observation-a',
      sourceType: 'observation',
      classification: 'unconfirmed_visual',
      metalDetected: false,
      bestMetalSignalNorm: null,
      riskBand: 'high',
      riskScore: null,
      riskInputs: null,
      reviewState: null,
      imageRef: null,
    });
    expect(rows[2]).toMatchObject({
      sourceId: 'D001',
      sourceRecordId: 'mongo-detection-a',
      riskBand: 'low',
      riskScore: null,
      imageRef: '/home/jetson/frame.jpg',
      thumbnailUrl: null,
      fullFrameUrl: null,
    });
  });

  it('resolves a detail URL after reload using the stored record identity', async () => {
    const calls = serve({
      'GET /missions/M1/detections': {
        body: [confirmed, { ...confirmed, _id: 'mongo-detection-b', risk_level: 'MEDIUM' }],
      },
      'GET /missions/M1/observations': { body: [] },
    });
    const firstApi = (await import('./api')).api;
    const listed = await firstApi.getDetections('M1');
    const selected = listed.find((row) => row.sourceRecordId === 'mongo-detection-b');
    expect(selected).toBeDefined();
    vi.resetModules();
    const reloadedApi = (await import('./api')).api;
    const loaded = await reloadedApi.getDetection(selected?.id ?? '');
    expect(loaded?.sourceRecordId).toBe('mongo-detection-b');
    expect(loaded?.riskBand).toBe('medium');
    expect(calls.some((call) => call.path === '/detections/D001')).toBe(false);
  });

  it('filters mission evidence locally because the backend does not implement query filters', async () => {
    serve({
      'GET /missions/M1/detections': { body: [confirmed] },
      'GET /missions/M1/observations': { body: [observation] },
    });
    const { api } = await import('./api');
    const rows = await api.getDetections('M1', { classification: 'confirmed', search: 'D001' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceId).toBe('D001');
    expect(await api.getDetections('M1', { minMetal: 0.9 })).toEqual([]);
    const surface = await api.getRiskSurface('M1');
    expect(surface).toHaveLength(2);
    expect(surface.map((row) => row.riskBand)).toEqual(['high', 'low']);
  });

  it('loads both collections for each unique mission when no mission is selected', async () => {
    const calls = serve({
      'GET /missions': { body: [mission, { ...mission, _id: 'duplicate' }] },
      'GET /missions/M1/detections': { body: [confirmed] },
      'GET /missions/M1/observations': { body: [observation] },
    });
    const { api } = await import('./api');
    expect(await api.getDetections()).toHaveLength(2);
    expect(calls.filter((call) => call.path === '/missions/M1/detections')).toHaveLength(1);
  });

  it('sorts actual telemetry and leaves missing altitude datum and sensor readings unknown', async () => {
    serve({
      'GET /missions/M1/telemetry': {
        body: [
          {
            mission_id: 'M1',
            latitude: 17.2,
            longitude: 78.3,
            altitude: 40,
            timestamp: '2026-09-14T09:02:00.000Z',
          },
          {
            mission_id: 'M1',
            latitude: 17.1,
            longitude: 78.2,
            altitude: 25.4,
            timestamp: '2026-09-14T09:01:00.000Z',
          },
          { mission_id: 'M2', latitude: 17, longitude: 78, timestamp: '2026-09-14T09:00:00.000Z' },
          { mission_id: 'M1', latitude: 999, longitude: 78 },
        ],
      },
    });
    const { api } = await import('./api');
    const track = await api.getTrack('M1');
    expect(track.map((point) => point.tUtc)).toEqual([
      '2026-09-14T09:01:00.000Z',
      '2026-09-14T09:02:00.000Z',
    ]);
    expect(track[0]).toMatchObject({
      position: { altitudeM: 25.4, altAglM: null, altAmslM: null },
      batteryPercent: null,
      groundSpeedMs: null,
      fixType: null,
      isUndersampled: null,
    });
  });

  it('creates a mission then reads server-owned dates, and preserves location when ending it', async () => {
    let saved = { ...mission, mission_id: '', status: 'ACTIVE' };
    const calls = serve({
      'POST /missions': (call) => {
        const body = call.body as { mission_id: string; location: string; status: string };
        saved = { ...saved, ...body };
        return {
          status: 201,
          body: { message: 'Mission created successfully', insertedId: 'mongo-new' },
        };
      },
    });
    // The backend creates the date and only returns an acknowledgement on writes.
    const originalFetch = fetch;
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      ).pathname;
      if (saved.mission_id && path === `/missions/${encodeURIComponent(saved.mission_id)}`) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
            location: string;
            status: string;
          };
          expect(body.location).toBe('New sector');
          saved = { ...saved, ...body };
          return Promise.resolve(Response.json({ message: 'Mission updated successfully' }));
        }
        return Promise.resolve(Response.json(saved));
      }
      return originalFetch(input, init);
    });
    const { api } = await import('./api');
    const created = await api.createSession({
      siteName: ' New sector ',
      flightMode: 'rc_manual',
      notes: '',
      config: {},
    });
    expect(created.id).toBe(saved.mission_id);
    expect(created.siteName).toBe('New sector');
    expect(created.startedAt).toBe('2026-09-14T09:00:00.000Z');
    expect(created.state).toBe('active');
    expect(calls[0]?.body).not.toHaveProperty('flightMode');
    expect((await api.endSession(created.id)).state).toBe('ended');
  });

  it('rejects unsupported actions without issuing fake successful writes', async () => {
    const calls = serve({});
    const { api } = await import('./api');
    const actions = [
      api.login('operator@example.invalid', 'not-a-real-password'),
      api.submitReview('D1', 'operator_endorsed'),
    ];
    await Promise.all(
      actions.map((action) => expect(action).rejects.toMatchObject({ kind: 'unavailable' })),
    );
    expect(calls).toEqual([]);
    expect(await api.getMe()).toBeNull();
  });

  it('calls the mission assistant extension and identifies its absence explicitly', async () => {
    const calls = serve({});
    const { api } = await import('./api');
    await expect(api.queryAssistant('Summarize evidence', 'M1')).rejects.toMatchObject({
      kind: 'unavailable',
    });
    expect(calls[0]).toMatchObject({
      path: '/missions/M1/ask',
      method: 'GET',
      query: '?q=Summarize+evidence',
    });
  });

  it('prepares a mission index with a long-running request timeout', async () => {
    const calls = serve({
      'POST /missions/M1/create-embeddings': {
        body: {
          mission_id: 'M1',
          status: 'ready',
          indexed_chunks: 4,
          source_hash: 'hash-M1',
          generation: 'generation-M1',
          model: 'Xenova/all-MiniLM-L6-v2',
          reused: false,
        },
      },
    });
    const { api } = await import('./api');
    await expect(api.prepareMission('M1')).resolves.toMatchObject({
      sessionId: 'M1',
      indexedChunks: 4,
      generation: 'generation-M1',
      model: 'Xenova/all-MiniLM-L6-v2',
    });
    expect(calls[0]).toMatchObject({
      path: '/missions/M1/create-embeddings',
      method: 'POST',
    });
  });

  it('preserves safe RAG error codes and messages without exposing provider details', async () => {
    serve({
      'GET /missions/M1/ask': {
        status: 409,
        body: {
          code: 'RAG_NOT_INDEXED',
          message: 'Prepare this mission data before asking questions.',
        },
      },
    });
    const { api } = await import('./api');
    const error: unknown = await api
      .queryAssistant('Evidence?', 'M1')
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      kind: 'invalid',
      code: 'RAG_NOT_INDEXED',
      message: 'Prepare this mission data before asking a question.',
    });
  });

  it('reads backend statistics without recalculating them from the display records', async () => {
    serve({
      'GET /missions/M1/statistics': {
        body: {
          mission_id: 'M1',
          total_records: 15,
          layer_1: { confirmed: 7 },
          layer_2: { unconfirmed: 8 },
          risk: { high: 6, medium: 3, low: 6 },
        },
      },
    });
    const { api } = await import('./api');
    expect(await api.getMissionStatistics('M1')).toEqual({
      sessionId: 'M1',
      totalRecords: 15,
      confirmed: 7,
      unconfirmed: 8,
      risk: { high: 6, medium: 3, low: 6 },
    });
  });

  it('shows only assistant text and citations returned by the mission service', async () => {
    serve({
      'GET /missions/M1/ask': {
        body: {
          mission_id: 'M1',
          answer: 'Retrieved mission evidence.',
          sources: [{ text: 'Stored excerpt', score: 0.83 }],
        },
      },
    });
    const { api } = await import('./api');
    const answer = await api.queryAssistant('Evidence?', 'M1');
    expect(answer.text).toBe('Retrieved mission evidence.');
    expect(answer.citations?.[0]).toMatchObject({
      sourceId: null,
      sourceType: null,
      snippet: 'Stored excerpt',
      similarity: 0.83,
    });
    expect(answer.sqlQuery).toBeUndefined();
  });

  it('rejects assistant answers or sources from a different mission', async () => {
    serve({
      'GET /missions/M1/ask': { body: { mission_id: 'M2', answer: 'Wrong mission', sources: [] } },
    });
    const { api } = await import('./api');
    await expect(api.queryAssistant('Evidence?', 'M1')).rejects.toMatchObject({ kind: 'invalid' });
    serve({
      'GET /missions/M1/ask': {
        body: {
          mission_id: 'M1',
          answer: 'Wrong source',
          sources: [{ mission_id: 'M2', text: 'Other mission evidence', score: 0.9 }],
        },
      },
    });
    await expect(api.queryAssistant('Evidence?', 'M1')).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('requires a bounded non-empty assistant question before making a request', async () => {
    const calls = serve({});
    const { api } = await import('./api');
    await expect(api.queryAssistant('   ', 'M1')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.queryAssistant('a'.repeat(1001), 'M1')).rejects.toMatchObject({
      kind: 'invalid',
    });
    await expect(api.queryAssistant('Evidence?')).rejects.toMatchObject({ kind: 'invalid' });
    expect(calls).toEqual([]);
  });

  it('does not expose backend provider credentials in user-facing errors', async () => {
    serve({
      'GET /missions/M1/ask': {
        status: 500,
        body: { error: 'Provider failed at https://provider.invalid?key=SECRET_TEST_VALUE' },
      },
    });
    const { api } = await import('./api');
    const error: unknown = await api
      .queryAssistant('Evidence?', 'M1')
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ kind: 'unavailable' });
    expect(String(error)).not.toContain('SECRET_TEST_VALUE');
  });

  it('retains the richer session adapter as an explicit option', async () => {
    vi.stubEnv('VITE_BACKEND_STYLE', 'prd');
    const calls = serve({ 'GET /sessions': { body: [{ id: 'S1', siteName: 'Rich backend' }] } });
    const { api } = await import('./api');
    expect((await api.getSessions())[0]?.id).toBe('S1');
    expect(calls[0]?.credentials).toBe('include');
  });
});

describe('integrated services', () => {
  it('runs inference through the backend and preserves actual predictions without confirmations', async () => {
    const model = {
      name: 'best.pt',
      sha256: 'model-hash',
      task: 'detect',
      device: 'cpu',
      classes: [{ id: 0, name: 'land_mines' }],
    };
    const calls = serve({
      'GET /inference/status': {
        body: {
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
        },
      },
      'POST /inference/predict': {
        body: {
          runId: 'run-1',
          missionId: 'M-new',
          model,
          predictions: [
            {
              classId: 0,
              className: 'land_mines',
              confidence: 0.91,
              bbox: [10, 20, 30, 40],
              normalizedCenter: { x: 0.2, y: 0.3 },
            },
          ],
          imageUrl: '/api/inference/files/run-1.jpg',
          annotatedImageUrl: '/api/inference/files/run-1-annotated.jpg',
          persistedObservations: 1,
          image: { width: 100, height: 100 },
        },
      },
    });
    const { api } = await import('./api');
    expect(await api.getInferenceStatus()).toMatchObject({
      ready: true,
      model: { name: 'best.pt', sha256: 'model-hash' },
    });
    const result = await api.predictImage({
      imageBase64: 'data:image/png;base64,AAAA',
      filename: 'image.png',
      missionId: 'SAMPLE-TV001',
      confidence: 0.25,
      latitude: 0,
      longitude: 0,
    });
    expect(result).toMatchObject({
      missionId: 'M-new',
      persistedObservations: 1,
      annotatedImageUrl: 'http://localhost:3000/api/inference/files/run-1-annotated.jpg',
      predictions: [{ className: 'land_mines', confidence: 0.91, bbox: [10, 20, 30, 40] }],
    });
    expect(result.predictions[0]).not.toHaveProperty('confirmed');
    expect(calls[1]?.body).toMatchObject({ latitude: 0, longitude: 0, missionId: 'SAMPLE-TV001' });
  });

  it('rejects an incomplete inference GPS pair before transport and displays missing-runtime diagnostics', async () => {
    const calls = serve({
      'POST /inference/predict': {
        status: 503,
        body: { code: 'INFERENCE_RUNTIME_UNAVAILABLE', message: 'private detail' },
      },
    });
    const { api } = await import('./api');
    await expect(
      api.predictImage({ imageBase64: 'AAAA', filename: 'image.png', latitude: 10 }),
    ).rejects.toMatchObject({ kind: 'invalid' });
    expect(calls).toHaveLength(0);
    await expect(api.predictImage({ imageBase64: 'AAAA', filename: 'image.png' })).rejects.toThrow(
      /Python.*Ultralytics/,
    );
  });

  it('creates the requested report edition with both download formats and source provenance', async () => {
    const report = {
      id: 'R-1',
      sessionId: 'M1',
      reportNumber: 1,
      siteName: 'North sector',
      generatedAt: '2026-09-23T10:00:00.000Z',
      status: 'ready',
      formulaVersion: 'recorded-risk-v1',
      contentHash: 'sha256-content',
      downloadUrl: '/api/reports/R-1/download?format=pdf',
      csvDownloadUrl: '/api/reports/R-1/download?format=csv',
      generationMode: 'rag',
      narrative: 'Evidence supported narrative.',
      narrativeError: null,
      synthetic: true,
      summary: { confirmedMinesCount: 4, unconfirmedVisualCount: 4 },
      recordCounts: { imageInferenceRuns: 1, imagePredictions: 5, unlocalizedImagePredictions: 5 },
      sources: [
        {
          document: 'Mission records',
          section: 'Observations',
          snippet: 'Recorded evidence.',
          sessionId: 'M1',
          sourceRecordId: 'OBS-1',
          sha256: 'sha256-source',
        },
      ],
      narrativeSources: [
        {
          citationNumber: 1,
          document: 'Retrieved observation',
          section: 'Narrative context',
          snippet: 'The source referenced by [1].',
          sourceRecordId: 'OBS-2',
          sha256: 'sha256-narrative-source',
        },
      ],
    };
    const calls = serve({
      'POST /reports': { body: report },
      'GET /reports': { body: [report] },
      'GET /reports/R-1': { body: report },
    });
    const { api } = await import('./api');
    const created = await api.generateReport('M1', true);
    expect(created).toMatchObject({
      generationMode: 'rag',
      narrative: 'Evidence supported narrative.',
      synthetic: true,
      csvDownloadUrl: '/api/reports/R-1/download?format=csv',
      sources: [{ sourceRecordId: 'OBS-1', sha256: 'sha256-source' }],
      recordCounts: { imageInferenceRuns: 1, imagePredictions: 5, unlocalizedImagePredictions: 5 },
      narrativeSources: [
        { citationNumber: 1, sourceRecordId: 'OBS-2', sha256: 'sha256-narrative-source' },
      ],
    });
    expect((await api.getReports())[0]?.id).toBe('R-1');
    expect((await api.getReport('R-1'))?.downloadUrl).toBe('/api/reports/R-1/download?format=pdf');
    expect(calls[0]?.body).toEqual({ sessionId: 'M1', includeAi: true });
    serve({ 'GET /reports': { body: [{ ...report, narrativeSources: undefined }] } });
    expect((await api.getReports())[0]?.narrativeSources).toBeUndefined();
  });

  it('reads actual subsystem health and catalog data with mission-scoped events', async () => {
    const calls = serve({
      'GET /system/health': {
        body: [
          {
            id: 'rag',
            name: 'RAG',
            status: 'warning',
            details: 'Gemini is not configured.',
            lastHeartbeat: '',
          },
        ],
      },
      'GET /system/events': { body: [] },
      'GET /classes': {
        body: [
          { id: '1', name: 'land_mines', description: 'Model class', category: 'ordnance_ap' },
        ],
      },
    });
    const { api } = await import('./api');
    expect(await api.getSystemHealth()).toMatchObject([
      { id: 'rag', status: 'warning', details: 'Gemini is not configured.' },
    ]);
    expect(await api.getSystemEvents('M1')).toEqual([]);
    expect(await api.getDetectionClasses()).toMatchObject([{ id: '1', name: 'land_mines' }]);
    expect(calls.find((call) => call.path === '/system/events')?.query).toBe('?sessionId=M1');
  });

  it('renders served inference images while preserving local filesystem references as unavailable', async () => {
    serve({
      'GET /missions/M1/detections': { body: [] },
      'GET /missions/M1/observations': {
        body: [
          {
            ...observation,
            image_path: '/api/inference/files/run-original.jpg',
            target_location_known: false,
            location_source: 'user_supplied_image_location',
            confirmation_source: 'Visual prediction only; no metal sensor evidence.',
          },
        ],
      },
    });
    const { api } = await import('./api');
    expect((await api.getDetections('M1'))[0]).toMatchObject({
      fullFrameUrl: 'http://localhost:3000/api/inference/files/run-original.jpg',
      thumbnailUrl: 'http://localhost:3000/api/inference/files/run-original.jpg',
      targetLocationKnown: false,
      locationSource: 'user_supplied_image_location',
      confirmationSource: 'Visual prediction only; no metal sensor evidence.',
    });
  });
});

const routeRequest = {
  sessionId: 'M1',
  start: { lat: 17.445, lon: 78.3465 },
  end: { lat: 17.445, lon: 78.3495 },
  minStandoffM: 5,
  cautionWeight: 0.6,
};
const routeResponse = {
  sessionId: 'M1',
  pathFound: true,
  waypoints: [routeRequest.start, { lat: 17.4449, lon: 78.348 }, routeRequest.end],
  totalDistanceM: 321,
  minStandoffAchievedM: 7.4,
  confirmedDetectionsNearRoute: 1,
  unconfirmedDetectionsNearRoute: 2,
  disclaimer: 'Planning aid based on recorded evidence; ground clearance is not established.',
};

describe('mission route boundary', () => {
  it('posts selected endpoints and preferences to the selected mission route endpoint', async () => {
    const calls = serve({ 'POST /missions/M1/route': { body: routeResponse } });
    const { api } = await import('./api');
    await expect(api.calculateSafePath(routeRequest)).resolves.toEqual(routeResponse);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: '/missions/M1/route',
      method: 'POST',
      body: routeRequest,
    });
  });

  it.each([
    { sessionId: 'M2' },
    { sessionId: undefined },
    { pathFound: 'true' },
    { waypoints: [{ lat: 91, lon: 78 }, routeRequest.end] },
    { waypoints: [{ lat: 17.4452, lon: 78.3465 }, routeRequest.end] },
    { waypoints: [routeRequest.start, { lat: 17.4452, lon: 78.3495 }] },
    { totalDistanceM: -1 },
    { totalDistanceM: 0 },
    { totalDistanceM: null },
    { minStandoffAchievedM: -1 },
    { minStandoffAchievedM: 3 },
    { confirmedDetectionsNearRoute: -1 },
    { unconfirmedDetectionsNearRoute: 0.5 },
  ])('rejects a foreign or malformed route result: %j', async (change) => {
    serve({ 'POST /missions/M1/route': { body: { ...routeResponse, ...change } } });
    const { api } = await import('./api');
    await expect(api.calculateSafePath(routeRequest)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('preserves a blocked result and unknown achieved standoff without inventing a route', async () => {
    const blocked = {
      ...routeResponse,
      pathFound: false,
      waypoints: [],
      totalDistanceM: null,
      minStandoffAchievedM: null,
      confirmedDetectionsNearRoute: null,
      unconfirmedDetectionsNearRoute: null,
      failureReason: 'An endpoint is within the requested standoff of recorded evidence.',
    };
    serve({ 'POST /missions/M1/route': { body: blocked } });
    const { api } = await import('./api');
    await expect(api.calculateSafePath(routeRequest)).resolves.toEqual(blocked);
    serve({
      'POST /missions/M1/route': {
        body: {
          ...routeResponse,
          minStandoffAchievedM: null,
          confirmedDetectionsNearRoute: 0,
          unconfirmedDetectionsNearRoute: 0,
        },
      },
    });
    expect((await api.calculateSafePath(routeRequest)).minStandoffAchievedM).toBeNull();
  });

  it('reports missing route service and backend errors without exposing raw details', async () => {
    serve({});
    const { api } = await import('./api');
    await expect(api.calculateSafePath(routeRequest)).rejects.toMatchObject({
      kind: 'unavailable',
    });
    serve({
      'POST /missions/M1/route': {
        status: 500,
        body: { code: 'ROUTE_INTERNAL_ERROR', error: 'Private connection mongodb://SECRET' },
      },
    });
    const error: unknown = await api
      .calculateSafePath(routeRequest)
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ kind: 'unavailable' });
    expect(String(error)).not.toContain('SECRET');
  });

  it.each([
    { sessionId: '' },
    { start: { lat: Number.NaN, lon: 78 } },
    { end: { lat: 95, lon: 78 } },
    { end: routeRequest.start },
    { minStandoffM: 3 },
    { minStandoffM: 21 },
    { cautionWeight: 2 },
  ])('rejects invalid planning inputs before transport: %j', async (change) => {
    const calls = serve({});
    const { api } = await import('./api');
    await expect(api.calculateSafePath({ ...routeRequest, ...change })).rejects.toMatchObject({
      kind: 'invalid',
    });
    expect(calls).toEqual([]);
  });
});

const sampleRoute = { start: routeRequest.start, end: routeRequest.end };
const sampleReply = {
  mission_id: 'SAMPLE-TV001',
  created: true,
  synthetic: true,
  counts: { detections: 4, observations: 4, telemetry: 20 },
  suggestedRoute: sampleRoute,
  message: 'Synthetic sample mission ready.',
};

describe('sample mission boundary', () => {
  it('loads and reloads the server-owned sample with validated synthetic metadata', async () => {
    let created = true;
    const calls = serve({
      'GET /sample-mission': () => ({ body: { ...sampleReply, created } }),
    });
    const { api } = await import('./api');
    await expect(api.loadSampleMission()).resolves.toEqual({
      sessionId: 'SAMPLE-TV001',
      created: true,
      synthetic: true,
      counts: { detections: 4, observations: 4, telemetry: 20 },
      suggestedRoute: sampleRoute,
    });
    created = false;
    expect((await api.loadSampleMission()).created).toBe(false);
    expect(calls.map((call) => [call.path, call.method, call.body])).toEqual([
      ['/sample-mission', 'GET', null],
      ['/sample-mission', 'GET', null],
    ]);
  });

  it('keeps persisted sample endpoints and notes but never marks a normal mission as synthetic', async () => {
    serve({
      'GET /missions': {
        body: [
          {
            ...mission,
            mission_id: 'SAMPLE-TV001',
            sample: true,
            sample_route: sampleRoute,
            notes: 'Synthetic practice survey.',
          },
          { ...mission, sample_route: sampleRoute },
        ],
      },
    });
    const { api } = await import('./api');
    const missions = await api.getSessions();
    expect(missions.find((row) => row.id === 'SAMPLE-TV001')).toMatchObject({
      isSample: true,
      sampleRoute,
      notes: 'Synthetic practice survey.',
    });
    expect(missions.find((row) => row.id === 'M1')?.isSample).not.toBe(true);
    expect(missions.find((row) => row.id === 'M1')?.sampleRoute).toBeUndefined();
  });

  it.each([
    { mission_id: 'M1' },
    { synthetic: false },
    { created: 'yes' },
    { counts: { detections: -1, observations: 4, telemetry: 20 } },
    { suggestedRoute: { start: { lat: 95, lon: 78 }, end: routeRequest.end } },
  ])('rejects malformed sample load acknowledgements: %j', async (change) => {
    serve({ 'GET /sample-mission': { body: { ...sampleReply, ...change } } });
    const { api } = await import('./api');
    await expect(api.loadSampleMission()).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('audited mission regressions', () => {
  it('preserves all 15 TV001 Mongo records and their independent confirmation and risk counts', async () => {
    const { default: snapshot } = await import('./fixtures/TV001.json');
    serve({
      'GET /missions/TV001/detections': { body: snapshot.detections },
      'GET /missions/TV001/observations': { body: snapshot.observations },
    });
    const { api } = await import('./api');
    const rows = await api.getDetections('TV001');
    expect(rows).toHaveLength(15);
    expect(new Set(rows.map((row) => row.id)).size).toBe(15);
    expect(rows.filter((row) => row.classification === 'confirmed')).toHaveLength(7);
    expect(rows.filter((row) => row.classification === 'unconfirmed_visual')).toHaveLength(8);
    expect(rows.filter((row) => row.riskBand === 'high')).toHaveLength(8);
    expect(rows.filter((row) => row.riskBand === 'medium')).toHaveLength(4);
    expect(rows.filter((row) => row.riskBand === 'low')).toHaveLength(2);
    expect(rows.filter((row) => row.riskBand === null)).toHaveLength(1);
    expect(
      rows.filter((row) => row.classification === 'unconfirmed_visual' && row.riskBand === 'high'),
    ).toHaveLength(4);
  });

  it('does not turn a failed collection read into an empty or partial success', async () => {
    serve({
      'GET /missions/M1/detections': { status: 503, body: { error: 'Unavailable' } },
      'GET /missions/M1/observations': { body: [observation] },
    });
    const { api } = await import('./api');
    await expect(api.getDetections('M1')).rejects.toMatchObject({ kind: 'unavailable' });
    serve({
      'GET /missions/M1/detections': { body: [] },
      'GET /missions/M1/observations': { body: [] },
    });
    expect(await api.getDetections('M1')).toEqual([]);
  });

  it('leaves invalid or absent dates unknown and refuses invalid GPS instead of inventing coordinates', async () => {
    serve({
      'GET /missions/M1': { body: { ...mission, date: 'invalid date' } },
      'GET /missions/M1/detections': {
        body: [
          { ...confirmed, timestamp: null },
          { ...confirmed, _id: 'bad-lat', latitude: 999 },
          { ...confirmed, _id: 'missing-lon', longitude: null },
        ],
      },
      'GET /missions/M1/observations': { body: [] },
      'GET /missions/M1/telemetry': { body: [{ mission_id: 'M1', latitude: 17, longitude: 78 }] },
    });
    const { api } = await import('./api');
    expect((await api.getSession('M1'))?.startedAt).toBe('');
    const rows = await api.getDetections('M1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.firstObservedAt).toBe('');
    expect(rows[0]?.position.altAglM).toBeNull();
    const track = await api.getTrack('M1');
    expect(track[0]?.tUtc).toBe('');
    expect(track[0]?.batteryPercent).toBeNull();
  });

  it('uses a fresh UUID for each create and does not claim unsupported configuration was saved', async () => {
    const uuids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(uuids[0] as ReturnType<typeof crypto.randomUUID>)
      .mockReturnValueOnce(uuids[1] as ReturnType<typeof crypto.randomUUID>);
    const calls = serve({
      'POST /missions': { status: 201, body: { insertedId: 'new' } },
      [`GET /missions/TV-${uuids[0]}`]: { body: { ...mission, mission_id: `TV-${uuids[0]}` } },
      [`GET /missions/TV-${uuids[1]}`]: { body: { ...mission, mission_id: `TV-${uuids[1]}` } },
    });
    const { api } = await import('./api');
    const payload = {
      siteName: 'North',
      flightMode: 'rc_manual' as const,
      notes: 'not persisted',
      config: { nominalAglM: 80 },
    };
    const first = await api.createSession(payload);
    const second = await api.createSession(payload);
    expect(first.id).not.toBe(second.id);
    expect(first.config.nominalAglM).toBeNull();
    expect(first.flightMode).toBeNull();
    expect(first.notes).toBe('');
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      {
        mission_id: 'TV-00000000-0000-4000-8000-000000000001',
        location: 'North',
        status: 'ACTIVE',
      },
      {
        mission_id: 'TV-00000000-0000-4000-8000-000000000002',
        location: 'North',
        status: 'ACTIVE',
      },
    ]);
    vi.restoreAllMocks();
  });

  it('fails an end operation if the updated mission cannot be read back', async () => {
    let reads = 0;
    serve({
      'GET /missions/M1': () => ({ body: ++reads === 1 ? mission : {} }),
      'PUT /missions/M1': { body: { message: 'updated' } },
    });
    const { api } = await import('./api');
    await expect(api.endSession('M1')).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('derives only recorded GPS track length and leaves unmeasured coverage unknown', async () => {
    serve({
      'GET /missions/M1/telemetry': {
        body: [
          { mission_id: 'M1', latitude: 0, longitude: 0, timestamp: '2026-01-01T00:00:00Z' },
          { mission_id: 'M1', latitude: 0, longitude: 0.001, timestamp: '2026-01-01T00:00:01Z' },
        ],
      },
    });
    const { api } = await import('./api');
    const coverage = await api.getCoverage('M1');
    expect(coverage.trackLengthM).toBeCloseTo(111.195, 2);
    expect(coverage.visualSweptAreaM2).toBeNull();
    expect(coverage.dualSweptAreaM2).toBeNull();
    expect(coverage.degradedAreaM2).toBeNull();
    expect(coverage.visualSwathM).toBeNull();
  });

  it('accepts a scoped answer without optional mission metadata and trims the request question', async () => {
    const calls = serve({
      'GET /missions/M1/ask': {
        body: { answer: 'Stored answer', sources: [{ text: 'Raw source', score: 0.789 }] },
      },
    });
    const { api } = await import('./api');
    const answer = await api.queryAssistant('  question  ', 'M1');
    expect(calls[0]?.query).toBe('?q=question');
    expect(answer.citations?.[0]?.similarity).toBe(0.789);
  });

  it('does not claim a WebSocket connection from a configured REST URL', async () => {
    const { socketService } = await import('./socket');
    const stop = socketService.subscribeTelemetry(() => undefined);
    expect(socketService.getConnectionState()).not.toBe('connected');
    stop();
  });
});

it('retains stored status but flags contradictory or incomplete confirmation evidence', async () => {
  serve({
    'GET /missions/M1/detections': {
      body: [
        { ...confirmed, _id: 'metal-contradiction', metal_detected: false },
        { ...confirmed, _id: 'visual-contradiction', yolo_confidence: 0.69 },
        { ...confirmed, _id: 'missing-sensor', yolo_confidence: null },
        { ...confirmed, _id: 'threshold', yolo_confidence: 0.7 },
      ],
    },
    'GET /missions/M1/observations': { body: [] },
  });
  const { api } = await import('./api');
  const rows = await api.getDetections('M1');
  expect(rows).toHaveLength(4);
  expect(rows.find((row) => row.sourceRecordId === 'metal-contradiction')).toMatchObject({
    sourceStatus: 'CONFIRMED',
    metalDetected: false,
    visualCandidateIds: [],
    metalHitIds: [],
    corroborationCount: null,
  });
  expect(rows.find((row) => row.sourceRecordId === 'metal-contradiction')?.validationIssue).toMatch(
    /contradict/i,
  );
  expect(
    rows.find((row) => row.sourceRecordId === 'visual-contradiction')?.validationIssue,
  ).toMatch(/contradict/i);
  expect(rows.find((row) => row.sourceRecordId === 'missing-sensor')?.validationIssue).toMatch(
    /incomplete/i,
  );
  expect(rows.find((row) => row.sourceRecordId === 'threshold')?.validationIssue).toBeNull();
});
