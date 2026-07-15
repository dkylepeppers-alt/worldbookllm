import { useRegisterSW } from 'virtual:pwa-register/react';

import { PwaBannerView } from './PwaBannerView.js';
import { useInstallPrompt } from './useInstallPrompt.js';

/**
 * Mounted once at the app root. Wires the service-worker update lifecycle
 * (registerType: 'prompt' — see vite.config.ts) and the install-prompt
 * capture to the presentational PwaBannerView.
 */
export function PwaStatusBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  const { canInstall, promptInstall, dismiss: dismissInstall } = useInstallPrompt();

  return (
    <PwaBannerView
      needRefresh={needRefresh}
      onReload={() => void updateServiceWorker(true)}
      onDismissRefresh={() => setNeedRefresh(false)}
      offlineReady={offlineReady}
      onDismissOfflineReady={() => setOfflineReady(false)}
      canInstall={canInstall}
      onInstall={() => void promptInstall()}
      onDismissInstall={dismissInstall}
    />
  );
}
