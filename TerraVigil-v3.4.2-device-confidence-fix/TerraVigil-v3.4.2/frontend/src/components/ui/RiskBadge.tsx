import React from 'react';
import type { RiskBand } from '../../domain/types';

interface RiskBadgeProps {
  band: RiskBand | null;
  score?: number | null;
  showScore?: boolean;
  className?: string;
}

/** Stored risk band; the classification badge separately describes confirmation. */
const CONFIG: Record<RiskBand, { label: string; glyph: string; style: string }> = {
  high: {
    label: 'HIGH risk',
    glyph: '▮▮▮',
    style: 'border-risk-high-border bg-risk-high-fill text-risk-high',
  },
  medium: {
    label: 'MEDIUM risk',
    glyph: '▮▮▯',
    style: 'border-risk-medium-border bg-risk-medium-fill text-risk-medium',
  },
  low: {
    label: 'LOW risk',
    glyph: '▮▯▯',
    style: 'border-risk-low-border bg-risk-low-fill text-risk-low',
  },
};

export const RiskBadge: React.FC<RiskBadgeProps> = ({
  band,
  score,
  showScore = true,
  className = '',
}) => {
  if (band === null) return null;
  const item = CONFIG[band];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10.5px] font-medium ${item.style} ${className}`}
    >
      <span aria-hidden className="tracking-[-0.05em]">
        {item.glyph}
      </span>
      <span>{item.label}</span>
      {showScore && score !== undefined && score !== null && (
        <span className="border-current/25 border-l pl-1.5 text-text-secondary">
          {score.toFixed(3)}
        </span>
      )}
    </span>
  );
};
