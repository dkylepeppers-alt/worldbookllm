import type { AgentChatDetail, Checkpoint } from '@worldbookllm/shared';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { errorMessage } from '../books/useLoad.js';
import { AgentRunnerContext, type AgentRun, type AgentRunError } from './agent-runner-context.js';
import { applyAgentEvent, startTurn } from './agent-turns.js';

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function lastIsStreaming(chat: AgentChatDetail): boolean {
  return chat.messages.at(-1)?.status === 'streaming';
}

const SETTLE_POLL_MS = 300;
const SETTLE_POLL_LIMIT = 20;

interface AgentRunnerProviderProps {
  /** Called after a turn settles, since the agent may have changed the book's files. */
  onBookChanged: () => void;
  children: React.ReactNode;
}

/**
 * Runs agent turns for one book. It sits above the tab screens so a turn
 * keeps streaming, and can still be stopped, while the writer looks at other
 * tabs. Leaving the book does not stop the turn: the server finishes it and
 * the chat shows the result when it is opened again.
 */
export function AgentRunnerProvider({ onBookChanged, children }: AgentRunnerProviderProps) {
  const api = useApi();
  const [run, setRun] = useState<AgentRun | null>(null);
  const [settled, setSettled] = useState<AgentChatDetail | null>(null);
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [error, setError] = useState<AgentRunError | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const bookChanged = useRef(onBookChanged);
  useLayoutEffect(() => {
    bookChanged.current = onBookChanged;
  });

  const send = useCallback(
    async (chatId: string, content: string): Promise<'accepted' | 'rejected'> => {
      if (controllerRef.current !== null) return 'rejected';
      const controller = new AbortController();
      controllerRef.current = controller;
      setRun({ chatId, turn: startTurn(content) });
      setError(null);
      let started = false;
      let outcome: 'accepted' | 'rejected' = 'accepted';
      try {
        await api.streamAgentMessage(chatId, content, {
          signal: controller.signal,
          onEvent: (event) => {
            started = true;
            if (event.type === 'checkpoint') setCheckpoint(event.checkpoint);
            if (event.type === 'error') {
              setError({
                chatId,
                message: event.message,
                configuration: event.code === 'configuration_error',
              });
            }
            setRun((current) =>
              current === null ? null : { ...current, turn: applyAgentEvent(current.turn, event) },
            );
          },
        });
      } catch (caught) {
        if (!isAbort(caught)) {
          const refused = caught instanceof ApiClientError && caught.status >= 400;
          if (refused && !started) outcome = 'rejected';
          setError({
            chatId,
            message: errorMessage(caught),
            configuration:
              caught instanceof ApiClientError && caught.code === 'configuration_error',
          });
        }
      }

      // A stopped turn is finished by the server after the connection closes;
      // wait for it to record the outcome before showing the saved chat.
      try {
        let chat = await api.getAgentChat(chatId);
        for (let attempt = 0; lastIsStreaming(chat) && attempt < SETTLE_POLL_LIMIT; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
          chat = await api.getAgentChat(chatId);
        }
        setSettled(chat);
      } catch {
        // The chat screen loads the chat itself; nothing else to recover here.
      }
      controllerRef.current = null;
      setRun(null);
      if (outcome === 'accepted') bookChanged.current();
      return outcome;
    },
    [api],
  );

  const stop = useCallback(() => {
    const controller = controllerRef.current;
    if (controller === null) return;
    setRun((current) =>
      current === null ? null : { ...current, turn: { ...current.turn, stopping: true } },
    );
    controller.abort();
  }, []);

  const value = useMemo(
    () => ({ run, settled, checkpoint, error, send, stop }),
    [run, settled, checkpoint, error, send, stop],
  );
  return <AgentRunnerContext.Provider value={value}>{children}</AgentRunnerContext.Provider>;
}
