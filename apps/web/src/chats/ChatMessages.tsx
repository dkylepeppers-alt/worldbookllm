import type { Message } from '@worldbookllm/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface PendingExchange {
  userContent: string;
  assistantText: string;
  stopping: boolean;
}

interface ChatMessagesProps {
  messages: Message[];
  pending: PendingExchange | null;
}

export function ChatMessages({ messages, pending }: ChatMessagesProps) {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);

  if (ordered.length === 0 && pending === null) {
    return (
      <p className="empty-inline">
        No messages yet. Ask about your sources to develop this notebook.
      </p>
    );
  }

  return (
    <ol className="chat-messages" aria-label="Messages">
      {ordered.map((message) => (
        <li key={message.id} className={`chat-message chat-message-${message.role}`}>
          <p className="coordinate-label">
            {message.role === 'user' ? 'You' : 'Assistant'}
            {message.status === 'interrupted' ? (
              <span className="message-badge">Interrupted</span>
            ) : null}
            {message.status === 'error' ? <span className="message-badge">Error</span> : null}
          </p>
          <MessageBody message={message} />
        </li>
      ))}
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
