import { NavLink, Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ArrowUpRight, Radio } from 'lucide-react';
import { useUIStore } from '../../state/uiStore';
import { useSessionStore } from '../../state/sessionStore';
import { config } from '../../config';
import { NAV_GROUPS } from './navItems';
import { Brand } from './Brand';
export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const ws = useUIStore((s) => s.ws);
  const rest = useUIStore((s) => s.rest);
  const activeSession = useSessionStore((s) => s.activeSession);
  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Primary navigation">
      <Brand compact={collapsed} />
      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.heading}>
            {!collapsed && <p className="nav-group-label">{group.heading}</p>}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                title={item.label}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <item.icon />
                {!collapsed && <span className="nav-label">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      {!collapsed && (
        <Link to="/system" className="station-card">
          <div className="station-card-label">
            <Radio size={12} /> Ground station <ArrowUpRight size={12} className="ml-auto" />
          </div>
          <p>
            {config.dataMode === 'demo'
              ? 'Demonstration workspace'
              : config.backendStyle === 'missions'
                ? rest === 'reachable'
                  ? 'App backend connected'
                  : 'App backend unavailable'
                : ws === 'connected'
                  ? 'Telemetry connected'
                  : 'Awaiting connection'}
          </p>
          <span className="type-code text-[9px]">
            {activeSession
              ? activeSession.flightMode === null
                ? 'FLIGHT MODE UNREPORTED'
                : activeSession.flightMode === 'rc_manual'
                  ? 'RC MANUAL · OBSERVE ONLY'
                  : 'AUTO · OBSERVE ONLY'
              : 'READ-ONLY TELEMETRY'}
          </span>
        </Link>
      )}
      <div className="sidebar-footer">
        {!collapsed && <span>TERRAVIGIL / v3.4.0</span>}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>
    </aside>
  );
}
