import type {
  Chat,
  GenerationSourceSnapshot,
  Message,
  Preset,
  PresetModule,
} from '@worldbookllm/shared';
import type { ChatMessage } from '@worldbookllm/providers';

import type { SourceService } from './sources.js';

export interface AssembledPrompt {
  messages: ChatMessage[];
  sources: GenerationSourceSnapshot[];
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/gu, (character) => {
    const escapes: Record<string, string> = {
      '&': '&amp;',
      '"': '&quot;',
      '<': '&lt;',
      '>': '&gt;',
    };
    return escapes[character] ?? character;
  });
}

function includeHistory(message: Message): boolean {
  if (message.role === 'user') return true;
  if (message.status === 'complete') return true;
  return message.status === 'interrupted' && message.content.length > 0;
}

function moduleMessage(module: PresetModule, sourceContent: string): ChatMessage | undefined {
  if (module.kind === 'custom') {
    return module.enabled ? { role: module.role, content: module.content } : undefined;
  }
  return { role: 'system', content: `## Sources\n${sourceContent}` };
}

function appendCoalescingSameRole(messages: ChatMessage[], message: ChatMessage): void {
  const previous = messages.at(-1);
  if (previous?.role === message.role) {
    previous.content = `${previous.content}\n\n${message.content}`;
  } else {
    messages.push(message);
  }
}

export class PromptAssembler {
  constructor(private readonly sourceService: SourceService) {}

  assemble(chat: Chat, history: Message[], newContent: string, preset: Preset): AssembledPrompt {
    const sources = chat.sourceIds.map((id) => {
      const source = this.sourceService.get(id);
      return {
        id: source.id,
        title: source.title,
        contentHash: source.contentHash,
        content: source.content,
      };
    });
    const sourceContent =
      sources.length === 0
        ? 'No sources selected.'
        : sources
            .map(
              (source) =>
                `<source id="${source.id}" title="${escapeAttribute(source.title)}">\n${source.content}\n</source>`,
            )
            .join('\n\n');
    const eligibleHistory: ChatMessage[] = history.filter(includeHistory).map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));

    const beforeHistory: ChatMessage[] = [];
    const atBoundaries = new Map<number, ChatMessage[]>();
    for (const module of preset.modules) {
      const emitted = moduleMessage(module, sourceContent);
      if (!emitted) continue;
      if (module.insertion.position === 'before_history') {
        appendCoalescingSameRole(beforeHistory, emitted);
        continue;
      }
      const boundary = Math.max(0, eligibleHistory.length - module.insertion.depth);
      const messages = atBoundaries.get(boundary) ?? [];
      messages.push(emitted);
      atBoundaries.set(boundary, messages);
    }

    const messages = [...beforeHistory];
    for (let boundary = 0; boundary <= eligibleHistory.length; boundary += 1) {
      messages.push(...(atBoundaries.get(boundary) ?? []));
      const historical = eligibleHistory[boundary];
      if (historical) messages.push(historical);
    }
    messages.push({ role: 'user', content: newContent });
    return { messages, sources };
  }
}
