import { useState, type FormEvent } from 'react';

interface AgentComposerProps {
  id: string;
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
}

export function AgentComposer({
  id,
  label,
  initialDraft = '',
  submitLabel,
  running,
  stopping = false,
  busy = false,
  onSend,
  onStop,
}: AgentComposerProps) {
  const [draft, setDraft] = useState(initialDraft);

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
