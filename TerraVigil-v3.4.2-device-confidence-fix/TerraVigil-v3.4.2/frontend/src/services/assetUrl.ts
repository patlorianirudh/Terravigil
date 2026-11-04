import { config } from '../config';

/** Server-issued API assets share the API origin, including in Vite development. */
export function apiAssetUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith('/api/')) return null;
  if (/^https?:\/\//i.test(config.apiBaseUrl)) return new URL(value, config.apiBaseUrl).href;
  return value;
}
