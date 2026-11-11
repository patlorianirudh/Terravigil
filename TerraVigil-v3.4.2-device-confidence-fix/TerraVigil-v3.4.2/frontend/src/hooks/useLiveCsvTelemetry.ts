import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bridgeApi, type LiveTelemetry } from '../services/bridge';

/** Values older than this are flagged as stale (telemetry logger not appending). */
export const LIVE_STALE_MS = 5000;
export const LIVE_POLL_MS = 1000;

export interface LiveTelemetryView {
  data: LiveTelemetry | null;
  isError: boolean;
  /** True when the CSV is being appended right now. */
  isStreaming: boolean;
  /** True when the newest CSV row is older than LIVE_STALE_MS. */
  isStale: boolean;
  /** True once at least one live row has been seen. */
  hasData: boolean;
  /** Wall-clock ms of the last observed CSV change (new row or changed value). */
  lastChangeMs: number | null;
  /** CSV rows per second, measured across the last two polls with new rows. */
  rowsPerSecond: number | null;
  /** Field-level changes between the previous and newest sample. */
  lastChanges: { field: string; from: string; to: string }[];
}

function sampleSignature(data: LiveTelemetry | null | undefined): string {
  if (!data) return '';
  return JSON.stringify([
    data.timestamp,
    data.csv_size_bytes,
    data.fields ?? null,
  ]);
}

/**
 * Polls the read-only live-CSV endpoint once per second and derives freshness
 * signals for the dashboard strip and the live preview page. Works both when
 * the full backend serves the endpoint and when only the Vite dev middleware
 * is running (npm run dev preview).
 */
export function useLiveCsvTelemetry(): LiveTelemetryView {
  const query = useQuery({
    queryKey: ['live-csv-telemetry'],
    queryFn: bridgeApi.liveTelemetry,
    refetchInterval: LIVE_POLL_MS,
    retry: 1,
  });
  const data = query.data ?? null;

  const signature = sampleSignature(data);
  const previous = useRef<{ signature: string; time: number; rows: number | null }>({
    signature: '',
    time: 0,
    rows: null,
  });
  const [lastChangeMs, setLastChangeMs] = useState<number | null>(null);
  const [rowsPerSecond, setRowsPerSecond] = useState<number | null>(null);
  const [lastChanges, setLastChanges] = useState<{ field: string; from: string; to: string }[]>([]);
  const previousFields = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    if (signature === previous.current.signature) return;
    const now = Date.now();
    const interval = previous.current.time === 0 ? null : (now - previous.current.time) / 1000;
    const tailRows = data.tail_rows ?? null;
    if (interval !== null && interval > 0.2 && tailRows !== null && previous.current.rows !== null) {
      // Only count growth; a shrinking tail means the window slid, not new rows.
      if (tailRows > previous.current.rows) {
        setRowsPerSecond((tailRows - previous.current.rows) / interval);
      }
    }
    if (previous.current.signature !== '') {
      const changes: { field: string; from: string; to: string }[] = [];
      const fields = data.fields ?? {};
      for (const [field, value] of Object.entries(fields)) {
        const before = previousFields.current[field];
        if (before !== value) changes.push({ field, from: before ?? '—', to: value });
      }
      setLastChanges(changes.slice(-24));
    }
    previousFields.current = data.fields ?? {};
    previous.current = { signature, time: now, rows: tailRows };
    setLastChangeMs(now);
  }, [signature, data]);

  const isStreaming =
    data?.state === 'live' &&
    lastChangeMs !== null &&
    Date.now() - lastChangeMs <= LIVE_STALE_MS;
  const isStale =
    (data?.state === 'live' &&
      ((data.age_ms !== null && data.age_ms !== undefined && data.age_ms > LIVE_STALE_MS) ||
        (lastChangeMs !== null && Date.now() - lastChangeMs > LIVE_STALE_MS))) ||
    false;

  return {
    data,
    isError: query.isError,
    isStreaming,
    isStale,
    hasData: data?.state === 'live',
    lastChangeMs,
    rowsPerSecond,
    lastChanges,
  };
}
