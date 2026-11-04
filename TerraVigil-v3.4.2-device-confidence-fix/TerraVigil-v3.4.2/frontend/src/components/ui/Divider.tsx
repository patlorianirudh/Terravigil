import { forwardRef, type HTMLAttributes } from 'react';

export interface DividerProps extends HTMLAttributes<HTMLHRElement> {
  readonly orientation?: 'horizontal' | 'vertical';
}

/** Divider — a hairline separator using the border token. */
export const Divider = forwardRef<HTMLHRElement, DividerProps>(function Divider(
  { orientation = 'horizontal', className = '', ...rest },
  ref,
) {
  const cls = orientation === 'horizontal' ? 'h-px w-full border-t' : 'w-px self-stretch border-l';
  return (
    <hr
      ref={ref}
      aria-orientation={orientation}
      className={`border-0 border-border ${cls} ${className}`}
      {...rest}
    />
  );
});
