import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { socketService } from '../services/socket';
import { useTelemetryStore } from '../state/telemetryStore';
import { useDetectionStore } from '../state/detectionStore';
import { useSessionStore } from '../state/sessionStore';
import { useTrack } from './useTrack';

/**
 * The single realtime subscription for the app. Per PRD P-20.18 every pushed
 * event does two things: update the Zustand store so the UI moves immediately,
 * and invalidate the matching query key so the next refetch reconciles against
 * the server rather than trusting the push.
 *
 * Mount once, in the app shell.
 */
export function useRealtimeBridge(): void {
  const queryClient = useQueryClient();
  const updateTelemetry = useTelemetryStore((s) => s.updateTelemetry);
  const addOrUpdateDetection = useDetectionStore((s) => s.addOrUpdateDetection);
  const replaceHistory = useTelemetryStore((s) => s.replaceHistory);
  const clearHistory = useTelemetryStore((s) => s.clearHistory);
  const sessionId = useSessionStore((s) => s.activeSession?.id);

  const track = useTrack(sessionId);
  useEffect(() => {
    clearHistory();
    return clearHistory;
  }, [sessionId, clearHistory]);

  useEffect(() => {
    if (track.data) replaceHistory(track.data.filter((point) => point.sessionId === sessionId));
  }, [sessionId, track.data, replaceHistory]);

  useEffect(
    () =>
      socketService.subscribeTelemetry((point) => {
        if (point.sessionId === sessionId) updateTelemetry(point);
      }),
    [sessionId, updateTelemetry],
  );

  useEffect(
    () =>
      socketService.subscribeDetection((detection) => {
        if (detection.sessionId === sessionId) addOrUpdateDetection(detection);
        void queryClient.invalidateQueries({ queryKey: ['detections'] });
        void queryClient.invalidateQueries({ queryKey: ['detection', detection.id] });
        void queryClient.invalidateQueries({ queryKey: ['riskSurface', detection.sessionId] });
      }),
    [sessionId, addOrUpdateDetection, queryClient],
  );

  useEffect(
    () =>
      socketService.subscribeAlert(() => {
        void queryClient.invalidateQueries({ queryKey: ['systemEvents'] });
        void queryClient.invalidateQueries({ queryKey: ['system', 'health'] });
      }),
    [queryClient],
  );

  useEffect(
    () =>
      socketService.subscribeCoverage((coverage) => {
        void queryClient.invalidateQueries({ queryKey: ['coverage', coverage.sessionId] });
      }),
    [queryClient],
  );
}
