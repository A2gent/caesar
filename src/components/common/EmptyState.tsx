interface EmptyStateProps {
  children: React.ReactNode;
  className?: string;
}

export function EmptyState({ children, className = '' }: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`.trim()}>
      {children}
    </div>
  );
}

interface EmptyStateTitleProps {
  children: React.ReactNode;
}

export function EmptyStateTitle({ children }: EmptyStateTitleProps) {
  return <p className="empty-state-title">{children}</p>;
}

interface EmptyStateHintProps {
  children: React.ReactNode;
}

export function EmptyStateHint({ children }: EmptyStateHintProps) {
  return <p className="empty-state-hint">{children}</p>;
}
