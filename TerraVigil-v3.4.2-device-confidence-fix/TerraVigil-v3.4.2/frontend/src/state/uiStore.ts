import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { workspaceStorage } from '../lib/workspaceStorage';

import type { ConnectionState } from '../services/socket';

interface LayerVisibility {
  riskHeatmap: boolean;
  confirmedMines: boolean;
  unconfirmedVisual: boolean;
  unresolvedMetal: boolean;
  flightTrack: boolean;
  visualCoverage: boolean;
  dualCoverage: boolean;
  uncertaintyCircles: boolean;
}

/** What the REST layer last told us about reaching the backend. */
export type RestState = 'unconfigured' | 'unknown' | 'reachable' | 'unreachable' | 'demo';

interface UIState {
  sidebarCollapsed: boolean;
  layers: LayerVisibility;
  rest: RestState;
  ws: ConnectionState;
  toggleSidebar: () => void;
  toggleLayer: (layer: keyof LayerVisibility) => void;
  setLayer: (layer: keyof LayerVisibility, visible: boolean) => void;
  setRestState: (state: RestState) => void;
  setWsState: (state: ConnectionState) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      layers: {
        riskHeatmap: true,
        confirmedMines: true,
        unconfirmedVisual: true,
        unresolvedMetal: true,
        flightTrack: true,
        visualCoverage: true,
        dualCoverage: true,
        uncertaintyCircles: true,
      },
      rest: 'unknown',
      ws: 'disconnected',
      toggleSidebar: () => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
      },
      toggleLayer: (layer) => {
        set((state) => ({
          layers: { ...state.layers, [layer]: !state.layers[layer] },
        }));
      },
      setLayer: (layer, visible) => {
        set((state) => ({
          layers: { ...state.layers, [layer]: visible },
        }));
      },
      setRestState: (rest) => {
        set({ rest });
      },
      setWsState: (ws) => {
        set({ ws });
      },
    }),
    {
      name: 'terravigil.workspace.preferences.v1',
      storage: createJSONStorage(() => workspaceStorage),
      partialize: (state) => ({ layers: state.layers, sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
