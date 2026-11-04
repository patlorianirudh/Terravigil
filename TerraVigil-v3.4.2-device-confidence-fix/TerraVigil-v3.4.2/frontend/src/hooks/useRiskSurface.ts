import { missionPollInterval } from './missionPolling';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

/** Stored risk points retain confirmation as a separate attribute. */
export function useRiskSurface(sessionId?: string) {
  return useQuery({
    refetchInterval: missionPollInterval,
    queryKey: ['riskSurface', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const records = await api.getRiskSurface(sessionId);
      return records.filter((record) => record.sessionId === sessionId);
    },
    enabled: Boolean(sessionId),
  });
}
