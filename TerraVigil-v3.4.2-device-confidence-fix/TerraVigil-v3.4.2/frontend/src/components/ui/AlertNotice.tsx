import React from 'react';
import { ShieldAlert, TriangleAlert, WifiOff } from 'lucide-react';

/**
 * The SWEPT ≠ CLEARED notice (P-12.11 / P-23.9). Persistent wherever coverage
 * is rendered, never dismissible, never a toast. This is the one piece of copy
 * in the product whose absence could get someone killed, so it is styled to be
 * read rather than to be pretty.
 */
export const SweptNotClearedBanner: React.FC<{ compact?: boolean; className?: string }> = ({
  compact = false,
  className = '',
}) => (
  <div className={`swept-notice ${className}`}>
    <p className="flex items-center gap-2 font-mono text-[11.5px] font-semibold tracking-[0.08em] text-warning">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      SWEPT ≠ CLEARED
    </p>
    {!compact && (
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-text-secondary">
        This map shows where sensors passed and what they observed. It is a survey aid, not an IMAS
        land-release certificate. Do not authorise entry on the basis of this map.
      </p>
    )}
  </div>
);

export type ConnectionNoticeKind = 'unconfigured' | 'unreachable' | 'link-down';

const NOTICE: Record<
  ConnectionNoticeKind,
  {
    headline: string;
    detail: string;
    Icon: React.ComponentType<{ className?: string }>;
    fatal: boolean;
  }
> = {
  unconfigured: {
    headline: 'No backend configured',
    detail:
      'Connect your ground-station API and telemetry channel in the deployment configuration to receive survey data.',
    Icon: ShieldAlert,
    fatal: true,
  },
  unreachable: {
    headline: 'Backend not responding',
    detail:
      'The ground-station API did not answer. Readings below are the last values received, if any; nothing is being updated.',
    Icon: ShieldAlert,
    fatal: true,
  },
  'link-down': {
    headline: 'Telemetry link down',
    detail:
      'REST reads are working but the realtime channel is disconnected. Live telemetry and new detections will not arrive until it reconnects.',
    Icon: WifiOff,
    fatal: false,
  },
};

export const ConnectionNotice: React.FC<{ kind: ConnectionNoticeKind; className?: string }> = ({
  kind,
  className = '',
}) => {
  const { headline, detail, Icon, fatal } = NOTICE[kind];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex shrink-0 items-center gap-3 rounded-xl border px-3.5 py-2 ${
        fatal ? 'border-critical-border bg-critical-fill' : 'border-warning-border bg-warning-fill'
      } ${className}`}
    >
      <Icon aria-hidden className={`size-4 shrink-0 ${fatal ? 'text-critical' : 'text-warning'}`} />
      <p className="min-w-0 text-[11.5px]">
        <span
          className={`font-mono font-semibold uppercase tracking-[0.12em] ${fatal ? 'text-critical' : 'text-warning'}`}
        >
          {headline}
        </span>
        <span className="mx-2 text-text-muted" aria-hidden>
          ·
        </span>
        <span className="text-text-secondary">{detail}</span>
      </p>
    </div>
  );
};
