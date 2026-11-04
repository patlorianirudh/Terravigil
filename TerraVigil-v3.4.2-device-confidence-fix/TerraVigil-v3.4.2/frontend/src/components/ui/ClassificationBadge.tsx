import React from 'react';

import type { Classification } from '../../domain/types';
import { CLASSIFICATION_GLYPH, CLASSIFICATION_LABEL } from '../../lib/classification';

interface ClassificationBadgeProps {
  classification: Classification;
  className?: string;
  validationIssue?: string | null;
}

const STYLE: Record<Classification, string> = {
  confirmed: 'border-border-strong bg-surface-elevated/70 text-text-primary',
  unconfirmed_visual: 'border-border-strong bg-surface-elevated/70 text-text-secondary',
  unresolved_metal: 'border-border-strong bg-surface-elevated/70 text-text-secondary',
};

/**
 * Stored confirmation status, independently of risk. The glyph matches the map marker shape
 * (P-20.6), so a badge in a table and a marker on the map are recognisably the
 * same observation.
 */
export const ClassificationBadge: React.FC<ClassificationBadgeProps> = ({
  classification,
  validationIssue,
  className = '',
}) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10.5px] font-medium ${STYLE[classification]} ${className}`}
  >
    <span aria-hidden className="text-[9px]">
      {CLASSIFICATION_GLYPH[classification]}
    </span>
    <span
      title={
        validationIssue ??
        (classification === 'unconfirmed_visual'
          ? 'Camera detection only; no confirmed metal corroboration.'
          : undefined)
      }
    >
      {validationIssue ? 'Stored status · needs validation' : CLASSIFICATION_LABEL[classification]}
    </span>
  </span>
);
