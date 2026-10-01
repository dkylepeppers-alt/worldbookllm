import type { AgentChatDetail, Checkpoint } from '@worldbookllm/shared';
import { createContext, useContext } from 'react';

import type { PendingTurn } from './agent-turns.js';

export interface AgentRun {
  chatId: string;
  turn: PendingTurn;
}

export interface AgentRunError {
  chatId: string;
  message: string;
  /** Set when the provider settings are the problem, so the screen can point at Settings. */
  configuration: boolean;
  /** The message the server refused, for the composer to restore. */
  draft: string | null;
}

export interface AgentRunnerValue {
  /** The turn in flight in this book, if any. */
  run: AgentRun | null;
  /** The chat as the server recorded it once the last turn settled. */
  settled: AgentChatDetail | null;
  /** The checkpoint the last turn created, shown before the book's history reloads. */
  checkpoint: Checkpoint | null;
  error: AgentRunError | null;
  /** Resolves 'rejected' when the server never accepted the message, so the draft is restored. */
  send(
    chatId: string,
    content: string,
    pinnedPaths?: readonly string[],
    answeringCallId?: string,
  ): Promise<'accepted' | 'rejected'>;
  stop(): void;
}

export const AgentRunnerContext = createContext<AgentRunnerValue | null>(null);

export function useAgentRunner(): AgentRunnerValue {
  const value = useContext(AgentRunnerContext);
  if (value === null) throw new Error('useAgentRunner must be used inside a book route');
  return value;
}
