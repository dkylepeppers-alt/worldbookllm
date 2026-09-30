import type { AgentMessage, Checkpoint } from '@worldbookllm/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  extraText,
  prettyArguments,
  stepsOf,
  toolTarget,
  type PendingTurn,
  type StepView,
  type ToolCallView,
} from './agent-turns.js';
import { ChangeSummary } from './ChangeSummary.js';

interface AgentMessagesProps {
  messages: AgentMessage[];
  pending: PendingTurn | null;
  /** The book's checkpoints by id, for the change summary under each turn. */
  checkpoints: ReadonlyMap<string, Checkpoint>;
  /** The newest checkpoint not yet undone: the only one undo can reverse. */
  latestLiveId: string | null;
  undoing: boolean;
  onInspect: (message: AgentMessage) => void;
  onOpenDiff: (checkpoint: Checkpoint, path: string) => void;
  onUndo: (checkpoint: Checkpoint) => void;
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: 'h4', h2: 'h4' }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const STATUS_LABELS: Record<ToolCallView['status'], string> = {
  running: 'running…',
  ok: 'done',
  failed: 'failed',
};

function ToolChip({ call }: { call: ToolCallView }) {
  const target = toolTarget(call.arguments);
  return (
    <li>
      <details className={`tool-chip tool-chip-${call.status}`}>
        <summary>
          <span className="tool-chip-name">{call.name}</span>
          {target === null ? null : <span className="tool-chip-target">{target}</span>}
          <span className="tool-chip-status">{STATUS_LABELS[call.status]}</span>
        </summary>
        <p className="coordinate-label">Arguments</p>
        <pre>{prettyArguments(call.arguments)}</pre>
        {call.result === null ? null : (
          <>
            <p className="coordinate-label">{call.status === 'failed' ? 'Error' : 'Result'}</p>
            <pre>{call.result}</pre>
          </>
        )}
      </details>
    </li>
  );
}

function Steps({ steps }: { steps: StepView[] }) {
  return (
    <>
      {steps.map((step) => (
        <div key={step.index} className="agent-step">
          {step.text.trim() === '' ? null : <Markdown>{step.text}</Markdown>}
          {step.calls.length === 0 ? null : (
            <ul className="tool-chips" aria-label={`Step ${step.index + 1} tools`}>
              {step.calls.map((call) => (
                <ToolChip key={call.id} call={call} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}

function Reasoning({ reasoning, streaming }: { reasoning: string | null; streaming: boolean }) {
  if (reasoning === null || reasoning.trim() === '') return null;
  return (
    <details className="message-reasoning">
      <summary>{streaming ? 'Thinking…' : 'Thinking'}</summary>
      <Markdown>{reasoning}</Markdown>
    </details>
  );
}

const STATUS_BADGES: Partial<Record<AgentMessage['status'], string>> = {
  interrupted: 'Interrupted',
  error: 'Error',
  streaming: 'Working',
};

/**
 * An agent conversation: each assistant turn shows its text and tool calls
 * step by step, with the tool calls as collapsed chips, and ends with a
 * summary of the files it changed.
 */
export function AgentMessages({
  messages,
  pending,
  checkpoints,
  latestLiveId,
  undoing,
  onInspect,
  onOpenDiff,
  onUndo,
}: AgentMessagesProps) {
  const ordered = [...messages].sort((left, right) => left.seq - right.seq);
  const summary = (checkpoint: Checkpoint, running = false) => (
    <ChangeSummary
      checkpoint={checkpoint}
      undo={running ? 'hidden' : checkpoint.id === latestLiveId ? 'available' : 'blocked'}
      undoing={undoing}
      onOpenDiff={(path) => onOpenDiff(checkpoint, path)}
      onUndo={() => onUndo(checkpoint)}
    />
  );

  return (
    <ol className="chat-messages agent-messages" aria-label="Messages">
      {ordered.map((message) => {
        if (message.role === 'user') {
          return (
            <li key={message.id} className="chat-message chat-message-user">
              <p className="coordinate-label">You</p>
              <p className="chat-message-text">{message.content}</p>
            </li>
          );
        }
        const badge = STATUS_BADGES[message.status];
        const checkpoint =
          message.checkpointId === null ? undefined : checkpoints.get(message.checkpointId);
        const extra = extraText(message);
        return (
          <li key={message.id} className="chat-message chat-message-assistant">
            <p className="coordinate-label">
              Agent
              {badge === undefined ? null : <span className="message-badge">{badge}</span>}
            </p>
            <Reasoning reasoning={message.reasoning} streaming={false} />
            <Steps steps={stepsOf(message)} />
            {extra.trim() === '' ? null : <Markdown>{extra}</Markdown>}
            {checkpoint === undefined ? null : summary(checkpoint)}
            {message.steps.length === 0 ? null : (
              <div className="message-actions">
                <button type="button" onClick={() => onInspect(message)}>
                  Inspect steps
                </button>
              </div>
            )}
          </li>
        );
      })}
      {pending === null ? null : (
        <>
          <li className="chat-message chat-message-user">
            <p className="coordinate-label">You</p>
            <p className="chat-message-text">{pending.userContent}</p>
          </li>
          <li className="chat-message chat-message-assistant" aria-busy="true">
            <p className="coordinate-label">
              Agent · {pending.stopping ? 'stopping…' : 'working…'}
            </p>
            <Reasoning reasoning={pending.reasoning} streaming />
            <Steps steps={pending.steps} />
            {pending.checkpoint === null ? null : summary(pending.checkpoint, true)}
          </li>
        </>
      )}
    </ol>
  );
}
