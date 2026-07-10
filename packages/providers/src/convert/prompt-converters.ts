/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Message-format conversion for provider-native APIs.
 *
 * Ported from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/prompt-converters.js. The port is
 * near-verbatim by design: behavioral fidelity with the battle-tested
 * original beats idiomatic TypeScript here, hence the tolerant `any`
 * usage around mutated message objects.
 *
 * Changes from the original:
 * - `getPromptNames(request)` (Express-coupled) is replaced by an explicit
 *   `PromptNames` parameter (see `makePromptNames` in ../types.ts).
 * - `getConfigValue(...)` reads are replaced by constants pinned to ST's
 *   defaults: `PROMPT_PLACEHOLDER`, `MISTRAL_ENABLE_PREFIX`,
 *   `ENABLE_THOUGHT_SIGNATURES`.
 *
 * Not ported (out of scope for M1): convertClaudePrompt (deprecated,
 * token counting only), convertTextCompletionPrompt (legacy text-completion
 * models), cachingAtDepthForClaude / cachingAtDepthForOpenRouterClaude /
 * cachingSystemPromptForOpenRouter (prompt caching), embedOpenRouterMedia
 * (audio/video), addReasoningContentToToolCalls and addOpenRouterSignatures
 * (tool-calling / reasoning-signature persistence).
 */

import crypto from 'node:crypto';

import type { ChatMessage, PromptNames, ReasoningEffort } from '../types.js';

/** ST config `promptPlaceholder` default. */
export const PROMPT_PLACEHOLDER = "Let's get started.";
/** ST config `mistral.enablePrefix` default. */
const MISTRAL_ENABLE_PREFIX = false;
/** ST config `gemini.thoughtSignatures` default. */
const ENABLE_THOUGHT_SIGNATURES = true;

// 'auto' is intentionally unmapped
const GEMINI_MEDIA_RESOLUTION: Record<string, string> = {
  low: 'media_resolution_low',
  high: 'media_resolution_high',
};

export const PROMPT_PROCESSING_TYPE = {
  NONE: '',
  MERGE: 'merge',
  MERGE_TOOLS: 'merge_tools',
  SEMI: 'semi',
  SEMI_TOOLS: 'semi_tools',
  STRICT: 'strict',
  STRICT_TOOLS: 'strict_tools',
  SINGLE: 'single',
} as const;

export type PromptProcessingType =
  (typeof PROMPT_PROCESSING_TYPE)[keyof typeof PROMPT_PROCESSING_TYPE];

function tryParse(str: unknown): any {
  try {
    return JSON.parse(String(str));
  } catch {
    return undefined;
  }
}

/**
 * Adds an assistant prefix to the last message (prompt-converters.js:67).
 */
export function addAssistantPrefix(
  prompt: ChatMessage[],
  tools: unknown[] | undefined,
  property: string,
): ChatMessage[] {
  if (!prompt.length) {
    return prompt;
  }
  const hasAnyTools =
    (Array.isArray(tools) && tools.length > 0) || prompt.some((x) => x.role === 'tool');
  const last = prompt[prompt.length - 1] as any;
  if (!hasAnyTools && last.role === 'assistant') {
    last[property] = true;
  }
  return prompt;
}

/**
 * Applies a post-processing step to the generated messages (prompt-converters.js:85).
 */
export function postProcessPrompt(
  messages: ChatMessage[],
  type: PromptProcessingType,
  names: PromptNames,
): ChatMessage[] {
  switch (type) {
    case PROMPT_PROCESSING_TYPE.MERGE:
      return mergeMessages(messages, names, {
        strict: false,
        placeholders: false,
        single: false,
        tools: false,
      });
    case PROMPT_PROCESSING_TYPE.MERGE_TOOLS:
      return mergeMessages(messages, names, {
        strict: false,
        placeholders: false,
        single: false,
        tools: true,
      });
    case PROMPT_PROCESSING_TYPE.SEMI:
      return mergeMessages(messages, names, {
        strict: true,
        placeholders: false,
        single: false,
        tools: false,
      });
    case PROMPT_PROCESSING_TYPE.SEMI_TOOLS:
      return mergeMessages(messages, names, {
        strict: true,
        placeholders: false,
        single: false,
        tools: true,
      });
    case PROMPT_PROCESSING_TYPE.STRICT:
      return mergeMessages(messages, names, {
        strict: true,
        placeholders: true,
        single: false,
        tools: false,
      });
    case PROMPT_PROCESSING_TYPE.STRICT_TOOLS:
      return mergeMessages(messages, names, {
        strict: true,
        placeholders: true,
        single: false,
        tools: true,
      });
    case PROMPT_PROCESSING_TYPE.SINGLE:
      return mergeMessages(messages, names, {
        strict: true,
        placeholders: false,
        single: true,
        tools: false,
      });
    default:
      return messages;
  }
}

/**
 * Convert ChatML objects into Anthropic's Messages API format
 * (prompt-converters.js:197).
 */
export function convertClaudeMessages(
  messages: any[],
  prefillString: string,
  useSysPrompt: boolean,
  useTools: boolean,
  names: PromptNames,
): { messages: any[]; systemPrompt: any[] } {
  const systemPrompt: any[] = [];
  if (useSysPrompt) {
    // Collect all the system messages up until the first instance of a
    // non-system message, and then remove them from the messages array.
    let i;
    for (i = 0; i < messages.length; i++) {
      if (messages[i].role !== 'system') {
        break;
      }
      // Append example names if not already done by the frontend (e.g. for group chats).
      if (names.userName && messages[i].name === 'example_user') {
        if (!messages[i].content.startsWith(`${names.userName}: `)) {
          messages[i].content = `${names.userName}: ${messages[i].content}`;
        }
      }
      if (names.charName && messages[i].name === 'example_assistant') {
        if (
          !messages[i].content.startsWith(`${names.charName}: `) &&
          !names.startsWithGroupName(messages[i].content)
        ) {
          messages[i].content = `${names.charName}: ${messages[i].content}`;
        }
      }
      systemPrompt.push({ type: 'text', text: messages[i].content });
    }

    messages.splice(0, i);

    // Prevent erroring out if the messages array is empty.
    if (messages.length === 0) {
      messages.unshift({
        role: 'user',
        content: PROMPT_PLACEHOLDER,
      });
    }
  }

  // Now replace all further messages that have the role 'system' with the role
  // 'user' (or all if we're not using one).
  const parse = (str: unknown) => (typeof str === 'string' ? JSON.parse(str) : str);
  messages.forEach((message) => {
    if (message.role === 'assistant' && message.tool_calls) {
      message.content = message.tool_calls.map((tc: any) => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parse(tc.function.arguments),
      }));
    }

    if (message.role === 'tool') {
      message.role = 'user';
      message.content = [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: message.content,
        },
      ];
    }

    if (message.role === 'system') {
      if (names.userName && message.name === 'example_user') {
        if (!message.content.startsWith(`${names.userName}: `)) {
          message.content = `${names.userName}: ${message.content}`;
        }
      }
      if (names.charName && message.name === 'example_assistant') {
        if (
          !message.content.startsWith(`${names.charName}: `) &&
          !names.startsWithGroupName(message.content)
        ) {
          message.content = `${names.charName}: ${message.content}`;
        }
      }
      message.role = 'user';

      // Delete name here so it doesn't get added later
      delete message.name;
    }

    // Convert everything to an array as it would be easier to work with
    if (typeof message.content === 'string') {
      // Take care of name properties since claude messages don't support them
      if (message.name) {
        message.content = `${message.name}: ${message.content}`;
      }

      message.content = [{ type: 'text', text: message.content }];
    } else if (Array.isArray(message.content)) {
      message.content = message.content.map((content: any) => {
        if (content.type === 'image_url') {
          const imageEntry = content?.image_url;
          const imageData = imageEntry?.url;
          const mimeType = imageData?.split(';')?.[0].split(':')?.[1];
          const base64Data = imageData?.split(',')?.[1];

          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: base64Data,
            },
          };
        }

        if (content.type === 'text') {
          if (message.name) {
            content.text = `${message.name}: ${content.text}`;
          }

          // If the text is empty, replace it with a zero-width space
          return { type: 'text', text: content.text || '\u200b' };
        }

        return content;
      });
    }

    // Remove offending properties
    delete message.name;
    delete message.tool_calls;
    delete message.tool_call_id;
  });

  // Images in assistant messages should be moved to the next user message
  for (let i = 0; i < messages.length; i++) {
    if (
      messages[i].role === 'assistant' &&
      messages[i].content.some((c: any) => c.type === 'image')
    ) {
      // Find the next user message
      let j = i + 1;
      while (j < messages.length && messages[j].role !== 'user') {
        j++;
      }

      // Move the images
      if (j >= messages.length) {
        // If there is no user message after the assistant message, add a new one
        messages.splice(i + 1, 0, { role: 'user', content: [] });
      }

      messages[j].content.push(...messages[i].content.filter((c: any) => c.type === 'image'));
      messages[i].content = messages[i].content.filter((c: any) => c.type !== 'image');
    }
  }

  // Messages API expects the last role to be user unless we're explicitly prefilling
  if (prefillString) {
    messages.push({
      role: 'assistant',
      // Dangling whitespace is not allowed for prefilling
      content: [{ type: 'text', text: prefillString.trimEnd() }],
    });
  }

  // Since the messaging endpoint only supports user/assistant roles in turns,
  // we have to merge messages with the same role if they follow each other.
  const mergedMessages: any[] = [];
  messages.forEach((message) => {
    if (
      mergedMessages.length > 0 &&
      mergedMessages[mergedMessages.length - 1].role === message.role
    ) {
      mergedMessages[mergedMessages.length - 1].content.push(...message.content);
    } else {
      mergedMessages.push(message);
    }
  });

  if (!useTools) {
    mergedMessages.forEach((message) => {
      message.content.forEach((content: any) => {
        if (content.type === 'tool_use') {
          content.type = 'text';
          content.text = JSON.stringify(content.input);
          delete content.id;
          delete content.name;
          delete content.input;
        }
        if (content.type === 'tool_result') {
          content.type = 'text';
          content.text = content.content;
          delete content.tool_use_id;
          delete content.content;
        }
      });
    });
  }

  return { messages: mergedMessages, systemPrompt };
}

/**
 * Convert ChatML objects to the format used by Cohere (prompt-converters.js:384).
 */
export function convertCohereMessages(messages: any[], names: PromptNames): { chatHistory: any[] } {
  if (messages.length === 0) {
    messages.unshift({
      role: 'user',
      content: PROMPT_PLACEHOLDER,
    });
  }

  messages.forEach((msg, index) => {
    // Tool calls require an assistant primer
    if (Array.isArray(msg.tool_calls)) {
      if (index > 0 && messages[index - 1].role === 'assistant') {
        msg.content = messages[index - 1].content;
        messages.splice(index - 1, 1);
      } else {
        msg.content = `I'm going to call a tool for that: ${msg.tool_calls.map((tc: any) => tc?.function?.name).join(', ')}`;
      }
    }
    // No names support (who would've thought)
    if (msg.name) {
      if (msg.role == 'system' && msg.name == 'example_assistant') {
        if (
          names.charName &&
          !msg.content.startsWith(`${names.charName}: `) &&
          !names.startsWithGroupName(msg.content)
        ) {
          msg.content = `${names.charName}: ${msg.content}`;
        }
      }
      if (msg.role == 'system' && msg.name == 'example_user') {
        if (names.userName && !msg.content.startsWith(`${names.userName}: `)) {
          msg.content = `${names.userName}: ${msg.content}`;
        }
      }
      if (msg.role !== 'system' && !msg.content.startsWith(`${msg.name}: `)) {
        msg.content = `${msg.name}: ${msg.content}`;
      }
      delete msg.name;
    }
  });

  return { chatHistory: messages };
}

/**
 * Convert ChatML objects to the format used by Google Gemini models
 * (prompt-converters.js:432).
 */
export function convertGooglePrompt(
  messages: any[],
  model: string,
  useSysPrompt: boolean,
  names: PromptNames,
): { contents: any[]; system_instruction: { parts: { text: string }[] } } {
  const sysPrompt: string[] = [];

  if (useSysPrompt) {
    while (messages.length > 1 && messages[0].role === 'system') {
      // Append example names if not already done by the frontend (e.g. for group chats).
      if (names.userName && messages[0].name === 'example_user') {
        if (!messages[0].content.startsWith(`${names.userName}: `)) {
          messages[0].content = `${names.userName}: ${messages[0].content}`;
        }
      }
      if (names.charName && messages[0].name === 'example_assistant') {
        if (
          !messages[0].content.startsWith(`${names.charName}: `) &&
          !names.startsWithGroupName(messages[0].content)
        ) {
          messages[0].content = `${names.charName}: ${messages[0].content}`;
        }
      }
      sysPrompt.push(messages[0].content);
      messages.shift();
    }
  }

  const system_instruction = { parts: sysPrompt.map((text) => ({ text })) };
  const toolNameMap: Record<string, string> = {};

  const contents: any[] = [];
  messages.forEach((message, index) => {
    // fix the roles
    if (message.role === 'system' || message.role === 'tool') {
      message.role = 'user';
    } else if (message.role === 'assistant') {
      message.role = 'model';
    }

    // Convert the content to an array of parts
    if (!Array.isArray(message.content)) {
      const content = (() => {
        const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
        const hasToolCallId =
          typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0;

        if (hasToolCalls) {
          return { type: 'tool_calls', tool_calls: message.tool_calls };
        }

        if (hasToolCallId) {
          return {
            type: 'tool_call_id',
            tool_call_id: message.tool_call_id,
            content: String(message.content ?? ''),
          };
        }

        return { type: 'text', text: String(message.content ?? '') };
      })();
      message.content = [content];
    }

    // similar story as claude
    if (message.name) {
      message.content.forEach((part: any) => {
        if (part.type !== 'text') {
          return;
        }
        if (message.name === 'example_user') {
          if (names.userName && !part.text.startsWith(`${names.userName}: `)) {
            part.text = `${names.userName}: ${part.text}`;
          }
        } else if (message.name === 'example_assistant') {
          if (
            names.charName &&
            !part.text.startsWith(`${names.charName}: `) &&
            !names.startsWithGroupName(part.text)
          ) {
            part.text = `${names.charName}: ${part.text}`;
          }
        } else {
          if (!part.text.startsWith(`${message.name}: `)) {
            part.text = `${message.name}: ${part.text}`;
          }
        }
      });

      delete message.name;
    }

    // create the prompt parts
    const parts: any[] = [];
    message.content.forEach((part: any) => {
      const addDataUrlPart = (
        url: string,
        defaultMimeType: string,
        detail: string | null = null,
      ) => {
        if (url && url.startsWith('data:')) {
          const [header, base64Data] = url.split(',');
          const mimeType = header?.match(/data:([^;]+)/)?.[1] || defaultMimeType;
          const mediaResolution = (detail && GEMINI_MEDIA_RESOLUTION[detail]) || null;

          const newPart: any = {
            inlineData: {
              mimeType: mimeType,
              data: base64Data,
            },
          };

          // https://ai.google.dev/gemini-api/docs/gemini-3#media_resolution
          if (/gemini-3/.test(model) && mediaResolution) {
            newPart.mediaResolution = {
              level: mediaResolution,
            };
          }

          parts.push(newPart);
        }
      };

      if (part.type === 'text') {
        parts.push({ text: part.text });
      } else if (part.type === 'tool_call_id') {
        const name = toolNameMap[part.tool_call_id] ?? 'unknown';
        parts.push({
          functionResponse: {
            name: name,
            response: { name: name, content: part.content },
          },
        });
      } else if (part.type === 'tool_calls') {
        part.tool_calls.forEach((toolCall: any) => {
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: tryParse(toolCall.function.arguments) ?? toolCall.function.arguments,
            },
            ...(toolCall.signature ? { thoughtSignature: toolCall.signature } : {}),
          });

          toolNameMap[toolCall.id] = toolCall.function.name;
        });
      } else if (part.type === 'image_url') {
        const imageUrl = part.image_url?.url;
        const detail = part.image_url?.detail;
        addDataUrlPart(imageUrl, 'image/png', detail);
      } else if (part.type === 'video_url') {
        const videoUrl = part.video_url?.url;
        const detail = part.video_url?.detail;
        addDataUrlPart(videoUrl, 'video/mp4', detail);
      } else if (part.type === 'audio_url') {
        const audioUrl = part.audio_url?.url;
        addDataUrlPart(audioUrl, 'audio/mpeg');
      }
    });

    // https://ai.google.dev/gemini-api/docs/gemini-3#migrating_from_other_models
    // Inject stored thought signatures, or fall back to bypass magic for Gemini 3
    if (/gemini-3/.test(model) || /gemini-2\.5/.test(model)) {
      const skipSignatureMagic = 'skip_thought_signature_validator';
      const textSignature = message.signature;

      parts.forEach((part) => {
        if (ENABLE_THOUGHT_SIGNATURES && textSignature && typeof part.text === 'string') {
          part.thoughtSignature = textSignature;
        } else if (/gemini-3/.test(model)) {
          // Gemini 3: Fall back to bypass magic for function calls (mandatory) and images
          if (part.functionCall && !part.thoughtSignature) {
            part.thoughtSignature = skipSignatureMagic;
          }
          if (/-image/.test(model) && message.role === 'model') {
            if (typeof part.text === 'string' || part.inlineData) {
              part.thoughtSignature = skipSignatureMagic;
            }
          }
        }
        // Gemini 2.5 without stored signatures: signatures are optional, no bypass needed
      });
    }

    // merge consecutive messages with the same role
    if (index > 0 && message.role === contents[contents.length - 1].role) {
      parts.forEach((part) => {
        if (part.text) {
          const textPart = contents[contents.length - 1].parts.find(
            (p: any) => typeof p.text === 'string',
          );
          if (textPart) {
            textPart.text += '\n\n' + part.text;
          } else {
            contents[contents.length - 1].parts.push(part);
          }
        }
        if (
          part.inlineData ||
          part.functionCall ||
          part.functionResponse ||
          part.thoughtSignature ||
          part.mediaResolution
        ) {
          contents[contents.length - 1].parts.push(part);
        }
      });
    } else {
      contents.push({
        role: message.role,
        parts: parts,
      });
    }
  });

  return { contents, system_instruction };
}

/**
 * Convert AI21 prompt: system message squash, user/assistant message merge
 * (prompt-converters.js:627).
 */
export function convertAI21Messages(messages: any[], names: PromptNames): any[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  // Collect all the system messages up until the first instance of a
  // non-system message, and then remove them from the messages array.
  let i = 0,
    systemPrompt = '';

  for (i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'system') {
      break;
    }
    // Append example names if not already done by the frontend (e.g. for group chats).
    if (names.userName && messages[i].name === 'example_user') {
      if (!messages[i].content.startsWith(`${names.userName}: `)) {
        messages[i].content = `${names.userName}: ${messages[i].content}`;
      }
    }
    if (names.charName && messages[i].name === 'example_assistant') {
      if (
        !messages[i].content.startsWith(`${names.charName}: `) &&
        !names.startsWithGroupName(messages[i].content)
      ) {
        messages[i].content = `${names.charName}: ${messages[i].content}`;
      }
    }
    systemPrompt += `${messages[i].content}\n\n`;
  }

  messages.splice(0, i);

  // Prevent erroring out if the messages array is empty.
  if (messages.length === 0) {
    messages.unshift({
      role: 'user',
      content: PROMPT_PLACEHOLDER,
    });
  }

  if (systemPrompt) {
    messages.unshift({
      role: 'system',
      content: systemPrompt.trim(),
    });
  }

  // Doesn't support completion names, so prepend if not already done by the frontend.
  messages.forEach((msg) => {
    if ('name' in msg) {
      if (msg.role !== 'system' && !msg.content.startsWith(`${msg.name}: `)) {
        msg.content = `${msg.name}: ${msg.content}`;
      }
      delete msg.name;
    }
  });

  // Since the messaging endpoint only supports alternating turns, we have to
  // merge messages with the same role if they follow each other.
  const mergedMessages: any[] = [];
  messages.forEach((message) => {
    if (
      mergedMessages.length > 0 &&
      mergedMessages[mergedMessages.length - 1].role === message.role
    ) {
      mergedMessages[mergedMessages.length - 1].content += '\n\n' + message.content;
    } else {
      mergedMessages.push(message);
    }
  });

  return mergedMessages;
}

/**
 * Convert ChatML objects to the format used by MistralAI (prompt-converters.js:699).
 */
export function convertMistralMessages(messages: any[], names: PromptNames): any[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  // Make the last assistant message a prefill
  const prefixEnabled = MISTRAL_ENABLE_PREFIX;
  const lastMsg = messages[messages.length - 1];
  if (prefixEnabled && messages.length > 0 && lastMsg?.role === 'assistant') {
    lastMsg.prefix = true;
  }

  const sanitizeToolId = (id: string) =>
    crypto.createHash('sha512').update(id).digest('hex').slice(0, 9);

  // Doesn't support completion names, so prepend if not already done by the frontend.
  messages.forEach((msg) => {
    if ('tool_calls' in msg && Array.isArray(msg.tool_calls)) {
      msg.tool_calls.forEach((tool: any) => {
        tool.id = sanitizeToolId(tool.id);
      });
    }
    if ('tool_call_id' in msg && msg.role === 'tool') {
      msg.tool_call_id = sanitizeToolId(msg.tool_call_id);
    }
    if (msg.role === 'system' && msg.name === 'example_assistant') {
      if (
        names.charName &&
        !msg.content.startsWith(`${names.charName}: `) &&
        !names.startsWithGroupName(msg.content)
      ) {
        msg.content = `${names.charName}: ${msg.content}`;
      }
      delete msg.name;
    }
    if (msg.role === 'system' && msg.name === 'example_user') {
      if (names.userName && !msg.content.startsWith(`${names.userName}: `)) {
        msg.content = `${names.userName}: ${msg.content}`;
      }
      delete msg.name;
    }

    if (msg.name && msg.role !== 'system' && !msg.content.startsWith(`${msg.name}: `)) {
      msg.content = `${msg.name}: ${msg.content}`;
      delete msg.name;
    }
  });

  // If user role message immediately follows a tool message, append it to the last user message
  const fixToolMessages = () => {
    let rerun = true;
    while (rerun) {
      rerun = false;
      messages.forEach((message, i) => {
        if (i === messages.length - 1) {
          return;
        }
        if (message.role === 'tool' && messages[i + 1].role === 'user') {
          const lastUserMessage = messages
            .slice(0, i)
            .findLastIndex((m) => m.role === 'user' && m.content);
          if (lastUserMessage !== -1) {
            messages[lastUserMessage].content += '\n\n' + messages[i + 1].content;
            messages.splice(i + 1, 1);
            rerun = true;
          }
        }
      });
    }
  };
  fixToolMessages();

  // If system role message immediately follows an assistant message, change its role to user
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === 'assistant' && messages[i + 1].role === 'system') {
      messages[i + 1].role = 'user';
    }
  }

  return messages;
}

/**
 * Convert messages to the format used by xAI (prompt-converters.js:781).
 */
export function convertXAIMessages(messages: any[], names: PromptNames): any[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  messages.forEach((msg) => {
    if (!msg.name || msg.role === 'user') {
      return;
    }

    const needsCharNamePrefix = [
      {
        role: 'assistant',
        condition:
          names.charName &&
          !msg.content.startsWith(`${names.charName}: `) &&
          !names.startsWithGroupName(msg.content),
      },
      {
        role: 'system',
        name: 'example_assistant',
        condition:
          names.charName &&
          !msg.content.startsWith(`${names.charName}: `) &&
          !names.startsWithGroupName(msg.content),
      },
      {
        role: 'system',
        name: 'example_user',
        condition: names.userName && !msg.content.startsWith(`${names.userName}: `),
      },
    ];

    const matchingRule = needsCharNamePrefix.find(
      (rule) =>
        msg.role === rule.role && (!('name' in rule) || msg.name === rule.name) && rule.condition,
    );

    if (matchingRule) {
      const prefix =
        msg.role === 'system' && msg.name === 'example_user' ? names.userName : names.charName;
      msg.content = `${prefix}: ${msg.content}`;
    }

    delete msg.name;
  });

  return messages;
}

/**
 * Merge messages with the same consecutive role, removing names if they exist
 * (prompt-converters.js:823).
 */
export function mergeMessages(
  messages: any[],
  names: PromptNames,
  {
    strict = false,
    placeholders = false,
    single = false,
    tools = false,
  }: { strict?: boolean; placeholders?: boolean; single?: boolean; tools?: boolean } = {},
): any[] {
  const mergedMessages: any[] = [];

  const contentTokens = new Map<string, any>();

  // Remove names from the messages
  messages.forEach((message) => {
    if (!message.content) {
      message.content = '';
    }
    // Flatten contents and replace media parts with random tokens
    if (Array.isArray(message.content)) {
      const text = message.content
        .map((content: any) => {
          if (content.type === 'text') {
            return content.text;
          }
          // Could be extended with other non-text types
          if (['image_url', 'video_url', 'audio_url'].includes(content.type)) {
            const token = crypto.randomBytes(32).toString('base64');
            contentTokens.set(token, content);
            return token;
          }
          return '';
        })
        .join('\n\n');
      message.content = text;
    }
    if (message.role === 'system' && message.name === 'example_assistant') {
      if (
        names.charName &&
        !message.content.startsWith(`${names.charName}: `) &&
        !names.startsWithGroupName(message.content)
      ) {
        message.content = `${names.charName}: ${message.content}`;
      }
    }
    if (message.role === 'system' && message.name === 'example_user') {
      if (names.userName && !message.content.startsWith(`${names.userName}: `)) {
        message.content = `${names.userName}: ${message.content}`;
      }
    }
    if (message.name && message.role !== 'system') {
      if (!message.content.startsWith(`${message.name}: `)) {
        message.content = `${message.name}: ${message.content}`;
      }
    }
    if (message.role === 'tool' && !tools) {
      message.role = 'user';
    }
    if (single) {
      if (message.role === 'assistant') {
        if (
          names.charName &&
          !message.content.startsWith(`${names.charName}: `) &&
          !names.startsWithGroupName(message.content)
        ) {
          message.content = `${names.charName}: ${message.content}`;
        }
      }
      if (message.role === 'user') {
        if (names.userName && !message.content.startsWith(`${names.userName}: `)) {
          message.content = `${names.userName}: ${message.content}`;
        }
      }

      message.role = 'user';
    }
    delete message.name;
    if (!tools) {
      delete message.tool_calls;
      delete message.tool_call_id;
    }
  });

  // Squash consecutive messages with the same role
  messages.forEach((message) => {
    if (
      mergedMessages.length > 0 &&
      mergedMessages[mergedMessages.length - 1].role === message.role &&
      message.content &&
      message.role !== 'tool'
    ) {
      mergedMessages[mergedMessages.length - 1].content += '\n\n' + message.content;
    } else {
      mergedMessages.push(message);
    }
  });

  // Prevent erroring out if the mergedMessages array is empty.
  if (mergedMessages.length === 0) {
    mergedMessages.unshift({
      role: 'user',
      content: PROMPT_PLACEHOLDER,
    });
  }

  // Check for content tokens and replace them with the actual content objects
  if (contentTokens.size > 0) {
    mergedMessages.forEach((message) => {
      const hasValidToken = Array.from(contentTokens.keys()).some((token) =>
        message.content.includes(token),
      );

      if (hasValidToken) {
        const splitContent: string[] = message.content.split('\n\n');
        const mergedContent: any[] = [];

        splitContent.forEach((content) => {
          if (contentTokens.has(content)) {
            mergedContent.push(contentTokens.get(content));
          } else {
            if (
              mergedContent.length > 0 &&
              mergedContent[mergedContent.length - 1].type === 'text'
            ) {
              mergedContent[mergedContent.length - 1].text += `\n\n${content}`;
            } else {
              mergedContent.push({ type: 'text', text: content });
            }
          }
        });

        message.content = mergedContent;
      }
    });
  }

  if (strict) {
    for (let i = 0; i < mergedMessages.length; i++) {
      // Force mid-prompt system messages to be user messages
      if (i > 0 && mergedMessages[i].role === 'system') {
        mergedMessages[i].role = 'user';
      }
    }
    if (mergedMessages.length && placeholders) {
      if (
        mergedMessages[0].role === 'system' &&
        (mergedMessages.length === 1 || mergedMessages[1].role !== 'user')
      ) {
        mergedMessages.splice(1, 0, { role: 'user', content: PROMPT_PLACEHOLDER });
      } else if (mergedMessages[0].role !== 'system' && mergedMessages[0].role !== 'user') {
        mergedMessages.unshift({ role: 'user', content: PROMPT_PLACEHOLDER });
      }
    }
    return mergeMessages(mergedMessages, names, {
      strict: false,
      placeholders,
      single: false,
      tools,
    });
  }

  return mergedMessages;
}

/**
 * Calculate the Claude budget tokens for a given reasoning effort
 * (prompt-converters.js:1120). Returns a string effort level for adaptive
 * thinking models, a number for traditional thinking, or null for auto.
 */
export function calculateClaudeBudgetTokens(
  maxTokens: number,
  reasoningEffort: ReasoningEffort,
  stream: boolean,
  isAdaptiveModel: boolean,
): number | string | null {
  // Adaptive thinking: return effort string (like Gemini 3)
  if (isAdaptiveModel) {
    switch (reasoningEffort) {
      case 'auto':
        return null;
      case 'min':
        return 'low';
      case 'low':
        return 'low';
      case 'medium':
        return 'medium';
      case 'high':
        return 'high';
      case 'max':
        return 'max';
    }
    return null;
  }

  let budgetTokens = 0;

  switch (reasoningEffort) {
    case 'auto':
      return null;
    case 'min':
      budgetTokens = 1024;
      break;
    case 'low':
      budgetTokens = Math.floor(maxTokens * 0.1);
      break;
    case 'medium':
      budgetTokens = Math.floor(maxTokens * 0.25);
      break;
    case 'high':
      budgetTokens = Math.floor(maxTokens * 0.5);
      break;
    case 'max':
      budgetTokens = Math.floor(maxTokens * 0.95);
      break;
  }

  budgetTokens = Math.max(budgetTokens, 1024);

  if (!stream) {
    budgetTokens = Math.min(budgetTokens, 21333);
  }

  return budgetTokens;
}

/**
 * Calculate the Google budget tokens for a given reasoning effort
 * (prompt-converters.js:1178).
 */
export function calculateGoogleBudgetTokens(
  maxTokens: number,
  reasoningEffort: ReasoningEffort,
  model: string,
): number | string | null {
  function getFlashBudget(): number {
    let budgetTokens = 0;

    switch (reasoningEffort) {
      case 'auto':
        return -1;
      case 'min':
        return 0;
      case 'low':
        budgetTokens = Math.floor(maxTokens * 0.1);
        break;
      case 'medium':
        budgetTokens = Math.floor(maxTokens * 0.25);
        break;
      case 'high':
        budgetTokens = Math.floor(maxTokens * 0.5);
        break;
      case 'max':
        budgetTokens = maxTokens;
        break;
    }

    budgetTokens = Math.min(budgetTokens, 24576);

    return budgetTokens;
  }

  function getFlashLiteBudget(): number {
    let budgetTokens = 0;

    switch (reasoningEffort) {
      case 'auto':
        return -1;
      case 'min':
        return 0;
      case 'low':
        budgetTokens = Math.floor(maxTokens * 0.1);
        break;
      case 'medium':
        budgetTokens = Math.floor(maxTokens * 0.25);
        break;
      case 'high':
        budgetTokens = Math.floor(maxTokens * 0.5);
        break;
      case 'max':
        budgetTokens = maxTokens;
        break;
    }

    budgetTokens = Math.max(Math.min(budgetTokens, 24576), 512);

    return budgetTokens;
  }

  function getProBudget(): number {
    let budgetTokens = 0;

    switch (reasoningEffort) {
      case 'auto':
        return -1;
      case 'min':
        budgetTokens = 128;
        break;
      case 'low':
        budgetTokens = Math.floor(maxTokens * 0.1);
        break;
      case 'medium':
        budgetTokens = Math.floor(maxTokens * 0.25);
        break;
      case 'high':
        budgetTokens = Math.floor(maxTokens * 0.5);
        break;
      case 'max':
        budgetTokens = maxTokens;
        break;
    }

    budgetTokens = Math.max(Math.min(budgetTokens, 32768), 128);

    return budgetTokens;
  }

  function getGemini3FlashBudget(): string | null {
    switch (reasoningEffort) {
      case 'auto':
        return null;
      case 'min':
        return 'minimal';
      case 'low':
        return 'low';
      case 'medium':
        return 'medium';
      case 'high':
        return 'high';
      case 'max':
        return 'high';
    }

    return null;
  }

  function getGemini3ProBudget(): string | null {
    switch (reasoningEffort) {
      case 'auto':
        return null;
      case 'min':
        return 'low';
      case 'low':
        return 'low';
      case 'medium':
        return 'low';
      case 'high':
        return 'high';
      case 'max':
        return 'high';
    }

    return null;
  }

  if (/gemini-3[.\d]*-pro/.test(model)) {
    return getGemini3ProBudget();
  }

  if (/gemini-3[.\d]*-flash/.test(model)) {
    return getGemini3FlashBudget();
  }

  if (/flash-lite/.test(model)) {
    return getFlashLiteBudget();
  }

  if (/flash/.test(model)) {
    return getFlashBudget();
  }

  if (/pro/.test(model)) {
    return getProBudget();
  }

  return null;
}
