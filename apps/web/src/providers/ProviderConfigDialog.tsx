import type { ProviderCatalogEntry, ProviderConfig } from '@worldbookllm/shared';
import { useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { ProviderConfigEditor } from './ProviderConfigEditor.js';

interface ProviderConfigDialogProps {
  title: string;
  initial: ProviderConfig | null;
  clearLabel?: string;
  onClose: () => void;
  onSave: (config: ProviderConfig) => Promise<void>;
  onClear?: () => Promise<void>;
}

export function ProviderConfigDialog({
  title,
  initial,
  clearLabel,
  onClose,
  onSave,
  onClear,
}: ProviderConfigDialogProps) {
  const api = useApi();
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useDialogLifecycle(cancelRef, () => {
    if (!saving) onClose();
  });

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setLoadError(false);
    void api
      .getProviderCatalog(controller.signal)
      .then(setCatalog)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setLoadError(true);
      });
    return () => controller.abort();
  }, [api, reloadKey]);

  async function save(config: ProviderConfig) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(config);
      onClose();
    } catch (error) {
      setSaveError(messageFor(error, 'Could not save provider settings.'));
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (saving || onClear === undefined) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onClear();
      onClose();
    } catch (error) {
      setSaveError(messageFor(error, 'Could not clear provider settings.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-dialog-title"
      >
        <p className="coordinate-label">Provider configuration</p>
        <h2 id="provider-dialog-title">{title}</h2>
        {catalog === null && !loadError ? <LoadingState>Loading providers…</LoadingState> : null}
        {loadError ? (
          <ErrorState
            title="Could not load providers"
            message="The provider catalog could not be loaded."
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        ) : null}
        {catalog === null ? null : (
          <ProviderConfigEditor
            catalog={catalog}
            initial={initial}
            busy={saving}
            onSubmit={save}
          />
        )}
        {saveError === null ? null : <p role="alert">{saveError}</p>}
        <div className="dialog-actions provider-dialog-actions">
          {onClear === undefined ? null : (
            <button
              type="button"
              className="button-secondary"
              disabled={saving}
              onClick={() => void clear()}
            >
              {clearLabel ?? 'Clear provider'}
            </button>
          )}
          <button
            ref={cancelRef}
            type="button"
            className="button-secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
