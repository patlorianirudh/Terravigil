import React from 'react';

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Corner brackets (§20.4 signature 3). Instrument panes only. */
  reticle?: boolean;
  /**
   * `glass` — chrome: a translucent sheet over the ambient field. Default.
   * `instrument` — opaque well, for anything an operator reads a number off.
   */
  surface?: 'glass' | 'instrument' | 'solid';
  title?: string;
  headerRight?: React.ReactNode;
  /** Drop the body padding, for panes that fill edge to edge (maps, tables). */
  flush?: boolean;
}

const SURFACE_CLASS = {
  glass: '',
  instrument: 'instrument',
  solid: '',
} as const;

export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(function Panel(
  {
    reticle = false,
    surface = 'solid',
    title,
    headerRight,
    flush = false,
    className = '',
    children,
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`panel relative ${SURFACE_CLASS[surface]} ${reticle ? 'reticle-frame' : ''} ${className}`}
      {...props}
    >
      {title !== undefined && (
        <div className="panel-heading">
          <h2 className="type-section-heading truncate">{title}</h2>
          {headerRight !== undefined && <div className="shrink-0">{headerRight}</div>}
        </div>
      )}
      <div className={flush ? 'panel-flush' : 'panel-body'}>{children}</div>
      {reticle && <span className="reticle-corner-b" aria-hidden />}
    </div>
  );
});
