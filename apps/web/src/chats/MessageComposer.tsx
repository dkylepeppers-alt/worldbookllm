import { useState, type FormEvent } from 'react';

interface MessageComposerProps {
  streaming: boolean;
  stopping: boolean;
  /** Disables Send without a stream in flight, e.g. while a source-selection save is pending. */
  sendDisabled?: boolean;
  /** Resolves 'rejected' when the server never accepted the message, so the draft is restored. */
  onSend: (content: string) => Promise<'accepted' | 'rejected'>;
  onStop: () => void;
}

export function MessageComposer({
  streaming,
  stopping,
  sendDisabled = false,
  onSend,
  onStop,
}: MessageComposerProps) {
  const [draft, setDraft] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (streaming || sendDisabled || content.length === 0) return;
    setDraft('');
    const outcome = await onSend(content);
    if (outcome === 'rejected') {
      // Give the unsent text back, unless the user already started retyping.
      setDraft((current) => (current.length === 0 ? content : current));
    }
  }

  return (
    <form className="chat-composer" onSubmit={(event) => void submit(event)}>
      <label htmlFor="chat-message-input">Message</label>
      <textarea
        id="chat-message-input"
        rows={3}
        placeholder="Ask about your sources…"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="chat-composer-actions">
        {streaming ? (
          <button type="button" className="button-secondary" disabled={stopping} onClick={onStop}>
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        ) : null}
        <button type="submit" className="button-primary" disabled={streaming || sendDisabled}>
          Send
        </button>
      </div>
    </form>
  );
}
