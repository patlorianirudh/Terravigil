import type { ReactNode } from 'react';
export interface PageHeaderProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly className?: string;
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <header className={`app-page-header ${className}`}>
      <div className="min-w-0">
        <p className="type-eyebrow">{eyebrow}</p>
        <h1 className="type-page-title">{title}</h1>
        {description && <p className="type-metadata">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
