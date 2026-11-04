import { forwardRef, type HTMLAttributes } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly heading?: string;
}

/** Card — a smaller contained surface, typically nested inside a Panel. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { heading, className = '', children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`rounded border border-border bg-surface-elevated p-3 ${className}`}
      {...rest}
    >
      {heading !== undefined && <h3 className="type-card-heading mb-2">{heading}</h3>}
      {children}
    </div>
  );
});
