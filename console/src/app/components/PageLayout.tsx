import type { ReactNode } from "react";

interface PageLayoutProps {
  /**
   * title / subtitle / badge are accepted for call-site compatibility and to
   * feed the top breadcrumb's source, but are NO LONGER rendered as an in-page
   * header — the page identity already lives in the top breadcrumb bar, so the
   * duplicated title block was removed (reclaims vertical space; matches the
   * ~1100×800 target). `actions`, if provided, still render as a slim bar.
   */
  title: string;
  subtitle?: string;
  badge?: string;
  badgeVariant?: "neutral" | "success" | "warning" | "danger";
  actions?: ReactNode;
  children: ReactNode;
}

export function PageLayout({ actions, children }: PageLayoutProps) {
  return (
    <div className="page-layout">
      {actions && <div className="page-header page-header--actions-only">{actions}</div>}
      <div className="page-body">{children}</div>
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

interface PlaceholderCardProps {
  label: string;
  note?: string;
}

export function PlaceholderCard({ label, note }: PlaceholderCardProps) {
  return (
    <div className="placeholder-card">
      <span className="placeholder-card-label">{label}</span>
      {note && <span className="placeholder-card-note">{note}</span>}
    </div>
  );
}
