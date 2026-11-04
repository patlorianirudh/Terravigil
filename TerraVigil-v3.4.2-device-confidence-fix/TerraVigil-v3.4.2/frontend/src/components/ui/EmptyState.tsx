import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly action?: ReactNode;
}

/**
 * An empty panel is an invitation, not an apology. It says what will appear
 * here and what makes it appear — never "no data".
 */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { title, description, icon, action, className = '', ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`flex h-full min-h-[132px] flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border bg-surface-sunken/40 p-5 text-center ${className}`}
      {...rest}
    >
      <span className="grid size-9 place-items-center rounded-lg border border-border bg-surface-elevated/60 text-text-muted">
        {icon ?? <Inbox className="size-4" strokeWidth={1.75} />}
      </span>
      <p className="type-card-heading text-text-secondary">{title}</p>
      {description !== undefined && <p className="type-metadata max-w-[46ch]">{description}</p>}
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
});
