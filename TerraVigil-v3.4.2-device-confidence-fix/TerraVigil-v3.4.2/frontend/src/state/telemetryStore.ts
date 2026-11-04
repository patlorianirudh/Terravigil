import { create } from 'zustand';
import type { TrackPoint } from '../domain/types';

interface TelemetryState {
  latestTelemetry: TrackPoint | null;
  trackHistory: TrackPoint[];
  maxHistoryLength: number;
  replaceHistory: (points: TrackPoint[]) => void;
  updateTelemetry: (point: TrackPoint) => void;
  clearHistory: () => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  latestTelemetry: null,
  trackHistory: [],
  maxHistoryLength: 200,
  replaceHistory: (points) => {
    const unique = new Map(
      points.map((point) => [
        point.sourceRecordId ??
          `${point.sessionId}:${point.tUtc}:${point.position.lat}:${point.position.lon}`,
        point,
      ]),
    );
    const history = [...unique.values()].sort((a, b) => a.tUtc.localeCompare(b.tUtc));
    set({
      trackHistory: history,
      latestTelemetry: history.filter((point) => point.tUtc !== '').at(-1) ?? null,
    });
  },
  updateTelemetry: (point) => {
    set((state) => {
      const history = [
        ...state.trackHistory.filter(
          (existing) =>
            existing.sessionId === point.sessionId &&
            (existing.tUtc !== point.tUtc ||
              existing.position.lat !== point.position.lat ||
              existing.position.lon !== point.position.lon),
        ),
        point,
      ];
      if (history.length > state.maxHistoryLength) {
        history.shift();
      }
      return {
        latestTelemetry: point,
        trackHistory: history,
      };
    });
  },
  clearHistory: () => {
    set({ trackHistory: [], latestTelemetry: null });
  },
}));
