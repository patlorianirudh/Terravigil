import { forwardRef, type HTMLAttributes } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: 'neutral' | 'accent';
}

/** Badge — a neutral or accent label chip (not a status indicator). */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', className = '', children, ...rest },
  ref,
) {
  const toneClass =
    tone === 'accent'
      ? 'border-accent/40 bg-accent/10 text-accent'
      : 'border-border bg-surface-elevated text-text-secondary';
  return (
    <span
      ref={ref}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium ${toneClass} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
});
