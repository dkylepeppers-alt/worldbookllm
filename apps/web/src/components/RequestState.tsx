interface LoadingStateProps {
  children: React.ReactNode;
}

export function LoadingState({ children }: LoadingStateProps) {
  return (
    <div className="request-state" role="status">
      <span className="survey-pulse" aria-hidden="true" />
      {children}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title, message, onRetry }: ErrorStateProps) {
  return (
    <section className="request-state request-error" role="alert">
      <p className="coordinate-label">Route interrupted</p>
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry === undefined ? null : (
        <button type="button" className="button-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}
