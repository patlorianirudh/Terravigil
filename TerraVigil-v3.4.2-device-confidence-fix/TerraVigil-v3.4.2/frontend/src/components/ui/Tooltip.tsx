import { forwardRef, type HTMLAttributes, type ReactNode, useId, useState } from 'react';

export interface TooltipProps extends Omit<HTMLAttributes<HTMLDivElement>, 'content'> {
  readonly content: ReactNode;
  readonly children: ReactNode;
}

/**
 * Tooltip — minimal hover/focus tooltip. Renders content in an elevated
 * surface with a border; associated via aria-describedby for accessibility.
 */
export const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(function Tooltip(
  { content, children, className = '', ...rest },
  ref,
) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div
      ref={ref}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
      onFocus={() => {
        setOpen(true);
      }}
      onBlur={() => {
        setOpen(false);
      }}
      aria-describedby={open ? id : undefined}
      {...rest}
    >
      {children}
      {open && (
        <div
          id={id}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded border border-border-strong bg-surface-elevated px-2 py-1 text-[11px] text-text-primary"
        >
          {content}
        </div>
      )}
    </div>
  );
});
