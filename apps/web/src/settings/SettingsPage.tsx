import type { MaskedSecret, ProviderCatalogEntry, SecretState } from '@worldbookllm/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';

type SettingsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; catalog: ProviderCatalogEntry[]; secrets: SecretState };

interface SecretTarget {
  provider: ProviderCatalogEntry;
  secret: MaskedSecret;
}

export function SettingsPage() {
  const api = useApi();
  const [state, setState] = useState<SettingsState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState<ProviderCatalogEntry | null>(null);
  const [deleting, setDeleting] = useState<SecretTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => Promise.all([api.getProviderCatalog(signal), api.getSecrets(signal)]),
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .then(([catalog, secrets]) => setState({ status: 'ready', catalog, secrets }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [load, reloadKey]);

  async function refresh() {
    try {
      const [catalog, secrets] = await load();
      setState({ status: 'ready', catalog, secrets });
    } catch {
      setState({ status: 'error' });
    }
  }

  async function activate(provider: ProviderCatalogEntry, secret: MaskedSecret) {
    setBusyId(secret.id);
    setMutationError(null);
    try {
      await api.activateSecret(provider.secretKey, secret.id);
    } catch (error) {
      setMutationError(messageFor(error, 'Could not activate this key.'));
      setBusyId(null);
      return;
    }
    await refresh();
    setBusyId(null);
  }

  async function removeSecret() {
    if (deleting === null || busyId !== null) return;
    setBusyId(deleting.secret.id);
    setMutationError(null);
    try {
      await api.deleteSecret(deleting.provider.secretKey, deleting.secret.id);
    } catch (error) {
      setDeleting(null);
      setMutationError(messageFor(error, 'Could not delete this key.'));
      setBusyId(null);
      return;
    }
    setDeleting(null);
    await refresh();
    setBusyId(null);
  }

  if (state.status === 'loading') return <LoadingState>Loading provider settings…</LoadingState>;
  if (state.status === 'error') {
    return (
      <ErrorState
        title="Could not load provider settings"
        message="The provider catalog or masked key state could not be loaded."
        onRetry={() => {
          setState({ status: 'loading' });
          setReloadKey((value) => value + 1);
        }}
      />
    );
  }

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <header className="page-intro">
        <p className="coordinate-label">Provider registry · local secrets</p>
        <h1 id="settings-title">Provider settings</h1>
        <p>Manage masked API keys. Key values remain on this machine and are never shown again.</p>
      </header>

      {mutationError === null ? null : <p role="alert">{mutationError}</p>}
      <div className="provider-settings-list">
        {state.catalog.map((provider) => {
          const secrets = state.secrets[provider.secretKey] ?? [];
          return (
            <section className="provider-settings-card" key={provider.source}>
              <header className="provider-settings-header">
                <div>
                  <p className="coordinate-label">{provider.family}</p>
                  <h2>{provider.label}</h2>
                </div>
                <span className={provider.hasSecret ? 'status-ready' : 'status-muted'}>
                  {provider.hasSecret
                    ? 'Configured'
                    : provider.keyOptional
                      ? 'Key optional'
                      : 'No key'}
                </span>
              </header>
              {provider.keyOptional ? (
                <p className="provider-note">This provider can be used without a key.</p>
              ) : null}
              {secrets.length === 0 ? (
                <p className="empty-inline">No stored keys.</p>
              ) : (
                <ul className="secret-list">
                  {secrets.map((secret) => (
                    <li key={secret.id}>
                      <div>
                        <strong>{secret.label}</strong>
                        <code>{secret.value}</code>
                      </div>
                      <div className="inline-actions">
                        {secret.active ? (
                          <span className="active-marker">Active</span>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => void activate(provider, secret)}
                          >
                            Make active
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-danger"
                          aria-label={`Delete ${secret.label} for ${provider.label}`}
                          disabled={busyId !== null}
                          onClick={() => setDeleting({ provider, secret })}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="button-secondary"
                onClick={() => setAdding(provider)}
              >
                Add key
              </button>
            </section>
          );
        })}
      </div>

      {adding === null ? null : (
        <AddSecretDialog
          provider={adding}
          onClose={() => setAdding(null)}
          onCreated={async () => {
            setAdding(null);
            await refresh();
          }}
        />
      )}
      {deleting === null ? null : (
        <ConfirmDialog
          title="Delete provider key?"
          confirmLabel="Delete key"
          busy={busyId !== null}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void removeSecret()}
        >
          <p>
            Delete <strong>{deleting.secret.label}</strong> for {deleting.provider.label}? This
            cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

interface AddSecretDialogProps {
  provider: ProviderCatalogEntry;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

function AddSecretDialog({ provider, onClose, onCreated }: AddSecretDialogProps) {
  const api = useApi();
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  useDialogLifecycle(labelRef, () => {
    if (!saving) {
      setValue('');
      onClose();
    }
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (value.length === 0) {
      setError('Enter a key value.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createSecret({
        key: provider.secretKey,
        value,
        ...(label.trim().length === 0 ? {} : { label: label.trim() }),
      });
      setValue('');
      await onCreated();
    } catch (caught) {
      setError(messageFor(caught, 'Could not save this key.'));
    } finally {
      setValue('');
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-secret-title"
      >
        <p className="coordinate-label">Write-only secret · {provider.label}</p>
        <h2 id="add-secret-title">Add provider key</h2>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="secret-label">Label (optional)</label>
          <input
            ref={labelRef}
            id="secret-label"
            maxLength={200}
            value={label}
            disabled={saving}
            onChange={(event) => setLabel(event.target.value)}
          />
          <label htmlFor="secret-value">Key value</label>
          <input
            id="secret-value"
            type="password"
            maxLength={65_536}
            autoComplete="off"
            value={value}
            disabled={saving}
            onChange={(event) => setValue(event.target.value)}
          />
          {error === null ? null : <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save key'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
