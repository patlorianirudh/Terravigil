import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

/**
 * Press feedback is a 90 ms scale — short enough to feel like the button
 * responded rather than animated. Every variant keeps a ≥32px hit box at `sm`
 * and ≥40px at `md`, so the same component works under a thumb.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, children, className = '', ...props },
  ref,
) {
  const base = [
    'group/btn inline-flex items-center justify-center gap-2 rounded-md font-medium',
    'transition-[opacity,transform] duration-hover ease-out',
    'active:scale-[0.99] active:duration-tap',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' ');

  const sizes = {
    sm: 'min-h-[32px] px-2.5 py-1 text-[11.5px]',
    md: 'min-h-[40px] px-3.5 py-1.5 text-[12.5px]',
    lg: 'min-h-[44px] px-5 py-2.5 text-[13px]',
  }[size];

  const variants = {
    // A single solid accent identifies the primary action.
    primary: 'border border-accent bg-accent text-background hover:bg-accent-bright',
    secondary:
      'border border-border bg-surface-elevated text-text-primary hover:border-border-control hover:bg-surface-hover',
    danger:
      'border border-critical-border bg-critical-fill text-critical hover:border-critical hover:bg-critical/20',
    ghost:
      'border border-transparent text-text-secondary hover:bg-surface-hover/70 hover:text-text-primary',
  }[variant];

  return (
    <button ref={ref} className={`${base} ${sizes} ${variants} ${className}`} {...props}>
      {icon !== undefined && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
});
