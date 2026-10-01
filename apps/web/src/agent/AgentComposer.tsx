import { useState, type FormEvent } from 'react';

import { useStoredDraft } from '../drafts.js';

/** Text to add to the draft; a new `id` adds it once, after anything already typed. */
export interface DraftAppend {
  id: number;
  text: string;
}

interface AgentComposerProps {
  id: string;
  /** Where the unsent draft is kept, so it survives leaving the page or the app. */
  draftKey: string;
  label: string;
  initialDraft?: string;
  submitLabel: string;
  running: boolean;
  stopping?: boolean;
  /** Disables sending without offering Stop, e.g. while a new chat is being created. */
  busy?: boolean;
  /** Resolves 'rejected' when the message was not accepted, so the draft is restored. */
  onSend: (content: string) => Promise<'accepted' | 'rejected'>;
  onStop?: () => void;
  append?: DraftAppend | null;
}

export function AgentComposer({
  id,
  draftKey,
  label,
  initialDraft = '',
  submitLabel,
  running,
  stopping = false,
  busy = false,
  onSend,
  onStop,
  append = null,
}: AgentComposerProps) {
  const [draft, setDraft] = useStoredDraft(
    draftKey,
    '',
    initialDraft === '' ? undefined : initialDraft,
  );
  const [appendedId, setAppendedId] = useState(append?.id ?? null);
  if (append !== null && append.id !== appendedId) {
    // Adjusting state from a prop during render, so the text lands in the same commit.
    setAppendedId(append.id);
    setDraft((current) => (current.trim() === '' ? append.text : `${current}\n\n${append.text}`));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (running || busy || content.length === 0) return;
    setDraft('');
    const outcome = await onSend(content);
    if (outcome === 'rejected') {
      setDraft((current) => (current.length === 0 ? content : current));
    }
  }

  return (
    <form className="chat-composer agent-composer" onSubmit={(event) => void submit(event)}>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={3}
        placeholder="Plan a chapter, check continuity, draft a scene…"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="chat-composer-actions">
        {running && onStop ? (
          <button type="button" className="button-secondary" disabled={stopping} onClick={onStop}>
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        ) : null}
        <button type="submit" className="button-primary" disabled={running || busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
