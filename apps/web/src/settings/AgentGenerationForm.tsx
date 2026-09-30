import type { AgentGeneration } from '@worldbookllm/shared';
import { type FormEvent, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';

interface AgentGenerationFormProps {
  /** The saved settings the fields start from; the form keeps its own values after that. */
  generation: AgentGeneration;
}

function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

/** The agent's generation controls: temperature, top-p, a response cap, and thinking (ADR 0017). */
export function AgentGenerationForm({ generation }: AgentGenerationFormProps) {
  const api = useApi();
  const [temperature, setTemperature] = useState(String(generation.temperature));
  const [topP, setTopP] = useState(generation.topP === null ? '' : String(generation.topP));
  const [maxTokens, setMaxTokens] = useState(
    generation.maxTokens === null ? '' : String(generation.maxTokens),
  );
  const [thinking, setThinking] = useState(generation.thinking);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await api.updateAppSettings({
        agentGeneration: {
          temperature: Number(temperature),
          topP: optionalNumber(topP),
          maxTokens: optionalNumber(maxTokens),
          thinking,
        },
      });
      setStatus({ ok: true, text: 'Saved.' });
    } catch (caught) {
      setStatus({
        ok: false,
        text:
          caught instanceof ApiClientError && caught.code === 'validation_error'
            ? 'Check the values: temperature 0–2 in steps of 0.05, top-p above 0 up to 1, and a whole-number token cap.'
            : caught instanceof Error
              ? caught.message
              : 'Could not save the settings.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="agent-generation" onSubmit={(event) => void save(event)}>
      <p className="coordinate-label">Generation</p>
      <div className="agent-generation-fields">
        <label>
          Temperature
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={2}
            step={0.05}
            required
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
          />
        </label>
        <label>
          Top-p
          <input
            type="number"
            inputMode="decimal"
            min={0.01}
            max={1}
            step={0.01}
            placeholder="Provider default"
            value={topP}
            onChange={(event) => setTopP(event.target.value)}
          />
        </label>
        <label>
          Max tokens per step
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={131072}
            step={1}
            placeholder="Provider default"
            value={maxTokens}
            onChange={(event) => setMaxTokens(event.target.value)}
          />
        </label>
      </div>
      <label className="agent-review-toggle">
        <input
          type="checkbox"
          checked={thinking}
          onChange={(event) => setThinking(event.target.checked)}
        />
        <span>Ask the model to think before answering, where the provider supports it</span>
      </label>
      <div className="agent-generation-actions">
        <button type="submit" className="button-secondary" disabled={busy}>
          {busy ? 'Saving…' : 'Save generation settings'}
        </button>
        {status === null ? null : (
          <p className={status.ok ? 'install-status' : 'form-error'} role="status">
            {status.text}
          </p>
        )}
      </div>
    </form>
  );
}
