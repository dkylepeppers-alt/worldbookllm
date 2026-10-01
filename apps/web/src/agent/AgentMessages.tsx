import type { AgentChangeset, AgentMessage, Checkpoint } from '@worldbookllm/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';

import {
  extraText,
  prettyArguments,
  questionsOf,
  stepsOf,
  seriesBooksOf,
  toolTarget,
  type PendingTurn,
  type StepView,
  type ToolCallView,
} from './agent-turns.js';
import { ChangeSummary } from './ChangeSummary.js';
import { ProposedChanges } from './ProposedChanges.js';

interface AgentMessagesProps {
  messages: AgentMessage[];
  pending: PendingTurn | null;
  /** The book's checkpoints by id, for the change summary under each turn. */
  checkpoints: ReadonlyMap<string, Checkpoint>;
  /** The newest checkpoint not yet undone: the only one undo can reverse. */
  latestLiveId: string | null;
  undoing: boolean;
  /** Review mode's proposed changes, keyed by the assistant message that made them. */
  changesets: ReadonlyMap<string, AgentChangeset>;
  /** The changeset file being resolved (`<changeset id>:<path or *>`), while its request runs. */
  resolving: string | null;
  onInspect: (message: AgentMessage) => void;
  onOpenDiff: (checkpoint: Checkpoint, path: string) => void;
  onUndo: (checkpoint: Checkpoint) => void;
  onOpenProposal: (changeset: AgentChangeset, path: string) => void;
  onResolve: (changeset: AgentChangeset, action: 'apply' | 'skip', path?: string) => void;
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

/** An `ask_user` call as the questions it asked; the writer's answer is the next message. */
function AskedQuestions({ call }: { call: ToolCallView }) {
  const questions = call.status === 'failed' ? null : questionsOf(call);
  if (questions === null) return null;
  return (
    <li className="agent-asked">
      <p className="coordinate-label">Asked you</p>
      <ul>
        {questions.map((question, index) => (
          <li key={index}>
            <span className="agent-question-text">{question.question}</span>
            <span className="agent-asked-options">
              {question.options.map((option) => option.label).join(' · ')} · Other
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function ToolChip({ call }: { call: ToolCallView }) {
  if (call.status !== 'failed' && questionsOf(call) !== null) return <AskedQuestions call={call} />;
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
 * summary of the files it changed, or in review mode the changes it proposes.
 */
/** The files a message pinned: their contents went to the model with it. */
function PinnedFiles({ paths }: { paths: readonly string[] }) {
  if (paths.length === 0) return null;
  return (
    <p className="coordinate-label pinned-files">
      Pinned {paths.length === 1 ? 'file' : 'files'}: {paths.join(', ')}
    </p>
  );
}

function SeriesChanges({ books }: { books: readonly string[] }) {
  if (books.length === 0) return null;
  return (
    <section className="change-summary" aria-label="Series changes this turn">
      <h3>Books changed this turn</h3>
      <ul>
        {books.map((book) => (
          <li key={book}>
            <Link to={`/books/${book}/project`}>{book} · history and undo</Link>
          </li>
        ))}
      </ul>
      <p>Series sync can be undone separately in each changed book.</p>
    </section>
  );
}

export function AgentMessages({
  messages,
  pending,
  checkpoints,
  latestLiveId,
  undoing,
  changesets,
  resolving,
  onInspect,
  onOpenDiff,
  onUndo,
  onOpenProposal,
  onResolve,
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
  const proposal = (changeset: AgentChangeset, running = false) => {
    const prefix = `${changeset.id}:`;
    return (
      <ProposedChanges
        changeset={changeset}
        running={running}
        busy={resolving?.startsWith(prefix) ? resolving.slice(prefix.length) : null}
        onOpenDiff={(path) => onOpenProposal(changeset, path)}
        onResolve={(action, path) => onResolve(changeset, action, path)}
      />
    );
  };

  return (
    <ol className="chat-messages agent-messages" aria-label="Messages">
      {ordered.map((message) => {
        if (message.role === 'user') {
          return (
            <li key={message.id} className="chat-message chat-message-user">
              <p className="coordinate-label">You</p>
              <PinnedFiles paths={message.pinnedPaths} />
              <p className="chat-message-text">{message.content}</p>
            </li>
          );
        }
        const badge = STATUS_BADGES[message.status];
        const checkpoint =
          message.checkpointId === null ? undefined : checkpoints.get(message.checkpointId);
        const extra = extraText(message);
        const changeset = changesets.get(message.id);
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
            <SeriesChanges books={seriesBooksOf(stepsOf(message))} />
            {changeset === undefined ? null : proposal(changeset)}
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
            <PinnedFiles paths={pending.pinnedPaths} />
            <p className="chat-message-text">{pending.userContent}</p>
          </li>
          <li className="chat-message chat-message-assistant" aria-busy="true">
            <p className="coordinate-label">
              Agent · {pending.stopping ? 'stopping…' : 'working…'}
            </p>
            <Reasoning reasoning={pending.reasoning} streaming />
            <Steps steps={pending.steps} />
            {pending.checkpoint === null ? null : summary(pending.checkpoint, true)}
            <SeriesChanges books={pending.seriesBooks} />
            {pending.changeset === null ? null : proposal(pending.changeset, true)}
          </li>
        </>
      )}
    </ol>
  );
}
