import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

export function useReports() {
  const queryClient = useQueryClient();

  const reportsQuery = useQuery({
    queryKey: ['reports'],
    queryFn: async () =>
      (await api.getReports()).filter(
        (report) =>
          report.synthetic !== true &&
          !['SAMPLE-TV001', 'TV-TELEMETRY-DEMO'].includes(report.sessionId),
      ),
  });

  const generateReportMutation = useMutation({
    mutationFn: ({ sessionId, includeAi }: { sessionId: string; includeAi: boolean }) =>
      api.generateReport(sessionId, includeAi),
    onSuccess: (report) => {
      queryClient.setQueryData(['report', report.id], report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  return {
    ...reportsQuery,
    reports: reportsQuery.data ?? [],
    generateReport: (sessionId: string, includeAi = false) =>
      generateReportMutation.mutateAsync({ sessionId, includeAi }),
    isGenerating: generateReportMutation.isPending,
  };
}

export function useReport(id?: string) {
  return useQuery({
    queryKey: ['report', id],
    queryFn: () => (id ? api.getReport(id) : null),
    enabled: Boolean(id),
  });
}
