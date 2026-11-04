import { useSessionStore } from '../../state/sessionStore';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChevronRight, Command, Radio, Search, X } from 'lucide-react';
import { useUIStore } from '../../state/uiStore';
import { useMe } from '../../hooks/useMe';
import { NAV_GROUPS } from './navItems';
import { config } from '../../config';
const destinations = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.heading })),
);
export function TopBar() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const ws = useUIStore((s) => s.ws);
  const rest = useUIStore((s) => s.rest);
  const { sessions, activeSession, setActiveSession } = useSessionStore();
  const { data: me } = useMe();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const active =
    destinations.find((item) => item.to === pathname) ??
    destinations.find((item) => item.to !== '/' && pathname.startsWith(item.to));
  const results = destinations.filter((item) =>
    `${item.label} ${item.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  function closeSearch() {
    setSearchOpen(false);
    searchRef.current?.focus();
  }
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((value) => !value);
        setQuery('');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <>
      <header className="workspace-topbar">
        <div className="breadcrumb">
          <span>Workspace</span>
          <ChevronRight size={12} className="text-text-muted" />
          <span>{active?.label ?? 'Workspace'}</span>
        </div>
        <div className="topbar-actions">
          <select
            aria-label="Selected mission"
            className="field max-w-48 text-xs"
            value={activeSession?.id ?? ''}
            onChange={(event) => {
              const session = sessions.find((row) => row.id === event.target.value) ?? null;
              setActiveSession(session);
              if (session) {
                const query = new URLSearchParams(search);
                query.set('mission', session.id);
                query.delete('detection');
                const target = pathname.startsWith('/detections/')
                  ? '/detections'
                  : pathname.startsWith('/sessions/')
                    ? '/sessions'
                    : pathname;
                navigate(`${target}?${query.toString()}`);
              }
            }}
          >
            <option value="" disabled>
              Select mission
            </option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.id} · {session.siteName}
              </option>
            ))}
          </select>
          <button
            type="button"
            ref={searchRef}
            className="workspace-search"
            onClick={() => {
              setQuery('');
              setSearchOpen(true);
            }}
            aria-label="Search workspace"
          >
            <Search size={15} />
            <span>Search workspace</span>
            <kbd>⌘ K</kbd>
          </button>
          <span className="topbar-divider" />
          <Link
            to="/system"
            className="topbar-connection flex items-center gap-1.5 text-[10px] text-text-secondary"
          >
            <Radio size={13} className={ws === 'connected' ? 'text-ok' : 'text-text-muted'} />
            {config.dataMode === 'demo' || activeSession?.isSample === true
              ? 'Simulated mission'
              : config.backendStyle === 'missions'
                ? rest === 'reachable'
                  ? 'Backend connected'
                  : rest === 'unreachable'
                    ? 'Backend unavailable'
                    : 'Checking backend'
                : ws === 'connected'
                  ? 'Connected'
                  : 'Offline'}
          </Link>
          <Link
            to="/settings"
            aria-label="Account and settings"
            title={me?.name ?? 'Account settings'}
            className="avatar"
          >
            {(me?.callsign ?? me?.name ?? 'OP').slice(0, 2).toUpperCase()}
          </Link>
        </div>
      </header>
      {searchOpen && (
        <div
          className="command-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSearch();
          }}
        >
          <div
            ref={dialogRef}
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Search workspace"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch();
              if (event.key === 'Tab') {
                const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('input,button');
                if (nodes?.length) {
                  const first = nodes[0],
                    last = nodes[nodes.length - 1];
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                  } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                  }
                }
              }
            }}
          >
            <div className="command-search">
              <Command size={18} className="text-accent" />
              <input
                autoFocus
                aria-label="Find a screen"
                placeholder="Where would you like to go?"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && results[0]) {
                    navigate(results[0].to);
                    closeSearch();
                  }
                }}
              />
              <button type="button" onClick={closeSearch} aria-label="Close search">
                <X size={16} />
              </button>
            </div>
            <div className="command-results">
              <p className="type-eyebrow px-3 py-2">Navigate workspace</p>
              {results.map((item) => (
                <button
                  type="button"
                  key={item.to}
                  className="command-result"
                  onClick={() => {
                    navigate(item.to);
                    closeSearch();
                  }}
                >
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                  <span>{item.group}</span>
                  <ArrowUpRight size={13} />
                </button>
              ))}
              {results.length === 0 && (
                <p className="p-6 text-text-muted">No screens match “{query}”.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
