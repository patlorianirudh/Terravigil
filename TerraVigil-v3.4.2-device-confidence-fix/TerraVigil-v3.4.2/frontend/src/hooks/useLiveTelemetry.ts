import { useSessionStore } from '../state/sessionStore';
import { useTelemetryStore } from '../state/telemetryStore';

/**
 * Read-only view of live telemetry. The subscription itself lives in
 * `useRealtimeBridge`, mounted once by the app shell, so ten components reading
 * telemetry still means one socket and one store.
 */
export function useLiveTelemetry() {
  const latestTelemetry = useTelemetryStore((s) => s.latestTelemetry);
  const trackHistory = useTelemetryStore((s) => s.trackHistory);
  const sessionId = useSessionStore((state) => state.activeSession?.id);
  return {
    latestTelemetry: latestTelemetry?.sessionId === sessionId ? latestTelemetry : null,
    trackHistory: trackHistory.filter((point) => point.sessionId === sessionId),
  };
}
