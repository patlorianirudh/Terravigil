import React from 'react';

import { ABSENT } from '../../lib/formatters';

type Tone = 'ok' | 'warning' | 'critical' | 'accent' | 'neutral';

export interface MetricReadoutProps {
  readonly label: string;
  /** Already formatted. Pass a formatter result; `—` means "not reported". */
  readonly value: string;
  readonly unit?: string;
  readonly footnote?: string;
  readonly tone?: Tone;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
}

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warning: 'text-warning',
  critical: 'text-critical',
  accent: 'text-accent-bright',
  neutral: 'text-text-primary',
};

const SIZE_CLASS = { sm: 'type-readout-sm', md: 'type-readout', lg: 'type-readout-xl' } as const;

/**
 * One instrument reading. Deliberately NOT glass: opaque well, full-contrast
 * digits, no blur behind a number an operator may act on. A value of `—` is
 * muted so a missing measurement cannot pass for a real one at a glance.
 */
export const MetricReadout: React.FC<MetricReadoutProps> = ({
  label,
  value,
  unit,
  footnote,
  tone = 'neutral',
  size = 'md',
  className = '',
}) => {
  const absent = value === ABSENT;

  return (
    <div className={`metric-readout ${className}`}>
      <div className="type-label truncate text-text-muted">{label}</div>

      <div className="metric-value">
        <span className={`${SIZE_CLASS[size]} ${absent ? 'text-text-muted' : TONE_TEXT[tone]}`}>
          {value}
        </span>
        {unit !== undefined && !absent && (
          <span className="font-mono text-[11px] text-text-secondary">{unit}</span>
        )}
      </div>

      {footnote !== undefined && <div className="metric-footnote">{footnote}</div>}
    </div>
  );
};
