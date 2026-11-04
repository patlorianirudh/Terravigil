import { useMutation } from '@tanstack/react-query';
import { api } from '../services/api';
import type { SafePathRequest } from '../domain/types';

export function useSafePath() {
  const calculateMutation = useMutation({
    mutationFn: (req: SafePathRequest) => api.calculateSafePath(req),
  });

  return {
    calculateSafePath: calculateMutation.mutateAsync,
    isCalculating: calculateMutation.isPending,
    result: calculateMutation.data,
    error: calculateMutation.error,
    reset: calculateMutation.reset,
  };
}
