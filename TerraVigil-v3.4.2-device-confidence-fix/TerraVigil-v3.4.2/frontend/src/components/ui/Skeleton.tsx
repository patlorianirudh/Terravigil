import { forwardRef, type HTMLAttributes } from 'react';

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Loading placeholder. The sweep is a single translucent band, not a pulsing
 * block: it reserves the exact space the content will take (so nothing shifts
 * when data lands) and reads as "in flight" rather than as content. Disabled
 * under `prefers-reduced-motion` by the global rule.
 */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { className = '', ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-hidden
      className={`relative overflow-hidden rounded-lg border border-border/60 bg-surface-elevated/40 ${className}`}
      {...rest}
    >
      <span className="absolute inset-y-0 -left-full w-full animate-shimmer bg-gradient-to-r from-transparent via-surface-hover/70 to-transparent" />
    </div>
  );
});
