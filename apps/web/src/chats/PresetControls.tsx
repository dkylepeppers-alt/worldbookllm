import type { Chat, Preset } from '@worldbookllm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';

type RequestState<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T };

const TEMPERATURE_COMMIT_DELAY_MS = 150;

interface PresetControlsProps {
  chat: Chat;
  onChatUpdated: (chat: Chat) => void;
  onMutationBusyChange: (owner: symbol, busy: boolean) => void;
}

export function PresetControls({ chat, onChatUpdated, onMutationBusyChange }: PresetControlsProps) {
  const api = useApi();
  const [presetsState, setPresetsState] = useState<RequestState<Preset[]>>({ status: 'loading' });
  const [settingsState, setSettingsState] = useState<RequestState<string>>({ status: 'loading' });
  const [presetsReloadKey, setPresetsReloadKey] = useState(0);
  const [settingsReloadKey, setSettingsReloadKey] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [savingTemperature, setSavingTemperature] = useState(false);
  const [draftTemperature, setDraftTemperature] = useState<{
    presetId: string;
    value: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const busyOwnerRef = useRef(Symbol('preset-controls'));
  const temperatureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportMutationBusy = (busy: boolean) => onMutationBusyChange(busyOwnerRef.current, busy);

  const loadPresets = useCallback((signal: AbortSignal) => api.listPresets(signal), [api]);
  const loadSettings = useCallback((signal: AbortSignal) => api.getAppSettings(signal), [api]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPresets(controller.signal).then(
      (presets) => setPresetsState({ status: 'ready', value: presets }),
      (caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          setPresetsState({ status: 'error' });
        }
      },
    );
    return () => controller.abort();
  }, [loadPresets, presetsReloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSettings(controller.signal).then(
      (settings) => setSettingsState({ status: 'ready', value: settings.defaultPresetId }),
      (caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          setSettingsState({ status: 'error' });
        }
      },
    );
    return () => controller.abort();
  }, [loadSettings, settingsReloadKey]);

  useEffect(
    () => () => {
      if (temperatureTimerRef.current !== null) clearTimeout(temperatureTimerRef.current);
      onMutationBusyChange(busyOwnerRef.current, false);
    },
    [onMutationBusyChange],
  );

  if (presetsState.status === 'loading') {
    return <p className="preset-controls-status">Loading preset library…</p>;
  }

  if (presetsState.status === 'error') {
    return (
      <div className="preset-controls-status" role="alert">
        <p>Could not load the preset library.</p>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setError(null);
            setPresetsState({ status: 'loading' });
            setPresetsReloadKey((value) => value + 1);
          }}
        >
          Retry preset library
        </button>
      </div>
    );
  }

  const presets = presetsState.value;
  const defaultId = settingsState.status === 'ready' ? settingsState.value : null;
  const defaultPreset = presets.find((preset) => preset.id === defaultId);
  const activeId = chat.presetId ?? defaultId;
  const active = presets.find((preset) => preset.id === activeId);

  if (chat.presetId === null && settingsState.status !== 'ready') {
    return settingsState.status === 'error' ? (
      <SettingsError onRetry={retrySettings} />
    ) : (
      <p className="preset-controls-status">Loading global default preset…</p>
    );
  }

  if (active === undefined || (settingsState.status === 'ready' && defaultPreset === undefined)) {
    return (
      <div className="preset-controls-status" role="alert">
        <p>The active preset is unavailable. Reload the preset library.</p>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setError(null);
            setPresetsState({ status: 'loading' });
            setPresetsReloadKey((value) => value + 1);
          }}
        >
          Retry preset library
        </button>
      </div>
    );
  }

  const activePreset = active;
  const temperature =
    draftTemperature?.presetId === activePreset.id
      ? draftTemperature.value
      : activePreset.generation.temperature;
  const hasUnsavedTemperature = draftTemperature !== null;
  const controlsBusy = selecting || savingTemperature;

  async function selectPreset(value: string) {
    const presetId = value === '' ? null : value;
    if (mutationRef.current || presetId === chat.presetId) return;
    mutationRef.current = true;
    setSelecting(true);
    reportMutationBusy(true);
    setError(null);
    try {
      onChatUpdated(await api.updateChat(chat.id, { presetId }));
    } catch (caught) {
      setError(messageFor(caught, 'Could not update this chat preset.'));
    } finally {
      mutationRef.current = false;
      setSelecting(false);
      reportMutationBusy(false);
    }
  }

  function stageTemperature(value: number) {
    if (mutationRef.current) return;
    if (value === activePreset.generation.temperature) {
      if (temperatureTimerRef.current !== null) clearTimeout(temperatureTimerRef.current);
      temperatureTimerRef.current = null;
      setDraftTemperature(null);
      reportMutationBusy(false);
      setError(null);
      return;
    }
    if (temperatureTimerRef.current !== null) clearTimeout(temperatureTimerRef.current);
    setDraftTemperature({ presetId: activePreset.id, value });
    reportMutationBusy(true);
    setError(null);
    temperatureTimerRef.current = setTimeout(() => {
      temperatureTimerRef.current = null;
      void saveTemperature(activePreset, value);
    }, TEMPERATURE_COMMIT_DELAY_MS);
  }

  async function saveTemperature(preset: Preset, value: number) {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setSavingTemperature(true);
    try {
      const updated = await api.updatePreset(preset.id, {
        generation: { temperature: value },
      });
      if (updated.id !== preset.id) return;
      setPresetsState((current) =>
        current.status === 'ready'
          ? {
              ...current,
              value: current.value.map((entry) => (entry.id === preset.id ? updated : entry)),
            }
          : current,
      );
    } catch (caught) {
      setError(messageFor(caught, 'Could not save the temperature.'));
    } finally {
      mutationRef.current = false;
      setDraftTemperature(null);
      setSavingTemperature(false);
      reportMutationBusy(false);
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
        disabled={controlsBusy || hasUnsavedTemperature}
        onChange={(event) => void selectPreset(event.target.value)}
      >
        <option value="" disabled={defaultPreset === undefined}>
          Inherit global default — {defaultPreset?.name ?? 'unavailable'}
        </option>
        {presets.map((preset) => (
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
          onChange={(event) => stageTemperature(Number(event.target.value))}
        />
        <p>
          This edits the shared global preset for every chat using it. Changes apply to future
          generations only.
        </p>
      </div>

      {settingsState.status === 'error' ? <SettingsError onRetry={retrySettings} /> : null}
      {selecting || savingTemperature || hasUnsavedTemperature ? (
        <p className="preset-saving">Saving…</p>
      ) : null}
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );

  function retrySettings() {
    setError(null);
    setSettingsState({ status: 'loading' });
    setSettingsReloadKey((value) => value + 1);
  }
}

function SettingsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="preset-controls-status" role="alert">
      <p>Could not load the global default preset.</p>
      <button type="button" className="button-secondary" onClick={onRetry}>
        Retry global default
      </button>
    </div>
  );
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
