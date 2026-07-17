import type { SourceCategory } from '@worldbookllm/shared';
import { type FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ApiClientError } from '../api/client.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';
import { SourceOrganizationFields } from './SourceOrganizationFields.js';
import { useSourceOrganization } from './useSourceOrganization.js';

interface SourcePasteDialogProps {
  onClose: () => void;
}

export function SourcePasteDialog({ onClose }: SourcePasteDialogProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { notebookId, addSource, setLastSourceId } = useNotebookWorkspace();
  const organization = useSourceOrganization(notebookId);
  const [step, setStep] = useState<'draft' | 'review'>('draft');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<SourceCategory | null>(null);
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const organizationTouched = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useDialogLifecycle(titleRef, onClose);

  function validateDraft() {
    if (title.trim().length === 0) {
      setError('Enter a source title.');
      return false;
    }
    if (content.length === 0) {
      setError('Paste Markdown content.');
      return false;
    }
    setError(null);
    return true;
  }

  function applySuggestion(result: Awaited<ReturnType<typeof organization.suggest>>) {
    if (result === null || organizationTouched.current) return;
    const suggestion = result.suggestions.find((item) => item.index === 0);
    setCategory(suggestion?.category ?? null);
    setTags(suggestion?.tags.join(', ') ?? '');
  }

  function continueToReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateDraft()) return;
    setStep('review');
    void organization.suggest([{ index: 0, title: title.trim(), content }]).then(applySuggestion);
  }

  function suggestAgain() {
    organizationTouched.current = false;
    void organization.suggest([{ index: 0, title: title.trim(), content }]).then(applySuggestion);
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateDraft()) return;
    setSaving(true);
    try {
      const created = await api.createSource(notebookId, {
        title: title.trim(),
        content,
        category,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ''),
      });
      addSource(created);
      setLastSourceId(created.id);
      await navigate(`/notebooks/${notebookId}/sources/${created.id}`);
      onClose();
    } catch (value) {
      setError(value instanceof ApiClientError ? value.message : 'Could not save the source.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-source-title"
      >
        <p className="coordinate-label">New source · paste origin</p>
        <h2 id="paste-source-title">
          {step === 'draft' ? 'Paste a Markdown source' : 'Review pasted source'}
        </h2>
        <form
          onSubmit={(event) =>
            step === 'draft' ? continueToReview(event) : void saveSource(event)
          }
        >
          <label htmlFor="source-title">Source title</label>
          <input
            ref={titleRef}
            id="source-title"
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="source-content">Markdown content</label>
          <textarea
            id="source-content"
            rows={14}
            maxLength={10_485_760}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          {step === 'review' ? (
            <SourceOrganizationFields
              idPrefix="pasted-source"
              category={category}
              tags={tags}
              loading={organization.loading}
              warning={organization.response?.warning ?? null}
              disabled={saving}
              onCategoryChange={(value) => {
                organizationTouched.current = true;
                setCategory(value);
              }}
              onTagsChange={(value) => {
                organizationTouched.current = true;
                setTags(value);
              }}
              onSuggestAgain={suggestAgain}
            />
          ) : null}
          {error === null ? null : <p role="alert">{error}</p>}
          <div className="dialog-actions">
            {step === 'draft' ? (
              <button type="button" className="button-secondary" onClick={onClose}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="button-secondary"
                disabled={saving}
                onClick={() => setStep('draft')}
              >
                Back
              </button>
            )}
            <button
              type="submit"
              className="button-primary"
              disabled={step === 'review' && (organization.loading || saving)}
            >
              {step === 'draft' ? 'Continue' : saving ? 'Saving…' : 'Save source'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
