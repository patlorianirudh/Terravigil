/**
 * HTTP transport. The ONLY module in the app permitted to call fetch().
 *
 * Every failure crosses this boundary as a ServiceError with a typed kind, so
 * callers never inspect status codes and the UI can distinguish "no backend
 * configured" from "backend said no" from "backend is down".
 */

import { config } from '../config';
import { ServiceError } from './errors';

const TOKEN_STORAGE_KEY = 'terravigil.auth.token';

/** Bearer token lives in sessionStorage — cleared when the tab closes. */
export function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    else sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage unavailable (private mode / disabled). The session simply will
    // not survive a reload; requests within this page still carry the token.
  }
}

let inMemoryToken: string | null = null;

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly signal?: AbortSignal;
  /** Override the normal read timeout for bounded long-running operations. */
  readonly timeoutMs?: number;
  /** A feature-specific explanation for an optional endpoint absent on the server. */
  readonly unavailableOn404?: string;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = config.apiBaseUrl;
  const joined = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return joined;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs === '' ? joined : `${joined}?${qs}`;
}

function tokenHeader(): Record<string, string> {
  const token = inMemoryToken ?? getAuthToken();
  return token === null ? {} : { Authorization: `Bearer ${token}` };
}

/** Records the token for this page session and persists it. */
export function rememberToken(token: string | null): void {
  inMemoryToken = token;
  setAuthToken(token);
}

interface ErrorBody {
  readonly code?: string;
  readonly message?: string;
  readonly error?: string;
}

async function readErrorBody(response: Response): Promise<ErrorBody> {
  try {
    const text = await response.text();
    if (text === '') return {};
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return { message: text.slice(0, 300) };
    }
  } catch {
    return {};
  }
}

const RAG_ERROR_MESSAGES: Record<string, string> = {
  INFERENCE_INVALID_REQUEST: 'Check the image, threshold and paired GPS coordinates.',
  INFERENCE_INVALID_IMAGE:
    'This image could not be decoded. Choose a valid JPEG, PNG or WebP file.',
  INFERENCE_IMAGE_TOO_LARGE: 'This image exceeds the server upload or pixel limit.',
  INFERENCE_MISSION_NOT_FOUND: 'The selected mission no longer exists. Refresh the mission list.',
  INFERENCE_BUSY: 'The model is processing another image. Wait and try again.',
  INFERENCE_RUNTIME_UNAVAILABLE:
    'Python or Ultralytics is unavailable. Complete the inference setup and refresh model status.',
  INFERENCE_MODEL_MISSING: 'The supplied best.pt model is missing from the backend.',
  INFERENCE_MODEL_INTEGRITY: 'The model checksum does not match the supplied checkpoint.',
  INFERENCE_MODEL_INVALID:
    'The model checkpoint could not be loaded. Check its runtime dependencies.',
  INFERENCE_TIMEOUT: 'Model inference timed out. Try a smaller image or check the Python runtime.',
  INFERENCE_INVALID_OUTPUT:
    'The model returned an invalid result. No successful inference is shown.',
  INFERENCE_STORAGE_ERROR: 'Inference results could not be saved. Check backend storage.',
  REPORT_NOT_FOUND: 'This report edition is no longer available.',
  REPORT_SOURCE_MISMATCH:
    'The requested narrative contains sources from another mission. No report was issued.',
  REPORT_SNAPSHOT_CHANGED: 'Mission data changed during generation. Generate a new edition.',
  REPORT_INTEGRITY_FAILED: 'Report integrity verification failed. The edition could not be served.',
  REPORT_STORAGE_UNAVAILABLE: 'The report could not be saved. Check backend storage.',
  REPORT_AI_UNAVAILABLE:
    'AI narrative is unavailable. Configure the backend RAG service or choose a factual snapshot.',
  REPORT_AI_FAILED: 'AI narrative generation failed. Retry or choose a factual snapshot.',
  ROUTE_INVALID_REQUEST: 'Check the route endpoints and preferences, then try again.',
  ROUTE_MISSION_NOT_FOUND:
    'This mission is not available for route planning. Refresh the mission list.',
  ROUTE_UNAVAILABLE: 'Route computation is temporarily unavailable. Try again.',
  ROUTE_UNLOCALIZED_EVIDENCE:
    'Route computation is blocked because image predictions have no measured target locations. Review and localize this evidence first.',
  SAMPLE_READ_ONLY:
    'The built-in sample is read-only. Use the live backend to create or edit real missions.',
  SAMPLE_MISSION_CONFLICT:
    'The sample mission ID is already used by a different record. Existing records were preserved.',
  SAMPLE_MISSION_UNAVAILABLE:
    'The sample mission could not be loaded. Check the backend connection and try again.',
  INVALID_REQUEST: 'The mission-data request is invalid.',
  MISSION_NOT_FOUND: 'This mission is not available in the backend database.',
  RAG_NOT_INDEXED: 'Prepare this mission data before asking a question.',
  RAG_INDEX_STALE: 'Mission data changed. Prepare it again before asking.',
  RAG_INDEX_INVALID: 'The mission index is incomplete. Prepare it again.',
  RAG_INDEX_CHANGED: 'Mission data changed during the request. Retry.',
  EMBEDDING_UNAVAILABLE: 'The local embedding model is unavailable on the backend.',
  GEMINI_NOT_CONFIGURED: 'Gemini is not configured on the backend. Set its private .env key.',
  GEMINI_AUTH_FAILED: 'Gemini rejected the backend credentials. Update the backend .env key.',
  GEMINI_MODEL_UNAVAILABLE: 'The configured Gemini model is unavailable.',
  GEMINI_RATE_LIMITED: 'Gemini quota or rate limit was reached. Try again later.',
  GEMINI_FAILED: 'The assistant could not generate a grounded answer.',
  RAG_TIMEOUT: 'The mission-data request timed out. Retry.',
  DATABASE_UNAVAILABLE: 'Mission data is temporarily unavailable. Retry.',
  RAG_INTERNAL_ERROR: 'The mission-data assistant is unavailable.',
};

function missionErrorMessage(body: ErrorBody, status: number): string {
  if (body.code !== undefined) {
    const knownMessage = RAG_ERROR_MESSAGES[body.code];
    if (knownMessage !== undefined) return knownMessage;
  }
  if (status >= 500) return 'The mission backend could not complete this request.';
  return 'The mission backend rejected this request.';
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (config.apiBaseUrl === '') {
    throw new ServiceError(
      'unavailable',
      'VITE_API_BASE_URL is not set. The dashboard has no backend to read from.',
    );
  }

  const { method = 'GET', body, query, signal, timeoutMs } = options;
  const timeout = AbortSignal.timeout(timeoutMs ?? config.requestTimeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal: combined,
      credentials: config.backendStyle === 'missions' ? 'omit' : 'include',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(config.backendStyle === 'missions' ? {} : tokenHeader()),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      throw new ServiceError(
        'offline',
        `No response from the backend within ${String(timeoutMs ?? config.requestTimeoutMs)} ms.`,
      );
    }
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new ServiceError('offline', 'Request cancelled.');
    }
    throw new ServiceError('offline', 'Cannot reach the configured backend.');
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    // Mission backends may forward provider errors containing credentials or URLs.
    const body = await readErrorBody(response);
    const code = typeof body.code === 'string' ? body.code : undefined;
    const message =
      config.backendStyle === 'missions'
        ? missionErrorMessage(body, response.status)
        : (body.message ?? body.error ?? response.statusText);
    if (response.status === 404 && options.unavailableOn404) {
      throw new ServiceError('unavailable', options.unavailableOn404);
    }
    if (response.status === 401 || response.status === 403) {
      rememberToken(null);
      throw new ServiceError('invalid', `Not authorised: ${message}`, code);
    }
    if (response.status >= 500) {
      throw new ServiceError(
        'unavailable',
        config.backendStyle === 'missions'
          ? message
          : `Backend error ${String(response.status)}: ${message}`,
        code,
      );
    }
    throw new ServiceError(
      'invalid',
      config.backendStyle === 'missions'
        ? message
        : `Request rejected (${String(response.status)}): ${message}`,
      code,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ServiceError('invalid', 'Backend returned a response that is not valid JSON.');
  }
}
