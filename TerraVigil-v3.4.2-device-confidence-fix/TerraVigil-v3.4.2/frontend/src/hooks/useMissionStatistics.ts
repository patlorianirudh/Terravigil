import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { config } from '../config';
import { missionPollInterval } from './missionPolling';

export function useMissionStatistics(sessionId?: string) {
  return useQuery({
    queryKey: ['missionStatistics', sessionId],
    queryFn: () => (sessionId ? api.getMissionStatistics(sessionId) : null),
    enabled:
      Boolean(sessionId) && (config.dataMode === 'demo' || config.backendStyle === 'missions'),
    refetchInterval: missionPollInterval,
  });
}
