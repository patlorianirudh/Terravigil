import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Eye,
  Layers3,
  LockKeyhole,
  Monitor,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Wifi,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useSessionStore } from '../state/sessionStore';
import { useUIStore } from '../state/uiStore';
import { useMe } from '../hooks/useMe';
import { config as appConfig } from '../config';
import { ABSENT, fmtNum, fmtScore } from '../lib/formatters';
import '../styles/workspace.css';

const REST_LABEL: Record<string, string> = {
  unconfigured: 'Not configured',
  unknown: 'Checking',
  reachable: 'Connected',
  unreachable: 'Not responding',
  demo: 'Demo workspace',
};
const WS_LABEL: Record<string, string> = {
  unconfigured: 'Not configured',
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  connected: 'Connected',
  demo: 'Demo replay',
};
const LAYER_OPTIONS = [
  {
    key: 'confirmedMines',
    title: 'Confirmed detections',
    description: 'Observations with visual and metallic evidence',
  },
  {
    key: 'unconfirmedVisual',
    title: 'Visual detections',
    description: 'Camera observations awaiting metallic corroboration',
  },
  {
    key: 'unresolvedMetal',
    title: 'Metal observations',
    description: 'Metallic signals without a visual association',
  },
  {
    key: 'flightTrack',
    title: 'Flight track',
    description: 'The aircraft’s recorded path through the survey',
  },
  {
    key: 'uncertaintyCircles',
    title: 'Position uncertainty',
    description: 'Localization uncertainty around observations',
  },
] as const;

export const SettingsPage: React.FC = () => {
  const activeSession = useSessionStore((s) => s.activeSession);
  const rest = useUIStore((s) => s.rest);
  const ws = useUIStore((s) => s.ws);
  const layers = useUIStore((s) => s.layers);
  const setLayer = useUIStore((s) => s.setLayer);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { data: operator } = useMe();
  const [saved, setSaved] = useState(false);
  const config = activeSession?.config;
  const isDemo = appConfig.dataMode === 'demo';
  const noteSaved = (): void => {
    setSaved(true);
  };

  return (
    <div className="workspace-page settings-page">
      <PageHeader
        eyebrow="Workspace / Settings"
        title="A workspace that works for you."
        description="Manage your view, inspect session parameters, and keep an eye on your connections."
        actions={
          <span className="settings-save-status" role="status">
            <Check className="size-4" />
            {saved ? 'Preferences saved' : 'Preferences save automatically'}
          </span>
        }
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <a
            href="#workspace-preferences"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById('workspace-preferences')?.scrollIntoView({ block: 'start' });
            }}
          >
            <Monitor className="size-4" />
            Workspace
            <ChevronRight className="ml-auto size-3" />
          </a>
          <a
            href="#map-preferences"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById('map-preferences')?.scrollIntoView({ block: 'start' });
            }}
          >
            <Layers3 className="size-4" />
            Map layers
          </a>
          <a
            href="#session-configuration"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById('session-configuration')?.scrollIntoView({ block: 'start' });
            }}
          >
            <SlidersHorizontal className="size-4" />
            Session parameters
          </a>
          <a
            href="#connection-settings"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById('connection-settings')?.scrollIntoView({ block: 'start' });
            }}
          >
            <Wifi className="size-4" />
            Connections
          </a>
        </nav>
        <div className="settings-sections">
          <section id="workspace-preferences" className="workspace-card">
            <div className="workspace-card-heading">
              <div>
                <h2>Workspace</h2>
                <p>Your operator identity and viewing preferences</p>
              </div>
              <Monitor className="size-4 text-text-muted" />
            </div>
            <div className="settings-account">
              <span className="settings-avatar">
                {operator?.name
                  .split(' ')
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join('') ?? <UserRound className="size-6" />}
              </span>
              <div>
                <h3>{operator?.name ?? 'Operator account'}</h3>
                <p>{operator?.email ?? 'Account details are not available'}</p>
              </div>
              <span className="workspace-state">{operator?.role ?? 'Not signed in'}</span>
            </div>
            <div className="settings-preference">
              <div>
                <strong>Compact navigation</strong>
                <p>Keep the sidebar collapsed to give your workspace more room.</p>
              </div>
              <button
                className={`workspace-toggle ${collapsed ? 'is-on' : ''}`}
                type="button"
                role="switch"
                aria-checked={collapsed}
                aria-label="Compact navigation"
                onClick={() => {
                  toggleSidebar();
                  noteSaved();
                }}
              >
                <span />
              </button>
            </div>
            <p className="workspace-note">Display preferences are remembered on this browser.</p>
          </section>
          <section id="map-preferences" className="workspace-card">
            <div className="workspace-card-heading">
              <div>
                <h2>Map layers</h2>
                <p>Choose the evidence and context shown on your maps</p>
              </div>
              <Eye className="size-4 text-text-muted" />
            </div>
            <div className="settings-layers">
              {LAYER_OPTIONS.map((option) => (
                <div className="settings-preference" key={option.key}>
                  <div>
                    <strong>{option.title}</strong>
                    <p>{option.description}</p>
                  </div>
                  <button
                    type="button"
                    className={`workspace-toggle ${layers[option.key] ? 'is-on' : ''}`}
                    role="switch"
                    aria-checked={layers[option.key]}
                    aria-label={option.title}
                    onClick={() => {
                      setLayer(option.key, !layers[option.key]);
                      noteSaved();
                    }}
                  >
                    <span />
                  </button>
                </div>
              ))}
            </div>
            <div className="settings-card-footer">
              <p>Layer changes apply immediately to map views.</p>
              <Link to="/risk-map" className="workspace-inline-link">
                Open risk map <ArrowUpRight className="size-4" />
              </Link>
            </div>
          </section>
          <section id="session-configuration" className="workspace-card">
            <div className="workspace-card-heading">
              <div>
                <h2>Session parameters</h2>
                <p>{activeSession?.siteName ?? 'No session selected'}</p>
              </div>
              <span className="settings-readonly">
                <LockKeyhole className="size-3" />
                Read only
              </span>
            </div>
            {config === undefined ? (
              <div className="settings-empty">
                <SlidersHorizontal className="size-6 text-text-muted" />
                <h3>Select a session to inspect its parameters</h3>
                <p>Detection and sensor parameters are recorded with each session.</p>
                <Link to="/sessions" className="workspace-inline-link">
                  Browse sessions <ArrowUpRight className="size-4" />
                </Link>
              </div>
            ) : (
              <div className="settings-parameter-grid">
                <dl className="workspace-details">
                  <div>
                    <dt>Visual confidence threshold</dt>
                    <dd>{fmtScore(config.visualConfidenceThreshold)}</dd>
                  </div>
                  <div>
                    <dt>Metal signal threshold</dt>
                    <dd>{fmtScore(config.metalThresholdNorm)}</dd>
                  </div>
                  <div>
                    <dt>Nominal altitude</dt>
                    <dd>{fmtNum(config.nominalAglM, 1, 'm AGL')}</dd>
                  </div>
                  <div>
                    <dt>Association radius</dt>
                    <dd>{fmtNum(config.associationRadiusM, 1, 'm')}</dd>
                  </div>
                </dl>
                <dl className="workspace-details">
                  <div>
                    <dt>Coil standoff limit</dt>
                    <dd>{fmtNum(config.metalMaxStandoffM, 2, 'm')}</dd>
                  </div>
                  <div>
                    <dt>Coil swath</dt>
                    <dd>{fmtNum(config.metalSwathM, 2, 'm')}</dd>
                  </div>
                  <div>
                    <dt>Inference width</dt>
                    <dd>
                      {config.inferenceWidthPx === null ? ABSENT : `${config.inferenceWidthPx} px`}
                    </dd>
                  </div>
                  <div>
                    <dt>Forward / side overlap</dt>
                    <dd>
                      {fmtScore(config.forwardOverlap)} / {fmtScore(config.sideOverlap)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
            <p className="workspace-note flex items-start gap-2">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
              Parameters are frozen when a session starts. Create a new session to use different
              thresholds.
            </p>
          </section>
          <section id="connection-settings" className="workspace-card">
            <div className="workspace-card-heading">
              <div>
                <h2>Connections</h2>
                <p>The data services powering this workspace</p>
              </div>
              <Radio className="size-4 text-text-muted" />
            </div>
            <div className="settings-connection">
              <span className="workspace-icon-box">
                <Wifi className="size-4" />
              </span>
              <div>
                <h3>Ground station API</h3>
                <p>
                  {isDemo
                    ? 'Local demonstration dataset'
                    : appConfig.apiBaseUrl === ''
                      ? 'No endpoint configured'
                      : appConfig.apiBaseUrl}
                </p>
              </div>
              <StatusBadge
                status={
                  rest === 'reachable' ? 'ok' : rest === 'unreachable' ? 'critical' : 'offline'
                }
                label={REST_LABEL[rest] ?? rest}
              />
            </div>
            <div className="settings-connection">
              <span className="workspace-icon-box">
                <Radio className="size-4" />
              </span>
              <div>
                <h3>Realtime telemetry</h3>
                <p>
                  {isDemo
                    ? 'Simulated telemetry replay'
                    : appConfig.wsUrl === ''
                      ? 'No endpoint configured'
                      : appConfig.wsUrl}
                </p>
              </div>
              <StatusBadge
                status={ws === 'connected' ? 'ok' : ws === 'connecting' ? 'info' : 'offline'}
                label={WS_LABEL[ws] ?? ws}
              />
            </div>
            <p className="workspace-note">
              Connection endpoints are deployment settings. Contact your system administrator to
              change the ground station.
            </p>
          </section>
          <div className="settings-authority">
            <ShieldCheck className="size-5" />
            <div>
              <h3>Observation is our role.</h3>
              <p>
                TerraVigil receives telemetry and supports survey decisions. Aircraft commands and
                failsafe configuration remain with the flight controller and its operator.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
