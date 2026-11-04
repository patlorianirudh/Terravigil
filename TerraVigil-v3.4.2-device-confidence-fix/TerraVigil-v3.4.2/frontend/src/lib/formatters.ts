/**
 * Value formatting. One rule, and it is a safety rule (PRD §23.2): a value the
 * backend has not reported renders as an em-dash. Never a zero, never a
 * placeholder, never a plausible-looking figure. If the operator sees a number
 * here, a sensor produced it.
 */

/** The single glyph for "not reported". Use this, never a literal dash. */
export const ABSENT = '—';

type Maybe = number | null | undefined;

function isPresent(value: Maybe): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A number at fixed precision, with a unit when one is given. */
export function fmtNum(value: Maybe, digits = 1, unit?: string): string {
  if (!isPresent(value)) return ABSENT;
  const text = value.toFixed(digits);
  return unit === undefined ? text : `${text} ${unit}`;
}

/** An integer count. */
export function fmtCount(value: Maybe): string {
  return isPresent(value) ? value.toLocaleString() : ABSENT;
}

/** A [0,1] ratio as a percentage. */
export function fmtRatio(value: Maybe, digits = 0): string {
  return isPresent(value) ? `${(value * 100).toFixed(digits)}%` : ABSENT;
}

/** An already-percentage value (0–100). */
export function fmtPercent(value: Maybe, digits = 0): string {
  return isPresent(value) ? `${value.toFixed(digits)}%` : ABSENT;
}

/** A [0,1] score at two decimals — confidences, signal norms, risk scores. */
export function fmtScore(value: Maybe): string {
  return isPresent(value) ? value.toFixed(2) : ABSENT;
}

/**
 * Area in m², promoted to hectares past 1 ha. Swept areas span four orders of
 * magnitude (§12.2: dual-swept is tens of m² while visual-swept is hectares),
 * so a single fixed unit misleads either way.
 */
export function fmtArea(squareMeters: Maybe): string {
  if (!isPresent(squareMeters)) return ABSENT;
  if (squareMeters >= 10_000) return `${(squareMeters / 10_000).toFixed(2)} ha`;
  return `${Math.round(squareMeters).toLocaleString()} m²`;
}

/** Distance in metres, promoted to km past 1 km. */
export function fmtDistance(meters: Maybe): string {
  if (!isPresent(meters)) return ABSENT;
  if (meters >= 1_000) return `${(meters / 1_000).toFixed(2)} km`;
  return `${meters.toFixed(1)} m`;
}

/** A CEP95 radius, always signed as an uncertainty. */
export function fmtUncertainty(meters: Maybe): string {
  return isPresent(meters) ? `±${meters.toFixed(1)} m` : ABSENT;
}

/** WGS84 degrees at six decimals (~0.1 m). */
export function fmtCoord(value: Maybe): string {
  return isPresent(value) ? value.toFixed(6) : ABSENT;
}

/** A lat/lon pair with hemisphere letters. */
export function fmtLatLon(lat: Maybe, lon: Maybe): string {
  if (!isPresent(lat) || !isPresent(lon)) return ABSENT;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
}

/** Clock time from an ISO timestamp. */
export function fmtTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return ABSENT;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? ABSENT : date.toLocaleTimeString();
}

/** Date and time from an ISO timestamp. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return ABSENT;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? ABSENT : date.toLocaleString();
}

/** A duration already known in milliseconds, as `1h 12m` or `4m 08s`. */
export function fmtElapsedMs(milliseconds: Maybe): string {
  if (!isPresent(milliseconds) || milliseconds < 0) return ABSENT;
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${String(hours)}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`;
}

/** Elapsed time between two ISO timestamps, as `1h 12m` or `4m 08s`. */
export function fmtDuration(fromIso: string | null | undefined, toIso?: string | null): string {
  if (fromIso === null || fromIso === undefined || fromIso === '') return ABSENT;
  const start = new Date(fromIso).getTime();
  const end =
    toIso === null || toIso === undefined || toIso === '' ? Date.now() : new Date(toIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return ABSENT;

  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${String(hours)}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`;
}

/** A ULID shortened for chrome that cannot fit 26 characters. */
export function fmtShortId(id: string | null | undefined, head = 10): string {
  if (id === null || id === undefined || id === '') return ABSENT;
  return id.length <= head ? id : `${id.slice(0, head)}…`;
}
