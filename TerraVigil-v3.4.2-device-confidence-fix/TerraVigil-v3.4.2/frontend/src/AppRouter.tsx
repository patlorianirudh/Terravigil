import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { OperationsPage } from './pages/OperationsPage';
import { LiveConsolePage } from './pages/LiveConsolePage';
import { SessionsPage } from './pages/SessionsPage';
const SessionDetailPage = lazy(() =>
  import('./pages/SessionDetailPage').then((module) => ({ default: module.SessionDetailPage })),
);
import { DetectionsPage } from './pages/DetectionsPage';
import { DetectionDetailPage } from './pages/DetectionDetailPage';
import { RiskMapPage } from './pages/RiskMapPage';
const RoutePlannerPage = lazy(() =>
  import('./pages/RoutePlannerPage').then((module) => ({ default: module.RoutePlannerPage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);
const ConnectionsPage = lazy(() =>
  import('./pages/ConnectionsPage').then((module) => ({ default: module.ConnectionsPage })),
);
const AssistantPage = lazy(() =>
  import('./pages/AssistantPage').then((module) => ({ default: module.AssistantPage })),
);
const SystemPage = lazy(() =>
  import('./pages/SystemPage').then((module) => ({ default: module.SystemPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
const BriefingPage = lazy(() =>
  import('./pages/BriefingPage').then((module) => ({ default: module.BriefingPage })),
);

function LegacyRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div role="status" className="p-8 text-text-secondary">
            Loading workspace…
          </div>
        }
      >
        <Routes>
          <Route path="/briefing" element={<BriefingPage />} />
          <Route path="/login" element={<LoginPage />} />

          <Route element={<AppShell />}>
            <Route path="/" element={<OperationsPage />} />
            <Route path="/live" element={<LiveConsolePage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/:id" element={<SessionDetailPage />} />
            <Route path="/detections" element={<DetectionsPage />} />
            <Route path="/detections/:id" element={<DetectionDetailPage />} />
            <Route path="/risk-map" element={<RiskMapPage />} />
            <Route path="/route" element={<RoutePlannerPage />} />
            {/* Old address kept working: the page was renamed, not removed. */}
            <Route path="/safe-path" element={<LegacyRedirect to="/route" />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/model" element={<LegacyRedirect to="/connections" />} />
            <Route path="/firebase" element={<LegacyRedirect to="/connections" />} />
            <Route path="/map" element={<LegacyRedirect to="/risk-map" />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};
