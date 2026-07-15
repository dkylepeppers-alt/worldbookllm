import type { Message, PresetGenerationContext } from '@worldbookllm/shared';
import { useRef } from 'react';

import { useDialogLifecycle } from '../components/useDialogLifecycle.js';

interface PromptInspectorDialogProps {
  message: Message;
  onClose: () => void;
}

export function PromptInspectorDialog({ message, onClose }: PromptInspectorDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogLifecycle(closeRef, onClose);

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card prompt-inspector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-inspector-title"
      >
        <p className="coordinate-label">Exchange record · immutable snapshot</p>
        <h2 id="prompt-inspector-title">What the model received</h2>
        <InspectorContent message={message} />
        <div className="dialog-actions">
          <button ref={closeRef} type="button" className="button-primary" onClick={onClose}>
            Close inspector
          </button>
        </div>
      </section>
    </div>
  );
}

function InspectorContent({ message }: { message: Message }) {
  const { context } = message;
  if (context === null) {
    return (
      <section className="inspector-section">
        <h3>Prompt unavailable</h3>
        <p className="dialog-copy">No generation context was recorded for this exchange.</p>
      </section>
    );
  }
  if (!('contextVersion' in context)) {
    return (
      <section className="inspector-section">
        <h3>Legacy grounded exchange</h3>
        <p className="dialog-copy">
          This older exchange kept only limited grounding details. Its full prompt cannot be
          reconstructed.
        </p>
        <dl className="inspector-facts">
          <dt>Source IDs</dt>
          <dd>{context.sourceIds.length === 0 ? 'None recorded' : context.sourceIds.join(', ')}</dd>
          <dt>Provider</dt>
          <dd>{context.provider}</dd>
          <dt>Model</dt>
          <dd>{context.model}</dd>
          <dt>Strictness</dt>
          <dd>{context.strictness}</dd>
        </dl>
      </section>
    );
  }
  return <PresetInspector context={context} />;
}

function PresetInspector({ context }: { context: PresetGenerationContext }) {
  return (
    <div className="inspector-sections">
      <section className="inspector-section">
        <p className="coordinate-label">Captured preset</p>
        <h3>{context.preset.name}</h3>
        <pre>{pretty(context.preset)}</pre>
      </section>
      <section className="inspector-section">
        <h3>Requested controls</h3>
        <pre>{pretty(context.requestedControls)}</pre>
      </section>
      <section className="inspector-section">
        <h3>Canonical messages</h3>
        <ol className="canonical-messages" aria-label="Canonical messages">
          {context.canonicalMessages.map((entry, index) => (
            <li key={index}>
              <p className="coordinate-label">{entry.role}</p>
              <pre>{entry.content}</pre>
            </li>
          ))}
        </ol>
      </section>
      <section className="inspector-section">
        <h3>Captured sources</h3>
        {context.sources.length === 0 ? (
          <p className="dialog-copy">No sources were captured for this exchange.</p>
        ) : (
          <ol className="captured-sources">
            {context.sources.map((source) => (
              <li key={source.id}>
                <h4>{source.title}</h4>
                <dl className="inspector-facts">
                  <dt>Source ID</dt>
                  <dd>{source.id}</dd>
                  <dt>Content hash</dt>
                  <dd>{source.contentHash}</dd>
                </dl>
                <pre>{source.content}</pre>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="inspector-section">
        <h3>Effective request body</h3>
        <p className="dialog-copy">
          Secret-free provider request fields captured for this exchange. Request headers and URLs
          are not part of this snapshot.
        </p>
        <pre>{pretty(context.effectiveRequestBody)}</pre>
      </section>
      <section className="inspector-section">
        <h3>Provider target</h3>
        <dl className="inspector-facts">
          <dt>Provider</dt>
          <dd>{context.provider}</dd>
          <dt>Model</dt>
          <dd>{context.model}</dd>
        </dl>
      </section>
    </div>
  );
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
