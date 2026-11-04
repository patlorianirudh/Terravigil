import { missionPollInterval } from './missionPolling';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { useSessionStore, savedMissionId } from '../state/sessionStore';
import { useEffect } from 'react';
import type { ScanSession, SessionConfig } from '../domain/types';
import { ServiceError } from '../services/errors';

export function useSessions() {
  const queryClient = useQueryClient();
  const { setSessions, setActiveSession } = useSessionStore();

  const sessionsQuery = useQuery({
    refetchInterval: missionPollInterval,
    queryKey: ['sessions'],
    queryFn: async () =>
      (await api.getSessions()).filter(
        (session) =>
          session.isSample !== true && !['SAMPLE-TV001', 'TV-TELEMETRY-DEMO'].includes(session.id),
      ),
  });

  useEffect(() => {
    if (sessionsQuery.data) {
      setSessions(sessionsQuery.data);
      const requestedId =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('mission')
          : null;
      const usableRequestedId =
        requestedId && !['SAMPLE-TV001', 'TV-TELEMETRY-DEMO'].includes(requestedId)
          ? requestedId
          : null;
      const selectedId =
        usableRequestedId ?? useSessionStore.getState().activeSession?.id ?? savedMissionId();
      const active = usableRequestedId
        ? (sessionsQuery.data.find((s) => s.id === usableRequestedId) ?? null)
        : (sessionsQuery.data.find((s) => s.id === selectedId) ??
          sessionsQuery.data.find((s) => s.state === 'active') ??
          sessionsQuery.data[0] ??
          null);
      setActiveSession(active);
    }
  }, [sessionsQuery.data, setSessions, setActiveSession]);

  const createSessionMutation = useMutation({
    mutationFn: (payload: {
      siteName: string;
      flightMode: 'rc_manual' | 'ardupilot_auto';
      notes: string;
      config: Partial<SessionConfig>;
    }) => api.createSession(payload),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setActiveSession(newSession);
    },
  });

  const endSessionMutation = useMutation({
    mutationFn: (id: string) => api.endSession(id),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session', session.id] });
      if (useSessionStore.getState().activeSession?.id === session.id) setActiveSession(session);
    },
  });

  return {
    ...sessionsQuery,
    sessions: sessionsQuery.data ?? [],
    createSession: createSessionMutation.mutateAsync,
    isCreating: createSessionMutation.isPending,
    endSession: endSessionMutation.mutateAsync,
    isEnding: endSessionMutation.isPending,
  };
}

export function useSession(id?: string) {
  return useQuery({
    refetchInterval: missionPollInterval,
    queryKey: ['session', id],
    queryFn: () => (id ? api.getSession(id) : null),
    enabled: Boolean(id),
  });
}

export function useLoadSampleMission() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const loaded = await api.loadSampleMission();
      const session = await api.getSession(loaded.sessionId);
      if (session?.id !== loaded.sessionId || session.isSample !== true)
        throw new ServiceError(
          'invalid',
          'The synthetic sample mission could not be read. Load it again.',
        );
      return { ...session, sampleRoute: session.sampleRoute ?? loaded.suggestedRoute };
    },
    onSuccess: async (session) => {
      await queryClient.cancelQueries({ queryKey: ['sessions'] });
      queryClient.setQueryData(['session', session.id], session);
      queryClient.setQueryData<ScanSession[]>(['sessions'], (current = []) => [
        ...current.filter((item) => item.id !== session.id),
        session,
      ]);
      useSessionStore.getState().setActiveSession(session);
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  return {
    loadSampleMission: mutation.mutateAsync,
    isLoadingSample: mutation.isPending,
    sampleError: mutation.error,
  };
}
