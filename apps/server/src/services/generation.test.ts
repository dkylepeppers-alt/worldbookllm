import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PortablePreset, PresetGenerationContext, StreamEvent } from '@worldbookllm/shared';
import matter from 'gray-matter';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { ConflictError, ConfigurationError, InvalidStoredDataError } from '../errors.js';
import { SkillFileStore } from '../files/skill-files.js';
import { SourceFileStore } from '../files/source-files.js';
import { ProviderHttpClient } from '../providers/http-client.js';
import { SecretStore } from '../secrets/secret-store.js';
import { ChatService } from './chats.js';
import { GenerationService } from './generation.js';
import { NotebookService } from './notebooks.js';
import { PromptAssembler } from './prompt-assembler.js';
import { ProviderService } from './providers.js';
import { PresetService } from './presets.js';
import { SkillService } from './skills.js';
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
  const presets = new PresetService(db);
  if (withConfig) {
    presets.updateSettings({
      providerConfig: { source: 'custom', model: 'local', baseUrl: 'http://provider.test/v1' },
    });
  }
  const notebook = notebooks.create({ name: 'Atlas' });
  const source = sources.create(notebook.id, { title: 'Lore', content: 'Amber is canon.' });
  const chat = chats.create(notebook.id, {
    skillIds: [],
    title: 'Chat',
    sourceIds: [source.id],
    presetId: null,
  });
  const skills = new SkillService(db, new SkillFileStore(dataDir));
  const generation = new GenerationService(
    chats,
    presets,
    new PromptAssembler(sources, skills),
    providers,
  );
  return { dataDir, db, chats, chat, generation, notebook, presets, skills, source, sources };
}

const customPreset: PortablePreset = {
  schemaVersion: 1,
  name: 'Explicit mode',
  generation: {
    temperature: 1.25,
    topP: 0.8,
    maxTokens: 777,
    assistantPrefill: null,
  },
  modules: [
    {
      key: 'instruction',
      name: 'Instruction',
      kind: 'custom',
      role: 'system',
      content: 'Use explicit mode.',
      enabled: true,
      insertion: { position: 'before_history' },
    },
    {
      key: 'sources',
      name: 'Sources',
      kind: 'sources',
      role: 'system',
      content: null,
      enabled: true,
      insertion: { position: 'before_history' },
    },
  ],
};

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('GenerationService', () => {
  it('prepares a versioned preset exchange and rejects concurrent generation', () => {
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
    expect(prepared.assistant.context).toMatchObject({
      contextVersion: 2,
      preset: { name: 'Grounded development' },
      requestedControls: { temperature: 0.7 },
      provider: 'custom',
      model: 'local',
      sources: [{ id: expect.any(String), content: 'Amber is canon.' }],
      effectiveRequestBody: { temperature: 0.7 },
    });
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

  it('resolves explicit chat presets instead of the inherited global default', () => {
    const inherited = setup(async () => Promise.reject(new Error('not called')));
    const inheritedPrepared = inherited.generation.prepare(inherited.chat.id, 'Inherited');
    expect((inheritedPrepared.assistant.context as PresetGenerationContext).preset.name).toBe(
      'Grounded development',
    );
    inheritedPrepared.release();
    inherited.db.close();

    const explicit = setup(async () => Promise.reject(new Error('not called')));
    const created = explicit.presets.create(customPreset);
    explicit.chats.patch(explicit.chat.id, { presetId: created.id });
    const explicitPrepared = explicit.generation.prepare(explicit.chat.id, 'Explicit');
    const context = explicitPrepared.assistant.context as PresetGenerationContext;
    expect(context.preset.id).toBe(created.id);
    expect(context.canonicalMessages).toEqual([
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('Use explicit mode.\n\n## Sources\n'),
      }),
      { role: 'user', content: 'Explicit' },
    ]);
    expect(context.canonicalMessages[0]?.content).toContain('Amber is canon.');
    expect(context.requestedControls).toEqual(created.generation);
    expect(context.effectiveRequestBody).toMatchObject({
      temperature: 1.25,
      top_p: 0.8,
      max_tokens: 777,
    });
    explicitPrepared.release();
    explicit.db.close();
  });

  it('keeps the captured preset and source context immutable after later edits', () => {
    const { dataDir, db, chats, chat, generation, presets, source } = setup(async () =>
      Promise.reject(new Error('not called')),
    );
    const created = presets.create(customPreset);
    chats.patch(chat.id, { presetId: created.id });
    const prepared = generation.prepare(chat.id, 'Question');
    const captured = structuredClone(prepared.assistant.context) as PresetGenerationContext;

    presets.patch(created.id, { name: 'Changed later' });
    const sourcePath = join(dataDir, source.filePath);
    const parsed = matter(readFileSync(sourcePath, 'utf8'));
    writeFileSync(
      sourcePath,
      matter.stringify('Changed source.', parsed.data).replace(/\n$/u, ''),
      {
        mode: 0o600,
      },
    );

    expect(chats.getDetail(chat.id).messages.at(-1)?.context).toEqual(captured);
    expect(captured.preset.name).toBe('Explicit mode');
    expect(captured.sources[0]).toMatchObject({ content: 'Amber is canon.' });
    prepared.release();
    db.close();
  });

  it('captures attached skill content in the exchange snapshot and injects it', () => {
    const { db, chats, chat, generation, skills } = setup(async () =>
      Promise.reject(new Error('not called')),
    );
    const skill = skills.create({
      name: 'character-voice',
      description: 'Keep voices distinct.',
      content: 'Voice instructions.',
    });
    chats.patch(chat.id, { skillIds: [skill.id] });

    const prepared = generation.prepare(chat.id, 'Question');
    const captured = prepared.assistant.context as PresetGenerationContext;
    expect(captured.skills).toEqual([
      {
        id: skill.id,
        name: 'character-voice',
        description: 'Keep voices distinct.',
        contentHash: skill.contentHash,
        content: 'Voice instructions.',
      },
    ]);
    expect(captured.canonicalMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('<skill name="character-voice"'),
        }),
      ]),
    );
    prepared.release();
    db.close();
  });

  it('inserts nothing when preset resolution or request construction fails', () => {
    const missingPreset = setup(async () => Promise.reject(new Error('not called')));
    missingPreset.db.pragma('foreign_keys = OFF');
    missingPreset.db
      .prepare('UPDATE app_settings SET default_preset_id = ? WHERE id = 1')
      .run(crypto.randomUUID());
    expect(() => missingPreset.generation.prepare(missingPreset.chat.id, 'Question')).toThrow(
      InvalidStoredDataError,
    );
    expect(missingPreset.chats.getDetail(missingPreset.chat.id).messages).toEqual([]);
    missingPreset.db.close();

    const requestFailure = setup(async () => Promise.reject(new Error('not called')));
    // A configured source that requires a secret this test never stores: the
    // config resolves, but building the provider request itself fails.
    requestFailure.presets.updateSettings({
      providerConfig: { source: 'claude', model: 'claude-3-5-sonnet-20241022' },
    });
    expect(() => requestFailure.generation.prepare(requestFailure.chat.id, 'Question')).toThrow(
      ConfigurationError,
    );
    expect(requestFailure.chats.getDetail(requestFailure.chat.id).messages).toEqual([]);
    requestFailure.db.close();
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

  it('regenerates the last turn into a second variant without adding an exchange', async () => {
    const responses = [
      'data: {"choices":[{"delta":{"content":"First answer"}}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"Second answer"}}]}\n\ndata: [DONE]\n\n',
    ];
    let call = 0;
    const { db, chats, chat, generation } = setup(async () =>
      Promise.resolve(new Response(responses[call++])),
    );

    const first = generation.prepare(chat.id, 'Question');
    await generation.stream(first, new AbortController().signal, () => undefined);
    first.release();

    const before = chats.getDetail(chat.id).messages;
    expect(before).toHaveLength(2);
    expect(before.at(-1)).toMatchObject({ content: 'First answer' });

    const regen = generation.prepareRegeneration(chat.id);
    expect(regen.assistant).toMatchObject({ content: '', status: 'interrupted', activeVariant: 1 });
    await generation.stream(regen, new AbortController().signal, () => undefined);
    regen.release();

    const after = chats.getDetail(chat.id).messages;
    // No new user/assistant pair — still one exchange, now with two variants.
    expect(after).toHaveLength(2);
    const assistant = after.at(-1);
    expect(assistant).toMatchObject({ content: 'Second answer', activeVariant: 1 });
    expect(assistant?.variants).toHaveLength(2);
    expect(assistant?.variants?.[0]).toMatchObject({ content: 'First answer' });
    expect(assistant?.variants?.[1]).toMatchObject({ content: 'Second answer' });
    db.close();
  });

  it('rejects regeneration when the chat has no assistant turn', () => {
    const { db, chat, generation } = setup(async () => Promise.reject(new Error('not called')));
    expect(() => generation.prepareRegeneration(chat.id)).toThrow(ConflictError);
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
    expect(chats.getDetail(chat.id).messages.at(-1)?.context).toMatchObject({
      contextVersion: 2,
      canonicalMessages: expect.any(Array),
      effectiveRequestBody: expect.any(Object),
    });
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
