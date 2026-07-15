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

test('M4 preset studio, immutable inspector, and response capture journey', async ({ page }) => {
  const stubUrl = process.env.E2E_STUB_URL;
  expect(stubUrl, 'global-setup must publish the stub provider URL').toBeTruthy();
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();

  let notebookUrl = '';

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
      'Preset marker',
      '[Conversation history · older than depth 2]',
      '[Selected source excerpts] · at depth 2',
      '[Conversation history · newest 2 messages]',
      'Depth directive · at depth 0',
      '[Newest user message]',
    ]);
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
    await page.getByRole('button', { name: 'Save source' }).click();
    await page.getByRole('link', { name: SOURCE_TITLE }).click();
    await expect(page.getByRole('region', { name: 'Reader' })).toContainText(SOURCE_CONTENT);
  });

  await test.step('configure the notebook and create an inheriting chat', async () => {
    await page.getByRole('button', { name: 'Configure provider' }).click();
    await page.locator('#provider-source').selectOption({ label: CUSTOM_PROVIDER_LABEL });
    await page.getByLabel('Base URL').fill(stubUrl ?? '');
    await page.getByRole('button', { name: 'Load models' }).click();
    await expect(page.locator('#provider-model')).toHaveValue(STUB_MODEL_ID);
    await page.getByRole('button', { name: 'Save provider' }).click();

    await page.getByRole('button', { name: 'New chat' }).click();
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
  });

  await test.step('inspect the exact immutable generation record', async () => {
    const chat = page.getByRole('region', { name: 'Selected chat' });
    await chat.getByRole('button', { name: 'Inspect prompt' }).click();
    const inspector = page.getByRole('dialog', { name: 'What the model received' });

    await expect(inspector.getByRole('heading', { name: PRESET_NAME })).toBeVisible();
    const messages = inspector
      .getByRole('list', { name: 'Canonical messages' })
      .getByRole('listitem');
    await expect(messages).toHaveCount(4);
    await expect(messages.nth(0)).toContainText(PRESET_MARKER);
    await expect(messages.nth(1)).toContainText(DEPTH_DIRECTIVE);
    await expect(messages.nth(2)).toContainText(SOURCE_CONTENT);
    await expect(messages.nth(2)).toContainText(`title="${SOURCE_TITLE}"`);
    await expect(messages.nth(3)).toContainText(QUESTION);

    await expect(inspectorSection(inspector, 'Captured sources')).toContainText(SOURCE_CONTENT);
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
    expect(body).toMatch(
      /origin:\n {2}type: assistant-response\n {2}chatId: [0-9a-f-]{36}\n {2}messageId: [0-9a-f-]{36}/u,
    );
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

function moduleGroup(page: Page, name: string): Locator {
  return page.getByRole('group', { name: `${name} module` });
}

function inspectorSection(inspector: Locator, heading: string): Locator {
  return inspector.getByRole('heading', { name: heading }).locator('..');
}
