import type { Chat, Message } from '@worldbookllm/shared';
import type { ChatMessage } from '@worldbookllm/providers';

import type { SourceService } from './sources.js';

const PREAMBLE =
  'You are a creative writing and worldbuilding assistant working from user-provided source material.';
const GROUNDING =
  'Treat the supplied sources as the grounding for your answer. Preserve established facts and clearly distinguish reasonable development from facts stated in the sources. If the sources do not answer something, say so rather than inventing certainty.';

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

export class PromptAssembler {
  constructor(private readonly sources: SourceService) {}

  assemble(chat: Chat, history: Message[], newContent: string): ChatMessage[] {
    const sourceBlocks = chat.sourceIds.map((id) => {
      const source = this.sources.get(id);
      return `<source id="${source.id}" title="${escapeAttribute(source.title)}">\n${source.content}\n</source>`;
    });
    const sourceSection =
      sourceBlocks.length > 0 ? sourceBlocks.join('\n\n') : 'No sources selected.';
    const system = `${PREAMBLE}\n\n## Sources\n${sourceSection}\n\n## Grounding instructions\n${GROUNDING}`;

    return [
      { role: 'system', content: system },
      ...history.filter(includeHistory).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      { role: 'user', content: newContent },
    ];
  }
}
