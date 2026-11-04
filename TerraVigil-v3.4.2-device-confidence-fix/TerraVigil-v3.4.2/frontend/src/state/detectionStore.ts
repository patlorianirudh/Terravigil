import { create } from 'zustand';
import type { Detection, Classification, RiskBand, ReviewState } from '../domain/types';

interface DetectionState {
  detections: Detection[];
  selectedDetectionId: string | null;
  filters: {
    classification?: Classification;
    riskBand?: RiskBand;
    reviewState?: ReviewState;
    search?: string;
  };
  setDetections: (detections: Detection[]) => void;
  addOrUpdateDetection: (detection: Detection) => void;
  setSelectedDetectionId: (id: string | null) => void;
  setFilters: (filters: Partial<DetectionState['filters']>) => void;
}

export const useDetectionStore = create<DetectionState>((set) => ({
  detections: [],
  selectedDetectionId: null,
  filters: {},
  setDetections: (detections) => {
    set({ detections });
  },
  addOrUpdateDetection: (detection) => {
    set((state) => {
      const idx = state.detections.findIndex((d) => d.id === detection.id);
      if (idx >= 0) {
        const next = [...state.detections];
        next[idx] = detection;
        return { detections: next };
      }
      return { detections: [detection, ...state.detections] };
    });
  },
  setSelectedDetectionId: (id) => {
    set({ selectedDetectionId: id });
  },
  setFilters: (filters) => {
    set((state) => ({
      filters: { ...state.filters, ...filters },
    }));
  },
}));
