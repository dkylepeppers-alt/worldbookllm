import { useState, type FormEvent } from 'react';

interface MessageComposerProps {
  streaming: boolean;
  stopping: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
}

export function MessageComposer({ streaming, stopping, onSend, onStop }: MessageComposerProps) {
  const [draft, setDraft] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (streaming || content.length === 0) return;
    setDraft('');
    onSend(content);
  }

  return (
    <form className="chat-composer" onSubmit={submit}>
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
        <button type="submit" className="button-primary" disabled={streaming}>
          Send
        </button>
      </div>
    </form>
  );
}
