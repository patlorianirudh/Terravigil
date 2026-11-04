import React from 'react';

import { fmtScore } from '../../lib/formatters';

interface ConfidenceLedgerProps {
  /** [0,1], or null when the reading was not reported. */
  visualConfidence: number | null;
  /** [0,1], or null when the reading was not reported. */
  metalSignalNorm: number | null;
  /** Session thresholds. Null when the session did not report them. */
  visualThreshold?: number | null;
  metalThreshold?: number | null;
  corroborationCount?: number | null;
  compact?: boolean;
  className?: string;
}

interface LedgerRowProps {
  sensor: string;
  sensorName: string;
  value: number | null;
  threshold: number | null;
  barClass: string;
}

/** One reported sensor reading against its reported threshold; missing readings stay unknown. */
const LedgerRow: React.FC<LedgerRowProps> = ({
  sensor,
  sensorName,
  value,
  threshold,
  barClass,
}) => {
  const reported = value !== null;
  const meetsThreshold = reported && threshold !== null && value >= threshold;
  const label = reported
    ? `${sensorName} ${fmtScore(value)}${threshold === null ? '' : meetsThreshold ? ', at or above threshold' : ', below threshold'}`
    : `${sensorName}: reading unreported`;

  return (
    <div className="flex items-center gap-2" role="img" aria-label={label}>
      <span className="w-7 shrink-0 font-mono text-[10px] font-semibold uppercase text-text-muted">
        {sensor}
      </span>

      <div className="relative h-2.5 flex-1 overflow-hidden rounded-[1px] border border-border bg-surface-sunken">
        {reported ? (
          <div
            className={`h-full ${meetsThreshold ? barClass : 'bg-border-control'}`}
            style={{ width: `${String(Math.min(100, Math.max(1.5, value * 100)))}%` }}
          />
        ) : (
          <div className="ledger-no-pass h-full w-full" />
        )}

        {threshold !== null && (
          <div
            className="absolute inset-y-0 w-[1.5px] bg-text-primary"
            style={{ left: `${String(threshold * 100)}%` }}
            title={`Threshold ${fmtScore(threshold)}`}
          />
        )}
      </div>

      <span
        className={`w-11 shrink-0 text-right font-mono text-[11px] tabular-nums ${
          reported ? 'text-text-primary' : 'text-text-muted'
        }`}
      >
        {fmtScore(value)}
      </span>
    </div>
  );
};

export const ConfidenceLedger: React.FC<ConfidenceLedgerProps> = ({
  visualConfidence,
  metalSignalNorm,
  visualThreshold = null,
  metalThreshold = null,
  corroborationCount,
  compact = false,
  className = '',
}) => {
  return (
    <div className={`space-y-1 ${className}`}>
      <LedgerRow
        sensor="vis"
        sensorName="Visual confidence"
        value={visualConfidence}
        threshold={visualThreshold}
        barClass="bg-accent"
      />
      <LedgerRow
        sensor="mtl"
        sensorName="Metal signal"
        value={metalSignalNorm}
        threshold={metalThreshold}
        barClass="bg-ok"
      />

      {!compact &&
        corroborationCount !== null &&
        corroborationCount !== undefined &&
        corroborationCount > 1 && (
          <div className="pt-0.5 text-right font-mono text-[10px] text-text-muted">
            {corroborationCount} independent observations
          </div>
        )}
    </div>
  );
};
