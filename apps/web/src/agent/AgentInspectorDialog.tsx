import type { AgentMessage } from '@worldbookllm/shared';
import { useRef } from 'react';

import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { prettyArguments } from './agent-turns.js';

interface AgentInspectorDialogProps {
  message: AgentMessage;
  onClose: () => void;
}

/** Every model request in an agent turn, with the tool calls it made and what they returned. */
export function AgentInspectorDialog({ message, onClose }: AgentInspectorDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogLifecycle(closeRef, onClose);

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card prompt-inspector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-inspector-title"
      >
        <p className="coordinate-label">
          Turn record · {message.steps.length} {message.steps.length === 1 ? 'step' : 'steps'}
        </p>
        <h2 id="agent-inspector-title">What the model received</h2>
        <ol className="inspector-sections" aria-label="Steps">
          {message.steps.map((step) => (
            <li key={step.index} className="inspector-section">
              <h3>Step {step.index + 1}</h3>
              <details>
                <summary>Request body</summary>
                <p className="dialog-copy">
                  Secret-free provider request fields. Request headers and URLs are not recorded.
                </p>
                <pre>{JSON.stringify(step.requestBody, null, 2)}</pre>
              </details>
              {step.text.trim() === '' ? null : (
                <>
                  <p className="coordinate-label">Model text</p>
                  <pre>{step.text}</pre>
                </>
              )}
              {step.toolCalls.map((call) => (
                <div key={call.id} className="inspector-tool-call">
                  <p className="coordinate-label">
                    {call.name} · {call.ok ? 'ok' : 'failed'} · {Math.round(call.durationMs)} ms
                  </p>
                  <pre>{prettyArguments(call.arguments)}</pre>
                  <pre>{call.result}</pre>
                </div>
              ))}
            </li>
          ))}
        </ol>
        <div className="dialog-actions">
          <button ref={closeRef} type="button" className="button-primary" onClick={onClose}>
            Close inspector
          </button>
        </div>
      </section>
    </div>
  );
}
