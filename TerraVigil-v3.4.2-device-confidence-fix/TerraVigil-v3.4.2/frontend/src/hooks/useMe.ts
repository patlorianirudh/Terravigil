import { useQuery } from '@tanstack/react-query';

import { api } from '../services/api';

/** Route 1 — the signed-in operator. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.getMe(),
    staleTime: 60_000,
  });
}
