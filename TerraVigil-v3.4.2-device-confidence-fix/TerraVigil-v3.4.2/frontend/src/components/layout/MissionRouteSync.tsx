import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../state/sessionStore';

/** Keep deep links and refreshes on the selected mission. */
export function MissionRouteSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const sessions = useSessionStore((state) => state.sessions);
  useEffect(() => {
    const { activeSession, setActiveSession } = useSessionStore.getState();
    if (['/model', '/firebase', '/map', '/safe-path'].includes(location.pathname)) return;
    const query = new URLSearchParams(location.search);
    const requested = query.get('mission');
    if (requested && ['SAMPLE-TV001', 'TV-TELEMETRY-DEMO'].includes(requested)) {
      query.delete('mission');
      if (activeSession && !activeSession.isSample) query.set('mission', activeSession.id);
      navigate(
        { pathname: location.pathname, search: query.toString(), hash: location.hash },
        { replace: true },
      );
      return;
    }
    if (requested) {
      const session = sessions.find((row) => row.id === requested);
      if (session && session.id !== activeSession?.id) setActiveSession(session);
      else if (!session && sessions.length > 0 && activeSession) setActiveSession(null);
      return;
    }
    if (activeSession) {
      query.set('mission', activeSession.id);
      navigate(
        { pathname: location.pathname, search: query.toString(), hash: location.hash },
        { replace: true },
      );
    }
  }, [location.pathname, location.search, location.hash, sessions, navigate]);
  return null;
}
