import type { Message } from '@worldbookllm/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface PendingExchange {
  userContent: string;
  assistantText: string;
  assistantReasoning: string;
  stopping: boolean;
}

export interface RegenStream {
  messageId: string;
  text: string;
  reasoning: string;
  stopping: boolean;
}

interface ChatMessagesProps {
  messages: Message[];
  pending: PendingExchange | null;
  regenStream?: RegenStream | null;
  onInspect?: (message: Message) => void;
  onAddToSources?: (message: Message) => void;
  onRegenerate?: (message: Message) => void;
  onSelectVariant?: (message: Message, index: number) => void;
  /** Disables regenerate/swipe controls while a generation or switch is in flight. */
  busy?: boolean;
}

export function ChatMessages({
  messages,
  pending,
  regenStream = null,
  onInspect,
  onAddToSources,
  onRegenerate,
  onSelectVariant,
  busy = false,
}: ChatMessagesProps) {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  const lastAssistantId = ordered.filter((message) => message.role === 'assistant').at(-1)?.id;

  if (ordered.length === 0 && pending === null) {
    return (
      <p className="empty-inline">
        No messages yet. Ask about your sources to develop this notebook.
      </p>
    );
  }

  return (
    <ol className="chat-messages" aria-label="Messages">
      {ordered.map((message) => {
        const variantCount = message.variants?.length ?? 1;
        const activeVariant = message.activeVariant ?? 0;
        const isLastAssistant = message.role === 'assistant' && message.id === lastAssistantId;
        // While regenerating, stream the fresh response over the target message.
        if (regenStream !== null && regenStream.messageId === message.id) {
          return (
            <li key={message.id} className="chat-message chat-message-assistant">
              <p className="coordinate-label">
                Assistant · {regenStream.stopping ? 'stopping…' : 'streaming…'}
              </p>
              <ReasoningDisclosure reasoning={regenStream.reasoning} streaming />
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: 'h4', h2: 'h4' }}>
                  {regenStream.text}
                </ReactMarkdown>
              </div>
            </li>
          );
        }
        return (
          <li key={message.id} className={`chat-message chat-message-${message.role}`}>
            <p className="coordinate-label">
              {message.role === 'user' ? 'You' : 'Assistant'}
              {message.status === 'interrupted' ? (
                <span className="message-badge">Interrupted</span>
              ) : null}
              {message.status === 'error' ? <span className="message-badge">Error</span> : null}
            </p>
            <ReasoningDisclosure reasoning={message.reasoning} />
            <MessageBody message={message} />
            {message.role === 'assistant' && variantCount > 1 ? (
              <div className="message-swipes" role="group" aria-label="Response versions">
                <button
                  type="button"
                  aria-label="Previous response"
                  disabled={busy || activeVariant <= 0}
                  onClick={() => onSelectVariant?.(message, activeVariant - 1)}
                >
                  ‹
                </button>
                <span aria-live="polite">
                  {activeVariant + 1}/{variantCount}
                </span>
                <button
                  type="button"
                  aria-label="Next response"
                  disabled={busy || activeVariant >= variantCount - 1}
                  onClick={() => onSelectVariant?.(message, activeVariant + 1)}
                >
                  ›
                </button>
              </div>
            ) : null}
            {message.role === 'assistant' && message.content.trim().length > 0 ? (
              <div className="message-actions">
                <button type="button" onClick={() => onInspect?.(message)}>
                  Inspect prompt
                </button>
                <button type="button" onClick={() => onAddToSources?.(message)}>
                  Add to sources
                </button>
                {isLastAssistant && onRegenerate ? (
                  <button type="button" disabled={busy} onClick={() => onRegenerate(message)}>
                    Regenerate
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
      {pending === null ? null : (
        <>
          <li className="chat-message chat-message-user">
            <p className="coordinate-label">You</p>
            <p className="chat-message-text">{pending.userContent}</p>
          </li>
          <li className="chat-message chat-message-assistant">
            <p className="coordinate-label">
              Assistant · {pending.stopping ? 'stopping…' : 'streaming…'}
            </p>
            <ReasoningDisclosure reasoning={pending.assistantReasoning} streaming />
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: 'h4', h2: 'h4' }}>
                {pending.assistantText}
              </ReactMarkdown>
            </div>
          </li>
        </>
      )}
    </ol>
  );
}

function ReasoningDisclosure({
  reasoning,
  streaming = false,
}: {
  reasoning: string | null;
  streaming?: boolean;
}) {
  if (reasoning === null || reasoning.trim().length === 0) return null;
  return (
    <details className="message-reasoning">
      <summary>{streaming ? 'Thinking…' : 'Thinking'}</summary>
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: 'h4', h2: 'h4' }}>
          {reasoning}
        </ReactMarkdown>
      </div>
    </details>
  );
}

function MessageBody({ message }: { message: Message }) {
  if (message.role === 'user') {
    return <p className="chat-message-text">{message.content}</p>;
  }
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: 'h4', h2: 'h4' }}>
        {message.content}
      </ReactMarkdown>
    </div>
  );
}
