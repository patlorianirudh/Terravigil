import { useQuery } from '@tanstack/react-query';
import { bridgeApi } from '../../services/bridge';
import { useRef } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { FlaskConical, ArrowUpRight } from 'lucide-react';
import { MissionRouteSync } from './MissionRouteSync';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { ConnectionNotice, type ConnectionNoticeKind } from '../ui/AlertNotice';
import { useUIStore } from '../../state/uiStore';
import { useConnection } from '../../hooks/useConnection';
import { useRealtimeBridge } from '../../hooks/useRealtimeBridge';
import { useSessionStore } from '../../state/sessionStore';
import { useSessions } from '../../hooks/useSessions';
import { config } from '../../config';
import { useWorkspaceMotion } from '../../hooks/useWorkspaceMotion';
function noticeFor(rest: string, ws: string): ConnectionNoticeKind | null {
  if (rest === 'unconfigured') return 'unconfigured';
  if (rest === 'unreachable') return 'unreachable';
  if (config.wsUrl === '') return null;
  if (ws === 'unconfigured') return null;
  if (ws !== 'connected' && ws !== 'connecting') return 'link-down';
  return null;
}
export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  useWorkspaceMotion(mainRef, location.pathname);
  useConnection();
  useRealtimeBridge();
  useSessions();
  const rest = useUIStore((s) => s.rest);
  const ws = useUIStore((s) => s.ws);
  const demo = config.dataMode === 'demo';
  const sample = useSessionStore((s) => s.activeSession?.isSample === true);
  const { data: bridge } = useQuery({ queryKey: ['bridge-status'], queryFn: bridgeApi.status, refetchInterval: 3000 });
  const notice = demo ? null : noticeFor(rest, ws);
  return (
    <div className="app-shell">
      <a
        href="#workspace-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('workspace-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <MissionRouteSync />
      <Sidebar />
      <div className="workspace">
        <TopBar />
        {(demo || sample) && (
          <div className="demo-notice" role="status">
            <div className="flex items-center gap-2">
              <FlaskConical size={12} aria-hidden />
              <strong>SIMULATED DATA</strong>
              <span className="demo-detail">
                Demo mission · Synthetic observations
              </span>
            </div>
            <Link to="/settings" className="flex items-center gap-1">
              Workspace settings <ArrowUpRight size={11} />
            </Link>
          </div>
        )}
        {bridge?.test_mode && (
          <div className="demo-notice" role="status">
            <strong>REAL FIREBASE · TEST IMAGES</strong>
            <span>Recorded GPS + synthetic image fixtures. No detector inference.</span>
          </div>
        )}
        {notice && (
          <ConnectionNotice kind={notice} className="rounded-none border-x-0 border-t-0" />
        )}
        <main ref={mainRef} id="workspace-content" className="workspace-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
