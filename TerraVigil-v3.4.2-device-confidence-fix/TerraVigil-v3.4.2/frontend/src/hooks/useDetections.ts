import { missionPollInterval } from './missionPolling';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type DetectionFilters } from '../services/api';
import { useDetectionStore } from '../state/detectionStore';
import { useEffect } from 'react';
import type { ReviewState } from '../domain/types';

export function useDetections(sessionId?: string, filters?: DetectionFilters) {
  const { setDetections } = useDetectionStore();

  const detectionsQuery = useQuery({
    refetchInterval: missionPollInterval,
    queryKey: ['detections', sessionId, filters],
    queryFn: () => api.getDetections(sessionId, filters),
  });

  useEffect(() => {
    setDetections(detectionsQuery.data ?? []);
  }, [detectionsQuery.data, setDetections]);

  const review = useDetectionReview();

  return {
    ...detectionsQuery,
    detections: detectionsQuery.data ?? [],
    ...review,
  };
}

export function useDetection(id?: string) {
  return useQuery({
    refetchInterval: missionPollInterval,
    queryKey: ['detection', id],
    queryFn: () => (id ? api.getDetection(id) : null),
    enabled: Boolean(id),
  });
}

export function useDetectionReview() {
  const queryClient = useQueryClient();
  const reviewMutation = useMutation({
    mutationFn: ({ id, state, note }: { id: string; state: ReviewState; note?: string }) =>
      api.submitReview(id, state, note),
    onSuccess: (detection) => {
      queryClient.invalidateQueries({ queryKey: ['detections'] });
      queryClient.invalidateQueries({ queryKey: ['detection', detection.id] });
      queryClient.invalidateQueries({ queryKey: ['riskSurface', detection.sessionId] });
    },
  });

  return { submitReview: reviewMutation.mutateAsync, isSubmittingReview: reviewMutation.isPending };
}
