import { createPresetSchema, type CreatePreset, type Preset } from '@worldbookllm/shared';
import { useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';

interface Props {
  onClose: () => void;
  onCreated: (preset: Preset) => void;
}

export function PresetImportDialog({ onClose, onCreated }: Props) {
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<CreatePreset | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useDialogLifecycle(inputRef, () => {
    if (!saving) onClose();
  });

  async function inspect(file: File | undefined) {
    setReview(null);
    setIssues([]);
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setIssues(['Choose a .json file.']);
      return;
    }
    if (file.size > 1_048_576) {
      setIssues(['Preset files must be 1 MiB or smaller.']);
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(await file.text());
    } catch {
      setIssues(['The file does not contain valid JSON.']);
      return;
    }
    const parsed = createPresetSchema.safeParse(value);
    if (!parsed.success) {
      setIssues(
        parsed.error.issues.map(
          (issue) =>
            `${issue.path.length === 0 ? 'preset' : issue.path.join('.')}: ${issue.message}`,
        ),
      );
      return;
    }
    setReview(parsed.data);
  }

  async function save() {
    if (review === null || saving) return;
    setSaving(true);
    setIssues([]);
    try {
      onCreated(await api.createPreset(review));
    } catch (error) {
      setIssues([
        error instanceof ApiClientError ? error.message : 'Could not import this preset.',
      ]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-preset-title"
      >
        <p className="coordinate-label">Portable preset · local review</p>
        <h2 id="import-preset-title">Import preset</h2>
        <label htmlFor="preset-file">Preset JSON file</label>
        <input
          ref={inputRef}
          id="preset-file"
          type="file"
          accept=".json,application/json"
          onChange={(event) => void inspect(event.target.files?.[0])}
        />
        {issues.length === 0 ? null : (
          <ul className="field-errors" role="alert">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        {review === null ? null : (
          <section className="import-review" aria-label="Import review">
            <h3>{review.name}</h3>
            <p>Temperature {review.generation.temperature}</p>
            <p>
              {review.modules.length} {review.modules.length === 1 ? 'module' : 'modules'}
            </p>
          </section>
        )}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={review === null || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save imported preset'}
          </button>
        </div>
      </section>
    </div>
  );
}
