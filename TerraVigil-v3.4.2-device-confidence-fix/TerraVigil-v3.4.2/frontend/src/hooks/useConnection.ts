import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { config } from '../config';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { ServiceError } from '../services/errors';
import { useUIStore } from '../state/uiStore';

/**
 * Tracks whether the backend is actually reachable, on both transports, and
 * mirrors it into the UI store so any component can say so without importing
 * a service. Mount once, in the app shell.
 */
export function useConnection(): void {
  const setRestState = useUIStore((s) => s.setRestState);
  const setWsState = useUIStore((s) => s.setWsState);

  const heartbeat = useQuery({
    queryKey: ['connection', 'rest'],
    queryFn: async () => {
      if (config.dataMode === 'live' && config.backendStyle === 'missions') await api.getSessions();
      else await api.getSystemHealth();
      return true;
    },
    enabled: config.dataMode === 'demo' || config.isConfigured,
    refetchInterval: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (config.dataMode === 'demo') {
      setRestState('demo');
      return;
    }
    if (!config.isConfigured) {
      setRestState('unconfigured');
      return;
    }
    if (heartbeat.isSuccess) {
      setRestState('reachable');
      return;
    }
    if (heartbeat.isError) {
      const kind = heartbeat.error instanceof ServiceError ? heartbeat.error.kind : 'offline';
      // A 4xx still proves something is listening; only transport failures and
      // server faults mean "unreachable".
      setRestState(kind === 'invalid' ? 'reachable' : 'unreachable');
    }
  }, [heartbeat.isSuccess, heartbeat.isError, heartbeat.error, setRestState]);

  useEffect(() => socketService.subscribeConnectionState(setWsState), [setWsState]);
}
