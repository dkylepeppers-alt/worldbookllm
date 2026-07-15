import type { Chat, Preset } from '@worldbookllm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';

type LibraryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; presets: Preset[]; defaultId: string };

interface PresetControlsProps {
  chat: Chat;
  onChatUpdated: (chat: Chat) => void;
  onTemperatureSavingChange: (saving: boolean) => void;
}

export function PresetControls({
  chat,
  onChatUpdated,
  onTemperatureSavingChange,
}: PresetControlsProps) {
  const api = useApi();
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [savingTemperature, setSavingTemperature] = useState(false);
  const [draftTemperature, setDraftTemperature] = useState<{
    presetId: string;
    value: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutationRef = useRef(false);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const [presets, settings] = await Promise.all([
        api.listPresets(signal),
        api.getAppSettings(signal),
      ]);
      return { presets, defaultId: settings.defaultPresetId };
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(
      ({ presets, defaultId }) => setLibrary({ status: 'ready', presets, defaultId }),
      (caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          setLibrary({ status: 'error' });
        }
      },
    );
    return () => controller.abort();
  }, [load, reloadKey]);

  useEffect(
    () => () => {
      onTemperatureSavingChange(false);
    },
    [onTemperatureSavingChange],
  );

  if (library.status === 'loading') {
    return <p className="preset-controls-status">Loading preset controls…</p>;
  }

  if (library.status === 'error') {
    return (
      <div className="preset-controls-status" role="alert">
        <p>Could not load preset controls.</p>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setError(null);
            setLibrary({ status: 'loading' });
            setReloadKey((value) => value + 1);
          }}
        >
          Retry preset controls
        </button>
      </div>
    );
  }

  const defaultPreset = library.presets.find((preset) => preset.id === library.defaultId);
  const activeId = chat.presetId ?? library.defaultId;
  const active = library.presets.find((preset) => preset.id === activeId);

  if (defaultPreset === undefined || active === undefined) {
    return (
      <div className="preset-controls-status" role="alert">
        <p>The active preset is unavailable. Reload the preset library.</p>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setError(null);
            setLibrary({ status: 'loading' });
            setReloadKey((value) => value + 1);
          }}
        >
          Retry preset controls
        </button>
      </div>
    );
  }

  const activePreset = active;
  const temperature =
    draftTemperature?.presetId === activePreset.id
      ? draftTemperature.value
      : activePreset.generation.temperature;
  const controlsBusy = selecting || savingTemperature;

  async function selectPreset(value: string) {
    const presetId = value === '' ? null : value;
    if (mutationRef.current || presetId === chat.presetId) return;
    mutationRef.current = true;
    setSelecting(true);
    setError(null);
    try {
      onChatUpdated(await api.updateChat(chat.id, { presetId }));
    } catch (caught) {
      setError(messageFor(caught, 'Could not update this chat preset.'));
    } finally {
      mutationRef.current = false;
      setSelecting(false);
    }
  }

  async function saveTemperature(value: number) {
    if (mutationRef.current || value === activePreset.generation.temperature) return;
    mutationRef.current = true;
    setDraftTemperature({ presetId: activePreset.id, value });
    setSavingTemperature(true);
    onTemperatureSavingChange(true);
    setError(null);
    try {
      const updated = await api.updatePreset(activePreset.id, {
        generation: { ...activePreset.generation, temperature: value },
      });
      setLibrary((current) =>
        current.status === 'ready'
          ? {
              ...current,
              presets: current.presets.map((preset) =>
                preset.id === updated.id ? updated : preset,
              ),
            }
          : current,
      );
    } catch (caught) {
      setError(messageFor(caught, 'Could not save the temperature.'));
    } finally {
      mutationRef.current = false;
      setDraftTemperature(null);
      setSavingTemperature(false);
      onTemperatureSavingChange(false);
    }
  }

  return (
    <section className="preset-controls" aria-label="Preset controls">
      <div className="preset-control-heading">
        <div>
          <p className="coordinate-label">Active preset</p>
          <strong>Active preset: {activePreset.name}</strong>
        </div>
        <small>
          {chat.presetId === null ? 'Inherited from global default' : 'Explicit chat preset'}
        </small>
      </div>

      <label htmlFor="chat-preset">Chat preset</label>
      <select
        id="chat-preset"
        value={chat.presetId ?? ''}
        disabled={controlsBusy}
        onChange={(event) => void selectPreset(event.target.value)}
      >
        <option value="">Inherit global default — {defaultPreset.name}</option>
        {library.presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>

      <div className="temperature-control">
        <div className="temperature-label">
          <label htmlFor="chat-temperature">Temperature</label>
          <output htmlFor="chat-temperature">{temperature}</output>
        </div>
        <input
          id="chat-temperature"
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={temperature}
          disabled={controlsBusy}
          onChange={(event) => void saveTemperature(Number(event.target.value))}
        />
        <p>
          This edits the shared global preset for every chat using it. Changes apply to future
          generations only.
        </p>
      </div>

      {selecting || savingTemperature ? <p className="preset-saving">Saving…</p> : null}
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
