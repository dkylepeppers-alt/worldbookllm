import {
  providerConfigSchema,
  providerConnectionSchema,
  type ModelInfo,
  type ProviderCatalogEntry,
  type ProviderConfig,
  type ProviderConnection,
  type ProviderSource,
} from '@worldbookllm/shared';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';

interface ProviderConfigEditorProps {
  catalog: ProviderCatalogEntry[];
  initial: ProviderConfig | null;
  submitLabel?: string;
  busy?: boolean;
  onSubmit: (config: ProviderConfig) => void | Promise<void>;
}

export function ProviderConfigEditor({
  catalog,
  initial,
  submitLabel = 'Save provider',
  busy = false,
  onSubmit,
}: ProviderConfigEditorProps) {
  const api = useApi();
  const [source, setSource] = useState<ProviderSource | ''>(initial?.source ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [extra, setExtra] = useState<Record<string, string>>(() => initialExtra(initial));
  const [model, setModel] = useState(initial?.model ?? '');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const modelController = useRef<AbortController | null>(null);
  const testController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      modelController.current?.abort();
      testController.current?.abort();
    },
    [],
  );

  const provider = useMemo(
    () => catalog.find((entry) => entry.source === source) ?? null,
    [catalog, source],
  );
  const connection = provider === null ? null : buildConnection(provider, baseUrl, extra);
  const config = connection === null ? null : buildConfig(connection, model);
  const connectionReady =
    provider !== null &&
    (!provider.needsBaseUrl || baseUrl.trim().length > 0) &&
    (provider.extraFields ?? []).every(
      (field) => !field.required || (extra[field.key] ?? '').trim().length > 0,
    );
  const configReady = connectionReady && config !== null;

  function changeProvider(next: string) {
    modelController.current?.abort();
    testController.current?.abort();
    setSource(next as ProviderSource | '');
    setBaseUrl('');
    setExtra({});
    setModel('');
    setModels(null);
    setModelError(null);
    setTestResult(null);
    setFormError(null);
  }

  async function loadModels() {
    if (connection === null || !connectionReady || loadingModels) {
      setModelError('Complete the provider connection fields first.');
      return;
    }
    modelController.current?.abort();
    const controller = new AbortController();
    modelController.current = controller;
    setLoadingModels(true);
    setModelError(null);
    try {
      const response = await api.listModels(connection, controller.signal);
      setModels(response.models.length === 0 ? null : response.models);
      if (response.models.length > 0 && !response.models.some((item) => item.id === model)) {
        setModel(response.models[0]?.id ?? '');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setModels(null);
        setModelError(messageFor(error, 'Could not load models. Enter a model manually.'));
      }
    } finally {
      if (modelController.current === controller) {
        modelController.current = null;
        setLoadingModels(false);
      }
    }
  }

  async function test() {
    if (config === null || !configReady || testing) return;
    testController.current?.abort();
    const controller = new AbortController();
    testController.current = controller;
    setTesting(true);
    setTestResult(null);
    try {
      const response = await api.testConnection(config, controller.signal);
      setTestResult({ ok: true, message: response.detail });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setTestResult({ ok: false, message: messageFor(error, 'Connection test failed.') });
      }
    } finally {
      if (testController.current === controller) {
        testController.current = null;
        setTesting(false);
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = providerConfigSchema.safeParse(config);
    if (!parsed.success || !connectionReady) {
      setFormError('Complete the provider, connection fields, and model.');
      return;
    }
    setFormError(null);
    await onSubmit(parsed.data);
  }

  return (
    <form className="provider-config-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="provider-source">Provider</label>
      <select
        id="provider-source"
        value={source}
        disabled={busy}
        onChange={(event) => changeProvider(event.target.value)}
      >
        <option value="">Select a provider</option>
        {catalog.map((entry) => (
          <option key={entry.source} value={entry.source}>
            {entry.label}
          </option>
        ))}
      </select>

      {provider === null ? null : (
        <>
          <p
            className={provider.hasSecret || provider.keyOptional ? 'status-ready' : 'status-muted'}
          >
            {provider.hasSecret
              ? 'Provider key configured.'
              : provider.keyOptional
                ? 'A provider key is optional.'
                : 'No provider key configured.'}
            {!provider.hasSecret && !provider.keyOptional ? (
              <>
                {' '}
                <Link to="/settings">Manage keys</Link>
              </>
            ) : null}
          </p>

          {provider.needsBaseUrl ? (
            <>
              <label htmlFor="provider-base-url">Base URL</label>
              <input
                id="provider-base-url"
                type="url"
                required
                maxLength={2048}
                value={baseUrl}
                disabled={busy}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </>
          ) : null}

          {(provider.extraFields ?? []).map((field) => {
            const options =
              provider.source === 'vertexai' && field.key === 'authMode'
                ? field.options?.filter((option) => option !== 'full')
                : field.options;
            return (
              <div className="provider-extra-field" key={field.key}>
                <label htmlFor={`provider-extra-${field.key}`}>{field.label}</label>
                {options === undefined ? (
                  <input
                    id={`provider-extra-${field.key}`}
                    required={field.required}
                    value={extra[field.key] ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      setExtra((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                ) : (
                  <select
                    id={`provider-extra-${field.key}`}
                    required={field.required}
                    value={extra[field.key] ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      setExtra((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  >
                    <option value="">Select {field.label.toLowerCase()}</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}

          <div className="model-field">
            <label htmlFor="provider-model">Model</label>
            <div className="field-action">
              {models === null ? (
                <input
                  id="provider-model"
                  required
                  maxLength={256}
                  value={model}
                  disabled={busy}
                  onChange={(event) => setModel(event.target.value)}
                />
              ) : (
                <select
                  id="provider-model"
                  required
                  value={model}
                  disabled={busy}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name === undefined ? item.id : `${item.name} (${item.id})`}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="button-secondary"
                disabled={busy || loadingModels || !connectionReady}
                onClick={() => void loadModels()}
              >
                {loadingModels ? 'Loading…' : 'Load models'}
              </button>
            </div>
          </div>
          {modelError === null ? null : <p role="alert">{modelError}</p>}

          <div className="connection-test">
            <button
              type="button"
              className="button-secondary"
              disabled={busy || testing || !configReady}
              onClick={() => void test()}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {testResult === null ? null : (
              <p className={testResult.ok ? 'status-ready' : 'status-error'} role="status">
                {testResult.message}
              </p>
            )}
          </div>
        </>
      )}

      {formError === null ? null : <p role="alert">{formError}</p>}
      <button type="submit" className="button-primary" disabled={busy || !configReady}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

function initialExtra(initial: ProviderConfig | null): Record<string, string> {
  if (initial?.extra === undefined) return {};
  return Object.fromEntries(
    Object.entries(initial.extra).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
}

function buildConnection(
  provider: ProviderCatalogEntry,
  baseUrl: string,
  values: Record<string, string>,
): ProviderConnection | null {
  const extra = Object.fromEntries(
    (provider.extraFields ?? [])
      .map((field) => [field.key, values[field.key]?.trim() ?? ''] as const)
      .filter(([, value]) => value.length > 0),
  );
  const candidate = {
    source: provider.source,
    ...(baseUrl.trim().length === 0 ? {} : { baseUrl: baseUrl.trim() }),
    ...(Object.keys(extra).length === 0 ? {} : { extra }),
  };
  const parsed = providerConnectionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function buildConfig(connection: ProviderConnection, model: string): ProviderConfig | null {
  const parsed = providerConfigSchema.safeParse({ ...connection, model });
  return parsed.success ? parsed.data : null;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
