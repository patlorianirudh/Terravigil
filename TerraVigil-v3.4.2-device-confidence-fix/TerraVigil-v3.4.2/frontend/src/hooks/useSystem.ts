import { useQuery } from '@tanstack/react-query';

import { api } from '../services/api';

/**
 * Route 12 — subsystem health snapshot. Shares its query key with the
 * connection heartbeat, so mounting this costs no extra request.
 */
export function useSystemHealth() {
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => api.getSystemHealth(),
  });
}

/** Route 12 — diagnostic event log. */
export function useSystemEvents(sessionId?: string) {
  return useQuery({
    queryKey: ['systemEvents', sessionId],
    queryFn: () => api.getSystemEvents(sessionId),
  });
}

/** Route 13 — the model's class catalog. No class name is hardcoded (P-20.19). */
export function useDetectionClasses() {
  return useQuery({
    queryKey: ['detectionClasses'],
    queryFn: () => api.getDetectionClasses(),
    staleTime: 5 * 60_000,
  });
}
