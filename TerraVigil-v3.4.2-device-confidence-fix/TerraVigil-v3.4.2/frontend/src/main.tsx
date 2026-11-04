import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRouter } from './AppRouter';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found.');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  </StrictMode>,
);
