/**
 * Tool (function) calling request fields.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488: src/endpoints/backends/chat-completions.js
 * (per-source `tools`/`tool_choice` shaping), src/util.js (flattenSchema), and
 * public/scripts/tool-calling.js (ToolManager.isToolCallingSupported).
 * Not ported: web search and other non-function tools, JSON-schema output via
 * forced tools, prompt caching of tool definitions, and model-list based
 * capability checks (callers decide per model).
 */

import type { ChatCompletionSource, GenerationParams, ToolChoice } from '../types.js';

/** Sources SillyTavern allows function calling for (ToolManager.isToolCallingSupported). */
const TOOL_CALLING_SOURCES: ReadonlySet<ChatCompletionSource> = new Set<ChatCompletionSource>([
  'openai',
  'custom',
  'mistralai',
  'claude',
  'openrouter',
  'aimlapi',
  'groq',
  'cohere',
  'deepseek',
  'makersuite',
  'vertexai',
  'ai21',
  'xai',
  'pollinations',
  'moonshot',
  'fireworks',
  'cometapi',
  'chutes',
  'electronhub',
  'azure_openai',
  'zai',
  'siliconflow',
  'nanogpt',
  'workers_ai',
  'minimax',
]);

/**
 * Whether a source accepts function tools at all. Individual models on
 * aggregator sources (OpenRouter, Mistral, …) may still lack support.
 */
export function supportsTools(source: ChatCompletionSource): boolean {
  return TOOL_CALLING_SOURCES.has(source);
}

function hasTools(params: GenerationParams): boolean {
  return Array.isArray(params.tools) && params.tools.length > 0;
}

/** `tools` and `tool_choice` for providers that take the OpenAI shape unchanged. */
export function openAiToolFields(params: GenerationParams): Record<string, unknown> {
  if (!hasTools(params)) return {};
  return { tools: params.tools, tool_choice: params.toolChoice ?? 'auto' };
}

/** AI21 takes `tools` but no `tool_choice`. */
export function ai21ToolFields(params: GenerationParams): Record<string, unknown> {
  return hasTools(params) ? { tools: params.tools } : {};
}

/** Cohere v2 takes OpenAI-shaped tools without a `$schema` key. */
export function cohereTools(params: GenerationParams): unknown[] {
  if (!hasTools(params)) return [];
  return structuredClone(params.tools ?? []).map((tool) => {
    delete tool.function.parameters?.$schema;
    return tool;
  });
}

/**
 * Anthropic's tool_choice: SillyTavern forwards `{ type: <choice> }`; the
 * API names "required" `any` and a forced tool `{ type: 'tool', name }`.
 */
function claudeToolChoice(choice: ToolChoice | undefined): Record<string, unknown> {
  if (choice === undefined || choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  return { type: 'tool', name: choice.function.name };
}

export function claudeToolFields(params: GenerationParams): Record<string, unknown> {
  if (!hasTools(params)) return {};
  return {
    tool_choice: claudeToolChoice(params.toolChoice),
    tools: (params.tools ?? [])
      .filter((tool) => tool.type === 'function')
      .map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: flattenSchema(tool.function.parameters, 'claude'),
      })),
  };
}

/** Gemini's `tools.function_declarations` and `toolConfig.functionCallingConfig`. */
export function googleToolFields(params: GenerationParams): Record<string, unknown> {
  if (!hasTools(params)) return {};
  const functionDeclarations = structuredClone(params.tools ?? [])
    .filter((tool) => tool.type === 'function')
    .map((tool) => {
      const declaration: Record<string, unknown> = { ...tool.function };
      const parameters = tool.function.parameters;
      if (parameters) {
        delete parameters.$schema;
        const properties = parameters.properties;
        if (
          typeof properties === 'object' &&
          properties !== null &&
          Object.keys(properties).length === 0
        ) {
          delete declaration.parameters;
        }
      }
      return declaration;
    });
  if (functionDeclarations.length === 0) return {};

  const fields: Record<string, unknown> = {
    tools: [{ function_declarations: functionDeclarations }],
  };
  const choice = params.toolChoice;
  let functionCallingConfig: Record<string, unknown> | undefined;
  if (choice === 'none') functionCallingConfig = { mode: 'NONE' };
  else if (choice === 'required') functionCallingConfig = { mode: 'ANY' };
  else if (choice === 'auto') functionCallingConfig = { mode: 'AUTO' };
  else if (typeof choice === 'object') {
    functionCallingConfig = { mode: 'ANY', allowedFunctionNames: [choice.function.name] };
  }
  if (functionCallingConfig) fields.toolConfig = { functionCallingConfig };
  return fields;
}

/**
 * Inlines `$defs` references (guarding against cycles) and drops `$schema`;
 * for Google APIs, also drops keywords Gemini rejects.
 */
export function flattenSchema(schema: unknown, source: ChatCompletionSource): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  const schemaCopy = structuredClone(schema) as Record<string, unknown>;
  const isGoogleApi = source === 'vertexai' || source === 'makersuite';
  const definitions = (schemaCopy.$defs ?? {}) as Record<string, unknown>;
  delete schemaCopy.$defs;

  function resolve(object: unknown, parents: string[] = []): unknown {
    if (!object || typeof object !== 'object') return object;
    if (Array.isArray(object)) return object.map((item) => resolve(item, parents));
    const record = object as Record<string, unknown>;
    const ref = record.$ref;
    if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
      const name = ref.split('/').pop() ?? '';
      if (parents.includes(name)) return {};
      const definition = definitions[name];
      return definition ? resolve(structuredClone(definition), [...parents, name]) : {};
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      if (
        isGoogleApi &&
        ['default', 'additionalProperties', 'exclusiveMinimum', 'propertyNames'].includes(key)
      ) {
        continue;
      }
      result[key] = resolve(record[key], parents);
    }
    return result;
  }

  const flattened = resolve(schemaCopy) as Record<string, unknown>;
  delete flattened.$schema;
  return flattened;
}
