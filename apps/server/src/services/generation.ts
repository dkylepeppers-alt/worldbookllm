import {
  presetGenerationContextSchema,
  type Message,
  type ProviderSource,
  type StreamEvent,
} from '@worldbookllm/shared';
import {
  normalizeStreamChunk,
  parseSseStream,
  ProviderError,
  type ProviderChatRequest,
} from '@worldbookllm/providers';

import {
  ConfigurationError,
  ConflictError,
  InvalidStoredDataError,
  NotFoundError,
} from '../errors.js';
import type { ChatService } from './chats.js';
import type { NotebookService } from './notebooks.js';
import type { PromptAssembler } from './prompt-assembler.js';
import type { ProviderService } from './providers.js';
import type { PresetService } from './presets.js';

export interface PreparedGeneration {
  chatId: string;
  source: ProviderSource;
  request: ProviderChatRequest;
  assistant: Message;
  release(): void;
}

export class GenerationService {
  private readonly activeChats = new Set<string>();

  constructor(
    private readonly chats: ChatService,
    private readonly notebooks: NotebookService,
    private readonly presets: PresetService,
    private readonly prompts: PromptAssembler,
    private readonly providers: ProviderService,
    private readonly logError: (error: unknown) => void = () => undefined,
  ) {}

  prepare(chatId: string, content: string): PreparedGeneration {
    if (this.activeChats.has(chatId)) {
      throw new ConflictError(
        'generation_in_progress',
        `Chat ${chatId} already has a generation in progress`,
      );
    }
    this.activeChats.add(chatId);
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.activeChats.delete(chatId);
      }
    };

    try {
      const chat = this.chats.getDetail(chatId);
      const notebook = this.notebooks.get(chat.notebookId);
      const config = chat.providerOverride ?? notebook.settings;
      if (!config) throw new ConfigurationError('Configure a provider before sending a message.');
      let preset;
      try {
        preset = this.presets.resolve(chat.presetId);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new InvalidStoredDataError('The configured generation preset was not found', {
            cause: error,
          });
        }
        throw error;
      }
      const assembled = this.prompts.assemble(chat, chat.messages, content, preset);
      const request = this.providers.createChatRequest(
        config,
        assembled.messages,
        preset.generation,
      );
      const context = presetGenerationContextSchema.parse({
        contextVersion: 2,
        preset,
        canonicalMessages: assembled.messages,
        sources: assembled.sources,
        requestedControls: preset.generation,
        effectiveRequestBody: this.providers.snapshotRequestBody(request),
        provider: config.source,
        model: config.model,
      });
      const exchange = this.chats.beginExchange(chatId, content, context);
      return { chatId, source: config.source, request, assistant: exchange.assistant, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  async stream(
    prepared: PreparedGeneration,
    signal: AbortSignal,
    emit: (event: StreamEvent) => void,
  ): Promise<void> {
    let content = '';
    let reasoning = '';
    const persist = (status: 'complete' | 'interrupted' | 'error') =>
      this.chats.updateAssistant(prepared.assistant.id, {
        content,
        reasoning: reasoning || null,
        status,
      });

    try {
      const stream = await this.providers.openChatStream(prepared.source, prepared.request, signal);
      let sawDelta = false;
      for await (const event of parseSseStream(stream)) {
        if (event.data === '[DONE]') break;
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          throw new ProviderError('Provider stream contained invalid JSON.', prepared.source);
        }
        const delta = normalizeStreamChunk(prepared.source, payload);
        if (!delta) continue;
        sawDelta = true;
        content += delta.text;
        reasoning += delta.reasoning ?? '';
        persist('interrupted');
        emit({
          type: 'delta',
          text: delta.text,
          ...(delta.reasoning ? { reasoning: delta.reasoning } : {}),
        });
      }
      if (!sawDelta)
        throw new ProviderError('Provider stream contained no completion data.', prepared.source);
      emit({ type: 'done', message: persist('complete') });
    } catch (error) {
      if (signal.aborted) {
        persist('interrupted');
        return;
      }
      this.logError(error);
      const messageState = persist('error');
      if (error instanceof ProviderError) {
        emit({
          type: 'error',
          code: 'provider_error',
          message: 'Provider generation failed',
          messageState,
        });
        return;
      }
      emit({
        type: 'error',
        code: 'internal_error',
        message: 'Internal server error',
        messageState,
      });
    }
  }
}
