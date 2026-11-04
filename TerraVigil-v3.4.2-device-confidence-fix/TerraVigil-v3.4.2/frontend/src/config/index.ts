/**
 * Typed, validated environment access.
 *
 * This is the ONLY module in the codebase permitted to read import.meta.env.
 * Anything else needing configuration imports from here. Invalid values fail
 * loudly at startup rather than producing subtle runtime misbehavior.
 */

export interface AppConfig {
  /** Production uses live records. The union also describes isolated test adapters. */
  readonly dataMode: 'demo' | 'live';
  /** missions = student Express /missions API; prd = /sessions contract. */
  readonly backendStyle: 'missions' | 'prd';
  /** Base URL of the backend REST API. Empty string when unset. */
  readonly apiBaseUrl: string;
  /** WebSocket URL of the realtime layer. Empty string when unset. */
  readonly wsUrl: string;
  /** Satellite basemap; an explicit empty URL selects the local grid. */
  readonly tileUrl: string;
  readonly tileAttribution: string;
  /** Highest zoom with native tiles; Leaflet enlarges these up to map zoom 22. */
  readonly tileMaxNativeZoom: number;
  /** Request timeout for REST reads, in milliseconds. */
  readonly requestTimeoutMs: number;
  /** Bounded timeout for the mission assistant generation request. */
  readonly assistantTimeoutMs: number;
  /** Bounded timeout for first-use local embedding/index preparation. */
  readonly preparationTimeoutMs: number;
  /** True when the REST backend URL is set. WebSocket is optional. */
  readonly isConfigured: boolean;
}

function readOptionalUrl(name: string, raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (value === '') return '';
  // Validate shape but allow relative/dev URLs; only reject obvious garbage.
  if (!/^(https?|wss?):\/\//i.test(value) && !value.startsWith('/')) {
    throw new Error(
      `[config] ${name}="${value}" does not look like a URL. Expected an http(s)/ws(s) URL or empty.`,
    );
  }
  return value.replace(/\/+$/, '');
}

function readTimeout(raw: string | undefined): number {
  const value = (raw ?? '').trim();
  if (value === '') return 15_000;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`[config] VITE_REQUEST_TIMEOUT_MS="${value}" is not a positive number.`);
  }
  return parsed;
}

function readBoundedTimeout(
  name: string,
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  const value = (raw ?? '').trim();
  if (value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`[config] ${name} must be a positive number no greater than ${String(max)}.`);
  }
  return parsed;
}

function loadConfig(): AppConfig {
  const env = import.meta.env as Record<string, string | undefined>;
  const apiBaseUrl = readOptionalUrl('VITE_API_BASE_URL', env.VITE_API_BASE_URL);
  const wsUrl = readOptionalUrl('VITE_WS_URL', env.VITE_WS_URL);
  const dataMode: AppConfig['dataMode'] = 'live';
  const rawNativeZoom = (env.VITE_TILE_MAX_NATIVE_ZOOM ?? '').trim();
  const tileMaxNativeZoom = rawNativeZoom === '' ? 19 : Number(rawNativeZoom);
  if (!Number.isInteger(tileMaxNativeZoom) || tileMaxNativeZoom < 0 || tileMaxNativeZoom > 22) {
    throw new Error('[config] VITE_TILE_MAX_NATIVE_ZOOM must be an integer from 0 to 22.');
  }
  const backendStyleRaw = (env.VITE_BACKEND_STYLE ?? 'missions').trim();
  if (backendStyleRaw !== 'missions' && backendStyleRaw !== 'prd') {
    throw new Error('[config] VITE_BACKEND_STYLE must be "missions" or "prd".');
  }

  return {
    dataMode,
    backendStyle: backendStyleRaw,
    apiBaseUrl,
    wsUrl,
    tileUrl: (
      env.VITE_TILE_URL ??
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    ).trim(),
    tileAttribution: (
      env.VITE_TILE_ATTRIBUTION ??
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> \u2014 Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    ).trim(),
    tileMaxNativeZoom,
    requestTimeoutMs: readTimeout(env.VITE_REQUEST_TIMEOUT_MS),
    assistantTimeoutMs: readBoundedTimeout(
      'VITE_ASSISTANT_TIMEOUT_MS',
      env.VITE_ASSISTANT_TIMEOUT_MS,
      65_000,
      900_000,
    ),
    preparationTimeoutMs: readBoundedTimeout(
      'VITE_PREPARATION_TIMEOUT_MS',
      env.VITE_PREPARATION_TIMEOUT_MS,
      190_000,
      1_800_000,
    ),
    isConfigured: apiBaseUrl !== '',
  };
}

export const config: AppConfig = loadConfig();
