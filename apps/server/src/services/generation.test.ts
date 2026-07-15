import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StreamEvent } from '@worldbookllm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { ConflictError, ConfigurationError } from '../errors.js';
import { SourceFileStore } from '../files/source-files.js';
import { ProviderHttpClient } from '../providers/http-client.js';
import { SecretStore } from '../secrets/secret-store.js';
import { ChatService } from './chats.js';
import { GenerationService } from './generation.js';
import { NotebookService } from './notebooks.js';
import { PromptAssembler } from './prompt-assembler.js';
import { ProviderService } from './providers.js';
import { SourceService } from './sources.js';

const tempDirs: string[] = [];

function setup(fetchImpl: typeof fetch, withConfig = true) {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-generation-'));
  tempDirs.push(dataDir);
  const db = openDatabase(dataDir);
  const files = new SourceFileStore(dataDir);
  const notebooks = new NotebookService(db, files);
  const sources = new SourceService(db, files);
  const chats = new ChatService(db);
  const secrets = new SecretStore(dataDir);
  const providers = new ProviderService(secrets, new ProviderHttpClient(fetchImpl));
  const notebook = notebooks.create({
    name: 'Atlas',
    settings: withConfig
      ? { source: 'custom', model: 'local', baseUrl: 'http://provider.test/v1' }
      : null,
  });
  const source = sources.create(notebook.id, { title: 'Lore', content: 'Amber is canon.' });
  const chat = chats.create(notebook.id, {
    title: 'Chat',
    sourceIds: [source.id],
    providerOverride: null,
    presetId: null,
  });
  const generation = new GenerationService(
    chats,
    notebooks,
    new PromptAssembler(sources),
    providers,
  );
  return { db, chats, chat, generation };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('GenerationService', () => {
  it('prepares a grounded exchange and rejects concurrent generation', () => {
    const { db, chats, chat, generation } = setup(async () =>
      Promise.reject(new Error('not called')),
    );
    const prepared = generation.prepare(chat.id, 'Question');
    expect(prepared).toMatchObject({ source: 'custom', assistant: { status: 'interrupted' } });
    expect(chats.getDetail(chat.id).messages).toHaveLength(2);
    expect(prepared.request.body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Amber is canon.'),
        }),
        { role: 'user', content: 'Question' },
      ]),
    );
    expect(() => generation.prepare(chat.id, 'Again')).toThrow(ConflictError);
    prepared.release();
    expect(() => generation.prepare(chat.id, 'Again')).not.toThrow();
    db.close();
  });

  it('fails preflight without inserting messages when config is missing', () => {
    const { db, chats, chat, generation } = setup(
      async () => Promise.reject(new Error('not called')),
      false,
    );
    expect(() => generation.prepare(chat.id, 'Question')).toThrow(ConfigurationError);
    expect(chats.getDetail(chat.id).messages).toEqual([]);
    db.close();
  });

  it('normalizes deltas, persists before emit, and completes', async () => {
    const upstream = [
      'data: {"choices":[{"delta":{"content":"Am"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ber","reasoning":"thought"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const { db, chats, chat, generation } = setup(async () =>
      Promise.resolve(new Response(upstream)),
    );
    const prepared = generation.prepare(chat.id, 'Question');
    const events: StreamEvent[] = [];
    await generation.stream(prepared, new AbortController().signal, (event) => {
      const persisted = chats.getDetail(chat.id).messages.at(-1);
      if (event.type === 'delta') expect(persisted?.content.length).toBeGreaterThan(0);
      events.push(event);
    });
    prepared.release();
    expect(events).toEqual([
      { type: 'delta', text: 'Am' },
      { type: 'delta', text: 'ber', reasoning: 'thought' },
      {
        type: 'done',
        message: expect.objectContaining({
          content: 'Amber',
          reasoning: 'thought',
          status: 'complete',
        }),
      },
    ]);
    db.close();
  });

  it('persists provider failures as error events', async () => {
    const { db, chats, chat, generation } = setup(async () =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 500 })),
    );
    const prepared = generation.prepare(chat.id, 'Question');
    const events: StreamEvent[] = [];
    await generation.stream(prepared, new AbortController().signal, (event) => events.push(event));
    prepared.release();
    expect(events).toEqual([
      expect.objectContaining({
        type: 'error',
        code: 'provider_error',
        message: 'Provider generation failed',
      }),
    ]);
    expect(chats.getDetail(chat.id).messages.at(-1)).toMatchObject({ status: 'error' });
    db.close();
  });

  it('keeps partial content interrupted when the client aborts', async () => {
    const controller = new AbortController();
    const fetchImpl: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Part"}}]}\n\n'),
          );
          signal?.addEventListener('abort', () => streamController.error(new Error('aborted')), {
            once: true,
          });
        },
      });
      return Promise.resolve(new Response(body));
    };
    const { db, chats, chat, generation } = setup(fetchImpl);
    const prepared = generation.prepare(chat.id, 'Question');
    const events: StreamEvent[] = [];
    await generation.stream(prepared, controller.signal, (event) => {
      events.push(event);
      if (event.type === 'delta') controller.abort();
    });
    prepared.release();
    expect(events).toEqual([{ type: 'delta', text: 'Part' }]);
    expect(chats.getDetail(chat.id).messages.at(-1)).toMatchObject({
      content: 'Part',
      status: 'interrupted',
    });
    db.close();
  });

  it('treats an empty provider stream as an error', async () => {
    const { db, chats, chat, generation } = setup(async () =>
      Promise.resolve(new Response('data: [DONE]\n\n')),
    );
    const prepared = generation.prepare(chat.id, 'Question');
    const events: StreamEvent[] = [];
    await generation.stream(prepared, new AbortController().signal, (event) => events.push(event));
    prepared.release();
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'provider_error' })]);
    expect(chats.getDetail(chat.id).messages.at(-1)).toMatchObject({ status: 'error' });
    db.close();
  });
});
