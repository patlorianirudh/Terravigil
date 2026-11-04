import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name is required on icon-only buttons. */
  readonly 'aria-label': string;
  readonly icon: ReactNode;
}

/** IconButton — icon-only action with a mandatory accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, className = '', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={`inline-flex size-7 items-center justify-center rounded border border-transparent text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
});
