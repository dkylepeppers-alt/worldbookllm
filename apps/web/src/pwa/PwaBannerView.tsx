import { useEffect } from 'react';

export interface PwaBannerViewProps {
  needRefresh: boolean;
  onReload: () => void;
  onDismissRefresh: () => void;
  offlineReady: boolean;
  onDismissOfflineReady: () => void;
  canInstall: boolean;
  onInstall: () => void;
  onDismissInstall: () => void;
}

/**
 * Presentational-only: every flag is driven by props so it can be exercised
 * in tests without the `virtual:pwa-register/react` module. See
 * PwaStatusBanner for the container that wires this to real browser events.
 */
export function PwaBannerView({
  needRefresh,
  onReload,
  onDismissRefresh,
  offlineReady,
  onDismissOfflineReady,
  canInstall,
  onInstall,
  onDismissInstall,
}: PwaBannerViewProps) {
  if (!needRefresh && !offlineReady && !canInstall) return null;

  return (
    <div className="pwa-banner-stack" aria-live="polite">
      {needRefresh ? (
        <div className="pwa-banner">
          <p className="coordinate-label">Update</p>
          <p>A new version of worldbookllm is ready.</p>
          <div className="pwa-banner-actions">
            <button type="button" className="button-secondary" onClick={onDismissRefresh}>
              Later
            </button>
            <button type="button" className="button-primary" onClick={onReload}>
              Reload
            </button>
          </div>
        </div>
      ) : null}
      {offlineReady ? <OfflineReadyToast onDismiss={onDismissOfflineReady} /> : null}
      {canInstall ? (
        <div className="pwa-banner">
          <p className="coordinate-label">Install</p>
          <p>Add worldbookllm to your device for a full-screen, app-like window.</p>
          <div className="pwa-banner-actions">
            <button type="button" className="button-secondary" onClick={onDismissInstall}>
              Not now
            </button>
            <button type="button" className="button-primary" onClick={onInstall}>
              Install
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OfflineReadyToast({ onDismiss }: { onDismiss: () => void }) {
  // Self-clearing: the parent flips offlineReady to false either from this
  // timeout or an explicit click, either of which un-mounts this toast.
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  return (
    <div className="pwa-banner pwa-banner-quiet">
      <p>worldbookllm is ready to load instantly, even with a flaky connection.</p>
      <button type="button" className="button-secondary" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
