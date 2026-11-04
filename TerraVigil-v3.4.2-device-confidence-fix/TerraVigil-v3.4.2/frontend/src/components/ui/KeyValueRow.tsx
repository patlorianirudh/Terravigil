import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export interface KeyValueRowProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: string;
  readonly value: ReactNode;
  /** Render the value in the tabular/mono style (telemetry, coords, IDs). */
  readonly mono?: boolean;
}

/** KeyValueRow — a label/value pair used throughout telemetry and detail views. */
export const KeyValueRow = forwardRef<HTMLDivElement, KeyValueRowProps>(function KeyValueRow(
  { label, value, mono = false, className = '', ...rest },
  ref,
) {
  return (
    <div ref={ref} className={`flex items-baseline justify-between gap-3 ${className}`} {...rest}>
      <dt className="type-label shrink-0">{label}</dt>
      <dd className={`${mono ? 'type-code' : 'text-[13px]'} truncate text-right text-text-primary`}>
        {value}
      </dd>
    </div>
  );
});
