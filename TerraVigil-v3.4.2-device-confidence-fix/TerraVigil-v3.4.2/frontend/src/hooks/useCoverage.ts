import { missionPollInterval } from './missionPolling';
import { useQuery } from '@tanstack/react-query';

import { api } from '../services/api';

/** Route 7 — derived swept ground for one session. */
export function useCoverage(sessionId?: string) {
  return useQuery({
    refetchInterval: missionPollInterval,
    queryKey: ['coverage', sessionId],
    queryFn: () => (sessionId === undefined ? null : api.getCoverage(sessionId)),
    enabled: sessionId !== undefined,
  });
}
