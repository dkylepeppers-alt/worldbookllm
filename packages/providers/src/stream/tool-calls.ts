/**
 * Streaming tool-call accumulation.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, public/scripts/tool-calling.js:
 * ToolManager.parseToolCalls, #applyToolCallDelta, and #getToolCallsFromData.
 * Only the first choice is tracked (worldbookllm never requests several), and
 * OpenRouter reasoning-detail signatures are not ported.
 */

/** A completed tool call in canonical OpenAI form; `arguments` is a JSON string. */
export interface StreamedToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Gemini thought signature, returned with the call so it can be sent back. */
  signature?: string;
}

type Target = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges a delta into a partial tool call: strings concatenate (argument
 * fragments), objects merge recursively, null never clears a value, and
 * prototype keys are ignored.
 */
function applyDelta(target: Target, delta: Record<string, unknown>): void {
  for (const key of Object.keys(delta)) {
    if (key === '__proto__' || key === 'constructor') continue;
    const value = delta[key];
    const current = target[key];
    if (value === null || value === undefined) {
      if (current) continue;
      target[key] = value;
    } else if (typeof value === 'string') {
      target[key] = typeof current === 'string' ? current + value : value;
    } else if (isRecord(value)) {
      if (!isRecord(current)) target[key] = {};
      applyDelta(target[key] as Target, value);
    } else {
      target[key] = value;
    }
  }
}

let fallbackIdCounter = 0;
function fallbackId(): string {
  fallbackIdCounter += 1;
  return `call_${Date.now().toString(36)}_${fallbackIdCounter}`;
}

function argumentString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '{}';
  return JSON.stringify(value);
}

/**
 * Collects tool calls from a provider's streamed chunks. Feed every parsed
 * SSE payload to `push`, then read `toolCalls()` once the stream ends.
 * Handles OpenAI-style `delta.tool_calls` fragments (every OpenAI-compatible
 * source, Mistral, DeepSeek, xAI, …), Claude `tool_use` content blocks with
 * `input_json_delta`, Gemini `functionCall` parts, and Cohere v2
 * `tool-call-*` events.
 */
export class ToolCallAccumulator {
  private readonly calls: Target[] = [];
  private readonly claudeInput = new Map<number, string>();

  private slot(index: number): Target {
    this.calls[index] ??= {};
    return this.calls[index];
  }

  push(payload: unknown): void {
    if (!isRecord(payload)) return;

    if (Array.isArray(payload.choices)) {
      for (const choice of payload.choices) {
        if (!isRecord(choice) || choice.index !== 0 || !isRecord(choice.delta)) continue;
        const deltas = choice.delta.tool_calls;
        if (!Array.isArray(deltas)) continue;
        deltas.forEach((delta, position) => {
          if (!isRecord(delta)) return;
          const index =
            typeof delta.index === 'number' && delta.index >= 0 ? delta.index : position;
          applyDelta(this.slot(index), delta);
        });
      }
    }

    const cohereEvents = ['message-start', 'tool-call-start', 'tool-call-delta', 'tool-call-end'];
    if (
      typeof payload.type === 'string' &&
      cohereEvents.includes(payload.type) &&
      isRecord(payload.delta) &&
      isRecord(payload.delta.message)
    ) {
      const index = typeof payload.index === 'number' ? payload.index : 0;
      const message = payload.delta.message;
      // Cohere nests the call under `tool_calls`; ignore message-start chunks that carry none.
      if (isRecord(message.tool_calls)) applyDelta(this.slot(index), message.tool_calls);
    }

    if (isRecord(payload.content_block) && payload.content_block.type === 'tool_use') {
      const index = typeof payload.index === 'number' ? payload.index : 0;
      applyDelta(this.slot(index), payload.content_block);
    }
    if (isRecord(payload.delta) && payload.delta.type === 'input_json_delta') {
      const index = typeof payload.index === 'number' ? payload.index : 0;
      if (this.calls[index] && typeof payload.delta.partial_json === 'string') {
        this.claudeInput.set(
          index,
          (this.claudeInput.get(index) ?? '') + payload.delta.partial_json,
        );
      }
    }
    if (payload.type === 'content_block_stop') {
      const index = typeof payload.index === 'number' ? payload.index : 0;
      const json = this.claudeInput.get(index);
      const target = this.calls[index];
      if (target && json) {
        try {
          target.input = JSON.parse(json) as unknown;
        } catch {
          // Keep the raw text; the caller reports unparseable arguments to the model.
          target.input = json;
        }
        this.claudeInput.delete(index);
      }
    }

    if (Array.isArray(payload.candidates)) {
      const candidate = payload.candidates[0];
      const parts =
        isRecord(candidate) && isRecord(candidate.content) ? candidate.content.parts : [];
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (!isRecord(part) || !isRecord(part.functionCall)) continue;
          const target = this.slot(this.calls.length);
          if (typeof part.thoughtSignature === 'string') {
            target.thoughtSignature = part.thoughtSignature;
          }
          applyDelta(target, part.functionCall);
        }
      }
    }
  }

  /** Completed calls in canonical form, in the order the model made them. */
  toolCalls(): StreamedToolCall[] {
    const result: StreamedToolCall[] = [];
    for (const call of this.calls) {
      if (!call) continue;
      const fn = isRecord(call.function) ? call.function : null;
      // Claude: { id, name, input }. Gemini: { name, args }. OpenAI and Cohere: { id, function }.
      const name =
        typeof fn?.name === 'string' ? fn.name : typeof call.name === 'string' ? call.name : '';
      if (name === '') continue;
      const args = fn ? fn.arguments : 'input' in call ? call.input : call.args;
      const pending = this.claudeInput.get(this.calls.indexOf(call));
      result.push({
        id: typeof call.id === 'string' && call.id !== '' ? call.id : fallbackId(),
        name,
        arguments: pending !== undefined && args === undefined ? pending : argumentString(args),
        ...(typeof call.thoughtSignature === 'string' ? { signature: call.thoughtSignature } : {}),
      });
    }
    return result;
  }
}
