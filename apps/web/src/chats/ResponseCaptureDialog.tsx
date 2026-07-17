import type { Message, SourceCategory } from '@worldbookllm/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';
import { SourceOrganizationFields } from '../sources/SourceOrganizationFields.js';
import { useSourceOrganization } from '../sources/useSourceOrganization.js';
import { deriveResponseTitle } from './response-title.js';

interface ResponseCaptureDialogProps {
  message: Message;
  onClose: () => void;
}

export function ResponseCaptureDialog({ message, onClose }: ResponseCaptureDialogProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { notebookId, addSource, setLastSourceId } = useNotebookWorkspace();
  const {
    loading: organizationLoading,
    response: organizationResponse,
    suggest: suggestOrganization,
  } = useSourceOrganization(notebookId);
  const [title, setTitle] = useState(() => deriveResponseTitle(message.content));
  const [content, setContent] = useState(message.content);
  const [category, setCategory] = useState<SourceCategory | null>(null);
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const organizationTouched = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useDialogLifecycle(titleRef, () => {
    if (!saving) onClose();
  });

  const applySuggestion = useCallback((result: Awaited<ReturnType<typeof suggestOrganization>>) => {
    if (result === null || organizationTouched.current) return;
    const suggestion = result.suggestions.find((item) => item.index === 0);
    setCategory(suggestion?.category ?? null);
    setTags(suggestion?.tags.join(', ') ?? '');
  }, []);

  useEffect(() => {
    organizationTouched.current = false;
    void suggestOrganization([
      {
        index: 0,
        title: deriveResponseTitle(message.content),
        content: message.content,
      },
    ]).then(applySuggestion);
  }, [applySuggestion, message.content, message.id, suggestOrganization]);

  function suggestAgain() {
    organizationTouched.current = false;
    void suggestOrganization([{ index: 0, title: title.trim(), content }]).then(applySuggestion);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0) {
      setError('Enter a source title.');
      return;
    }
    if (content.trim().length === 0) {
      setError('Enter Markdown content.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createSource(notebookId, {
        title: normalizedTitle,
        content,
        category,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ''),
        origin: { type: 'assistant-response', chatId: message.chatId, messageId: message.id },
        conversionNotes: [],
      });
      addSource(created);
      setLastSourceId(created.id);
      await navigate(`/notebooks/${notebookId}/sources/${created.id}`);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'Could not save the assistant response.',
      );
    } finally {
      setSaving(false);
    }
  }

  const warning =
    message.status === 'interrupted'
      ? 'Interrupted response'
      : message.status === 'error'
        ? 'Errored response'
        : null;

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card source-dialog response-capture-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="response-capture-title"
      >
        <p className="coordinate-label">New source · assistant response</p>
        <h2 id="response-capture-title">Review response as a source</h2>
        {warning === null ? null : (
          <div className="response-warning">
            <span className="message-badge">{warning}</span>
            <p className="dialog-copy">
              This may be a partial response. Review the Markdown before saving it as canon.
            </p>
          </div>
        )}
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="response-source-title">Source title</label>
          <input
            ref={titleRef}
            id="response-source-title"
            maxLength={300}
            disabled={saving}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="response-source-content">Markdown content</label>
          <textarea
            id="response-source-content"
            rows={14}
            maxLength={10_485_760}
            disabled={saving}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <SourceOrganizationFields
            idPrefix="response-source"
            category={category}
            tags={tags}
            loading={organizationLoading}
            warning={organizationResponse?.warning ?? null}
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
          {error === null ? null : <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button-primary"
              disabled={organizationLoading || saving}
            >
              {saving ? 'Saving…' : 'Save source'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
