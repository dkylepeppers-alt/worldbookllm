import { describe, expect, it } from 'vitest';

import type {
  ChatCompletionSource,
  ChatMessage,
  GenerationParams,
  ToolDefinition,
} from '../../types.js';
import { buildChatRequest } from '../build-request.js';
import { flattenSchema, supportsTools } from '../tools.js';

const readFileTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read a book file.',
    parameters: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { path: { $ref: '#/$defs/path' } },
      required: ['path'],
      additionalProperties: false,
      $defs: { path: { type: 'string', default: 'story.md' } },
    },
  },
};

const noArgsTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_files',
    description: 'List files.',
    parameters: { type: 'object', properties: {} },
  },
};

const params = (overrides: Partial<GenerationParams> = {}): GenerationParams => ({
  model: 'test-model',
  messages: [{ role: 'user', content: 'Who is Mara?' }],
  stream: true,
  apiKey: 'test-key',
  maxTokens: 512,
  ...overrides,
});

describe('supportsTools', () => {
  it('follows SillyTavern’s tool-calling source list', () => {
    for (const source of [
      'openai',
      'claude',
      'makersuite',
      'nanogpt',
      'custom',
      'cohere',
    ] as const) {
      expect(supportsTools(source)).toBe(true);
    }
    expect(supportsTools('perplexity')).toBe(false);
  });
});

describe('OpenAI-shaped tool fields', () => {
  it.each<ChatCompletionSource>([
    'openai',
    'nanogpt',
    'openrouter',
    'custom',
    'deepseek',
    'mistralai',
    'xai',
  ])('%s passes tools through with tool_choice defaulting to auto', (source) => {
    const body = buildChatRequest(
      source,
      params({ tools: [readFileTool], baseUrl: 'http://localhost:1' }),
    ).body;
    expect(body.tools).toEqual([readFileTool]);
    expect(body.tool_choice).toBe('auto');
  });

  it('adds nothing without tools', () => {
    const body = buildChatRequest('openai', params()).body;
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('forwards an explicit tool choice', () => {
    const toolChoice = { type: 'function', function: { name: 'read_file' } } as const;
    expect(
      buildChatRequest('openai', params({ tools: [readFileTool], toolChoice })).body.tool_choice,
    ).toEqual(toolChoice);
  });

  it('keeps assistant tool calls and tool results in the messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Who is Mara?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"x.md"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'Mara is the keeper.' },
    ];
    const body = buildChatRequest('openai', params({ messages, tools: [readFileTool] })).body;
    expect(body.messages).toEqual(messages);
  });

  it('gives AI21 tools without tool_choice and strips $schema for Cohere', () => {
    const ai21 = buildChatRequest('ai21', params({ tools: [readFileTool] })).body;
    expect(ai21.tools).toEqual([readFileTool]);
    expect(ai21).not.toHaveProperty('tool_choice');

    const cohere = buildChatRequest('cohere', params({ tools: [readFileTool] })).body;
    const [tool] = cohere.tools as ToolDefinition[];
    expect(tool?.function.parameters).not.toHaveProperty('$schema');
    expect(readFileTool.function.parameters).toHaveProperty('$schema');
  });
});

describe('Claude tool fields', () => {
  it('maps tools to input_schema, translates tool_choice, and adds the tools beta', () => {
    const request = buildChatRequest(
      'claude',
      params({
        model: 'claude-3-5-sonnet-20241022',
        tools: [readFileTool],
        toolChoice: 'required',
      }),
    );
    expect(request.headers['anthropic-beta']).toContain('tools-2024-05-16');
    expect(request.body.tool_choice).toEqual({ type: 'any' });
    expect(request.body.tools).toEqual([
      {
        name: 'read_file',
        description: 'Read a book file.',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string', default: 'story.md' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ]);
  });

  it('converts tool calls and results into tool_use and tool_result blocks', () => {
    const request = buildChatRequest(
      'claude',
      params({
        model: 'claude-3-5-sonnet-20241022',
        tools: [readFileTool],
        messages: [
          { role: 'user', content: 'Who is Mara?' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'toolu_1', function: { name: 'read_file', arguments: '{"path":"x.md"}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'toolu_1', content: 'Mara is the keeper.' },
        ],
      }),
    );
    const messages = request.body.messages as Array<{ role: string; content: unknown[] }>;
    expect(messages[1]?.content).toContainEqual({
      type: 'tool_use',
      id: 'toolu_1',
      name: 'read_file',
      input: { path: 'x.md' },
    });
    expect(messages[2]?.content).toContainEqual(
      expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_1' }),
    );
  });

  it('leaves the request unchanged without tools', () => {
    const request = buildChatRequest('claude', params({ model: 'claude-3-5-sonnet-20241022' }));
    expect(request.headers['anthropic-beta']).not.toContain('tools');
    expect(request.body).not.toHaveProperty('tools');
  });
});

describe('Google tool fields', () => {
  it('declares functions and translates tool_choice', () => {
    const body = buildChatRequest(
      'makersuite',
      params({ model: 'gemini-2.0-flash', tools: [readFileTool, noArgsTool], toolChoice: 'none' }),
    ).body;
    const [declarations] = body.tools as Array<{
      function_declarations: Array<Record<string, unknown>>;
    }>;
    expect(declarations?.function_declarations.map((entry) => entry.name)).toEqual([
      'read_file',
      'list_files',
    ]);
    expect(declarations?.function_declarations[0]?.parameters).not.toHaveProperty('$schema');
    expect(declarations?.function_declarations[1]).not.toHaveProperty('parameters');
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });
  });

  it('forces a named function and skips Gemma 3', () => {
    const forced = buildChatRequest(
      'makersuite',
      params({
        model: 'gemini-2.0-flash',
        tools: [readFileTool],
        toolChoice: { type: 'function', function: { name: 'read_file' } },
      }),
    ).body;
    expect(forced.toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['read_file'] },
    });
    const gemma = buildChatRequest(
      'makersuite',
      params({ model: 'gemma-3-27b-it', tools: [readFileTool] }),
    ).body;
    expect(gemma).not.toHaveProperty('tools');
  });
});

describe('flattenSchema', () => {
  it('inlines $defs, survives cycles, and drops Google-rejected keywords for Google', () => {
    const schema = {
      type: 'object',
      properties: { node: { $ref: '#/$defs/node' } },
      additionalProperties: false,
      $defs: { node: { type: 'object', properties: { child: { $ref: '#/$defs/node' } } } },
    };
    expect(flattenSchema(schema, 'makersuite')).toEqual({
      type: 'object',
      properties: { node: { type: 'object', properties: { child: {} } } },
    });
    expect(flattenSchema(schema, 'claude')).toMatchObject({ additionalProperties: false });
  });
});
