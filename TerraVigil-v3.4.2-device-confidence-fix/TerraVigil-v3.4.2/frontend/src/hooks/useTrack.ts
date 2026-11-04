import { missionPollInterval } from './missionPolling';
import { useQuery } from '@tanstack/react-query';

import { api } from '../services/api';

/**
 * Route 6 — the flown track for a session. Live telemetry arrives over the
 * socket; this is the recorded history, used by replay and the sweep ribbon on
 * ended sessions.
 */
export function useTrack(sessionId?: string) {
  return useQuery({
    refetchInterval: missionPollInterval,
    queryKey: ['track', sessionId],
    queryFn: () => (sessionId === undefined ? [] : api.getTrack(sessionId)),
    enabled: sessionId !== undefined,
  });
}
