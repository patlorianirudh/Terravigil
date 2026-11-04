import React from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, Info, OctagonAlert } from 'lucide-react';

export type StatusLevel = 'ok' | 'warning' | 'critical' | 'offline' | 'info';

interface StatusDotProps {
  status: StatusLevel;
  pulse?: boolean;
  className?: string;
}

const DOT_CLASS: Record<StatusLevel, string> = {
  ok: 'bg-ok',
  warning: 'bg-warning',
  critical: 'bg-critical',
  offline: 'bg-offline',
  info: 'bg-info',
};

export const StatusDot: React.FC<StatusDotProps> = ({ status, pulse = false, className = '' }) => (
  <span className={`relative flex size-2 shrink-0 ${className}`}>
    {pulse && (
      <span
        aria-hidden
        className={`absolute inset-0 animate-live-ping rounded-full ${DOT_CLASS[status]}`}
      />
    )}
    <span className={`relative size-2 rounded-full ${DOT_CLASS[status]}`} />
  </span>
);

interface StatusBadgeProps {
  status: StatusLevel;
  label?: string;
  className?: string;
}

/**
 * Status carries an icon as well as a colour (P-20.12 / WCAG 1.4.1): the shape
 * is what a colour-blind operator reads, and the colour is the shortcut for
 * everyone else.
 */
const PRESENTATION: Record<
  StatusLevel,
  { style: string; label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  ok: { style: 'border-ok-border bg-ok-fill text-ok', label: 'Nominal', Icon: CheckCircle2 },
  warning: {
    style: 'border-warning-border bg-warning-fill text-warning',
    label: 'Degraded',
    Icon: AlertTriangle,
  },
  critical: {
    style: 'border-critical-border bg-critical-fill text-critical',
    label: 'Fault',
    Icon: OctagonAlert,
  },
  offline: {
    style: 'border-offline-border bg-offline-fill text-offline',
    label: 'Offline',
    Icon: CircleSlash,
  },
  info: { style: 'border-info-border bg-info-fill text-info', label: 'Info', Icon: Info },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  const { style, label: fallback, Icon } = PRESENTATION[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10.5px] font-medium ${style} ${className}`}
    >
      <Icon aria-hidden className="size-3" />
      <span>{label ?? fallback}</span>
    </span>
  );
};
