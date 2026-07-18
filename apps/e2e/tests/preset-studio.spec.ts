import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { STUB_MODEL_ID, STUB_REPLY } from '../stub-provider/stub-provider.js';

const PRESET_NAME = 'M4 Cartographer preset';
const NOTEBOOK_NAME = 'M4 Glass Archipelago';
const SOURCE_TITLE = 'M4 tide ledger';
const SOURCE_CONTENT = 'The eastern beacon burns violet at low tide.';
const CAPTURED_SOURCE_TITLE = 'M4 captured stub response';
const PRESET_MARKER = 'M4_PRESET_MARKER';
const DEPTH_DIRECTIVE = 'M4_DEPTH_DIRECTIVE';
const QUESTION = 'Which color does the eastern beacon burn?';
const CUSTOM_PROVIDER_LABEL = 'Custom (OpenAI-compatible)';
const CHAT_TEMPERATURE = '0.35';
const SOURCE_HASH = createHash('sha256').update(SOURCE_CONTENT).digest('hex');

interface PersistedPresetContext {
  contextVersion: 2;
  preset: Record<string, unknown>;
  canonicalMessages: Array<{ role: string; content: string }>;
  sources: Array<{ id: string; title: string; contentHash: string; content: string }>;
  requestedControls: Record<string, unknown>;
}

interface PersistedMessage {
  id: string;
  chatId: string;
  role: string;
  content: string;
  context: PersistedPresetContext | null;
}

test('M4 preset studio, immutable inspector, and response capture journey', async ({ page }) => {
  const stubUrl = process.env.E2E_STUB_URL;
  expect(stubUrl, 'global-setup must publish the stub provider URL').toBeTruthy();
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();

  let notebookUrl = '';
  let chatId = '';
  let assistantMessageId = '';
  let selectedSourceId = '';
  let persistedPreset: Record<string, unknown> | null = null;

  await test.step('browser-import, review, and save a native preset', async () => {
    await page.goto('/presets');
    await page.getByRole('button', { name: 'Import preset' }).click();
    await page.getByLabel('Preset JSON file').setInputFiles({
      name: 'm4-cartographer.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(nativePreset())),
    });

    const review = page.getByRole('region', { name: 'Import review' });
    await expect(review.getByRole('heading', { name: PRESET_NAME })).toBeVisible();
    await expect(review).toContainText('Temperature 0.6');
    await expect(review).toContainText('3 modules');
    await page.getByRole('button', { name: 'Save imported preset' }).click();
    await expect(page.getByLabel('Preset name')).toHaveValue(PRESET_NAME);
  });

  await test.step('make it global, reorder modules, and edit at-depth insertion', async () => {
    await page.getByRole('button', { name: 'Make global default' }).click();
    await expect(page.getByRole('button', { name: `Select ${PRESET_NAME}` })).toContainText(
      'Global default',
    );

    const depthModule = moduleGroup(page, 'Depth directive');
    await depthModule.getByRole('button', { name: 'Move Depth directive up' }).click();
    await depthModule.getByLabel('Depth', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Save changes' }).click();

    const previewItems = page
      .getByRole('heading', { name: 'Prompt order' })
      .locator('..')
      .getByRole('listitem');
    await expect(previewItems).toHaveText([
      'system: M4_PRESET_MARKER',
      '[Conversation history · older than depth 2]',
      'system: [Selected source excerpts] · at depth 2',
      '[Conversation history · newest 2 messages]',
      'system: M4_DEPTH_DIRECTIVE · at depth 0',
      '[Newest user message]',
    ]);
  });

  await test.step('configure the global provider against the stub', async () => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Configure provider' }).click();
    await page.locator('#provider-source').selectOption({ label: CUSTOM_PROVIDER_LABEL });
    await page.getByLabel('Base URL').fill(stubUrl ?? '');
    await page.getByRole('button', { name: 'Load models' }).click();
    await expect(page.locator('#provider-model')).toHaveValue(STUB_MODEL_ID);
    await page.getByRole('button', { name: 'Save provider' }).click();
    await expect(page.getByText(`${CUSTOM_PROVIDER_LABEL} · ${STUB_MODEL_ID}`)).toBeVisible();
  });

  await test.step('create a notebook and a Markdown source', async () => {
    await page.goto('/');
    await page.getByLabel('Notebook name').fill(NOTEBOOK_NAME);
    await page.getByRole('button', { name: 'Create notebook' }).click();
    await expect(page).toHaveURL(/\/notebooks\/[0-9a-f-]+$/);
    notebookUrl = page.url();

    await page.getByRole('button', { name: 'Paste source' }).click();
    await page.getByLabel('Source title').fill(SOURCE_TITLE);
    await page.getByLabel('Markdown content').fill(SOURCE_CONTENT);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Review pasted source' })).toBeVisible();
    await page.getByRole('button', { name: 'Save source' }).click();
    await page.getByRole('link', { name: SOURCE_TITLE }).click();
    await expect(page.getByRole('region', { name: 'Reader' })).toContainText(SOURCE_CONTENT);
  });

  await test.step('create an inheriting chat', async () => {
    const [createChatResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/notebooks\/[0-9a-f-]+\/chats$/u.test(response.url()),
      ),
      page.getByRole('button', { name: 'New chat' }).click(),
    ]);
    expect(createChatResponse.ok()).toBe(true);
    const createdChat = (await createChatResponse.json()) as { id?: unknown };
    expect(createdChat.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u));
    chatId = createdChat.id as string;
    const controls = page.getByRole('region', { name: 'Preset controls' });
    await expect(controls).toContainText(`Active preset: ${PRESET_NAME}`);
    await expect(controls).toContainText('Inherited from global default');
  });

  await test.step('save chat temperature and generate through the keyless stub', async () => {
    const chat = page.getByRole('region', { name: 'Selected chat' });
    const controls = page.getByRole('region', { name: 'Preset controls' });
    await chat.getByRole('checkbox', { name: SOURCE_TITLE }).check();

    await controls.getByLabel('Temperature').fill(CHAT_TEMPERATURE);
    await expect(controls.getByText('Saving…')).toBeVisible();
    await expect(controls.getByText('Saving…')).toBeHidden();
    await expect(controls.locator('output')).toHaveText(CHAT_TEMPERATURE);

    await page.getByLabel('Message').fill(QUESTION);
    await chat.getByRole('button', { name: 'Send' }).click();
    await expect(chat).toContainText(STUB_REPLY);

    const detailResponse = await page.request.get(`/api/chats/${chatId}`);
    expect(detailResponse.ok()).toBe(true);
    const detail = (await detailResponse.json()) as { messages?: PersistedMessage[] };
    const matchingAssistants = (detail.messages ?? []).filter(
      (message) => message.role === 'assistant' && message.content === STUB_REPLY,
    );
    expect(matchingAssistants).toHaveLength(1);
    const assistant = matchingAssistants[0];
    expect(assistant).toBeDefined();
    expect(assistant?.chatId).toBe(chatId);
    expect(assistant?.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u));
    expect(assistant?.context?.contextVersion).toBe(2);
    assistantMessageId = assistant?.id ?? '';

    const context = assistant?.context;
    expect(context).not.toBeNull();
    expect(context?.preset).toMatchObject(expectedPresetSnapshot());
    persistedPreset = context?.preset ?? null;
    expect(context?.requestedControls).toEqual(expectedGenerationControls());
    expect(context?.canonicalMessages.map((message) => message.role)).toEqual([
      'system',
      'system',
      'user',
    ]);
    expect(context?.sources).toHaveLength(1);
    expect(context?.sources[0]).toMatchObject({
      title: SOURCE_TITLE,
      contentHash: SOURCE_HASH,
      content: SOURCE_CONTENT,
    });
    selectedSourceId = context?.sources[0]?.id ?? '';
    expect(selectedSourceId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u));
  });

  await test.step('inspect the exact immutable generation record', async () => {
    const chat = page.getByRole('region', { name: 'Selected chat' });
    await chat.getByRole('button', { name: 'Inspect prompt' }).click();
    const inspector = page.getByRole('dialog', { name: 'What the model received' });

    await expect(inspector.getByRole('heading', { name: PRESET_NAME })).toBeVisible();
    const displayedPreset = JSON.parse(
      (await inspectorSection(inspector, PRESET_NAME).locator('pre').textContent()) ?? 'null',
    ) as Record<string, unknown>;
    expect(displayedPreset).toEqual(persistedPreset);
    const { id, createdAt, updatedAt, ...portablePreset } = displayedPreset;
    expect(id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u));
    expect(createdAt).toEqual(expect.any(String));
    expect(updatedAt).toEqual(expect.any(String));
    expect(portablePreset).toEqual(expectedPresetSnapshot());

    const requestedControls = JSON.parse(
      (await inspectorSection(inspector, 'Requested controls').locator('pre').textContent()) ??
        'null',
    ) as unknown;
    expect(requestedControls).toEqual(expectedGenerationControls());

    const messages = inspector
      .getByRole('list', { name: 'Canonical messages' })
      .getByRole('listitem');
    await expect(messages).toHaveCount(3);
    const expectedCanonical = [
      { role: 'system', content: PRESET_MARKER },
      {
        role: 'system',
        content: `${DEPTH_DIRECTIVE}\n\n## Sources\n<source id="${selectedSourceId}" title="${SOURCE_TITLE}">\n${SOURCE_CONTENT}\n</source>`,
      },
      { role: 'user', content: QUESTION },
    ];
    for (const [index, expected] of expectedCanonical.entries()) {
      const message = messages.nth(index);
      await expect(message.getByText(expected.role, { exact: true })).toBeVisible();
      await expect(message.locator('pre')).toHaveText(expected.content);
    }

    const capturedSources = inspectorSection(inspector, 'Captured sources');
    await expect(capturedSources.getByRole('heading', { name: SOURCE_TITLE })).toBeVisible();
    await expect(capturedSources.getByText(selectedSourceId, { exact: true })).toBeVisible();
    await expect(capturedSources.getByText(SOURCE_HASH, { exact: true })).toBeVisible();
    await expect(capturedSources.locator('pre')).toHaveText(SOURCE_CONTENT);
    await expect(inspectorSection(inspector, 'Effective request body')).toContainText(
      `"temperature": ${CHAT_TEMPERATURE}`,
    );
    await page.getByRole('button', { name: 'Close inspector' }).click();
  });

  await test.step('review and save the assistant response as a source', async () => {
    const chat = page.getByRole('region', { name: 'Selected chat' });
    await chat.getByRole('button', { name: 'Add to sources' }).click();
    const capture = page.getByRole('dialog', { name: 'Review response as a source' });
    await expect(capture.getByLabel('Markdown content')).toHaveValue(STUB_REPLY);
    await capture.getByLabel('Source title').fill(CAPTURED_SOURCE_TITLE);
    await capture.getByRole('button', { name: 'Save source' }).click();

    await expect(page).toHaveURL(/\/notebooks\/[0-9a-f-]+\/sources\/[0-9a-f-]+$/);
    await expect(page.getByRole('region', { name: 'Reader' })).toContainText(STUB_REPLY);
    await expect(page.getByRole('link', { name: CAPTURED_SOURCE_TITLE })).toBeVisible();
  });

  await test.step('captured Markdown keeps response content and assistant provenance on disk', async () => {
    const notebookId = /\/notebooks\/([0-9a-f-]+)/.exec(notebookUrl)?.[1];
    expect(notebookId).toBeTruthy();
    const sourcesDir = join(dataDir ?? '', 'notebooks', notebookId ?? '', 'sources');
    const files = await readdir(sourcesDir);
    const capturedFile = files.find((file) => file.includes('m4-captured-stub-response.md'));
    expect(capturedFile).toBeTruthy();
    const body = await readFile(join(sourcesDir, capturedFile ?? ''), 'utf8');
    expect(body).toContain(STUB_REPLY);
    expect(parseAssistantResponseOrigin(body)).toEqual({
      type: 'assistant-response',
      chatId,
      messageId: assistantMessageId,
    });
  });
});

function nativePreset() {
  return {
    schemaVersion: 1,
    name: PRESET_NAME,
    generation: {
      temperature: 0.6,
      topP: null,
      maxTokens: null,
      assistantPrefill: null,
    },
    modules: [
      {
        key: 'm4-marker',
        name: 'Preset marker',
        kind: 'custom',
        role: 'system',
        content: PRESET_MARKER,
        enabled: true,
        insertion: { position: 'before_history' },
      },
      {
        key: 'sources',
        name: 'Selected sources',
        kind: 'sources',
        role: 'system',
        content: null,
        enabled: true,
        insertion: { position: 'at_depth', depth: 2 },
      },
      {
        key: 'depth-directive',
        name: 'Depth directive',
        kind: 'custom',
        role: 'system',
        content: DEPTH_DIRECTIVE,
        enabled: true,
        insertion: { position: 'at_depth', depth: 3 },
      },
    ],
  };
}

function expectedGenerationControls() {
  return {
    temperature: Number(CHAT_TEMPERATURE),
    topP: null,
    maxTokens: null,
    assistantPrefill: null,
  };
}

function expectedPresetSnapshot() {
  const imported = nativePreset();
  return {
    schemaVersion: imported.schemaVersion,
    name: imported.name,
    generation: expectedGenerationControls(),
    modules: [
      imported.modules[0],
      {
        ...imported.modules[2],
        insertion: { position: 'at_depth', depth: 0 },
      },
      imported.modules[1],
    ],
  };
}

function parseAssistantResponseOrigin(markdown: string) {
  if (!markdown.startsWith('---\n')) throw new Error('Captured source is missing frontmatter.');
  const closing = markdown.indexOf('\n---\n', 4);
  if (closing < 0) throw new Error('Captured source frontmatter is not closed.');
  const lines = markdown.slice(4, closing).split('\n');
  const originIndex = lines.indexOf('origin:');
  if (originIndex < 0) throw new Error('Captured source is missing origin metadata.');
  const values = new Map<string, string>();
  for (const line of lines.slice(originIndex + 1)) {
    if (!line.startsWith('  ')) break;
    const match = /^ {2}([A-Za-z][A-Za-z0-9]*): (.+)$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) values.set(match[1], match[2]);
  }
  return {
    type: values.get('type'),
    chatId: values.get('chatId'),
    messageId: values.get('messageId'),
  };
}

function moduleGroup(page: Page, name: string): Locator {
  return page.getByRole('group', { name: `${name} module` });
}

function inspectorSection(inspector: Locator, heading: string): Locator {
  return inspector.getByRole('heading', { name: heading }).locator('..');
}
