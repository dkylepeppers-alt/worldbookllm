import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { STUB_MODEL_ID, STUB_REPLY } from '../stub-provider/stub-provider.js';

const NOTEBOOK_NAME = 'M6 Skillful Steppe';
const SOURCE_TITLE = 'M6 caravan ledger';
const SOURCE_CONTENT = 'The salt caravans cross the steppe every third moon.';
const SKILL_NAME = 'story-sense';
const SKILL_PHRASE = 'Assess → Diagnose → Intervene → Reassess';
const QUESTION = 'What is broken in my caravan story?';
const CUSTOM_PROVIDER_LABEL = 'Custom (OpenAI-compatible)';

interface PersistedSkillSnapshot {
  id: string;
  name: string;
  description: string;
  contentHash: string;
  content: string;
}

interface PersistedMessage {
  role: string;
  content: string;
  context: {
    contextVersion?: number;
    skills?: PersistedSkillSnapshot[];
    canonicalMessages?: Array<{ role: string; content: string }>;
  } | null;
}

test('M6 skills library, chat attachment, and inspector journey', async ({ page }) => {
  const stubUrl = process.env.E2E_STUB_URL;
  expect(stubUrl, 'global-setup must publish the stub provider URL').toBeTruthy();
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();

  let chatId = '';

  await test.step('install the vendored starter set from the skills page', async () => {
    await page.goto('/skills');
    await page.getByRole('button', { name: 'Install starter skills' }).click();
    const dialog = page.getByRole('dialog', { name: 'Install starter skills' });
    await expect(dialog.getByRole('checkbox', { name: SKILL_NAME })).toBeVisible();
    await dialog.getByRole('button', { name: /Install \d+ skills/ }).click();

    const library = page.getByRole('region', { name: 'Skill library' });
    await expect(library.getByRole('button', { name: new RegExp(SKILL_NAME) })).toBeVisible();
  });

  await test.step('the installed skill is an editable Markdown file on disk', async () => {
    const body = await readFile(join(dataDir ?? '', 'skills', SKILL_NAME, 'SKILL.md'), 'utf8');
    expect(body).toContain('name: story-sense');
    expect(body).toContain(SKILL_PHRASE);
  });

  await test.step('create a notebook, source, and stub-backed chat', async () => {
    await page.goto('/');
    await page.getByLabel('Notebook name').fill(NOTEBOOK_NAME);
    await page.getByRole('button', { name: 'Create notebook' }).click();
    await expect(page).toHaveURL(/\/notebooks\/[0-9a-f-]+$/);

    await page.getByRole('button', { name: 'Paste source' }).click();
    await page.getByLabel('Source title').fill(SOURCE_TITLE);
    await page.getByLabel('Markdown content').fill(SOURCE_CONTENT);
    await page.getByRole('button', { name: 'Save source' }).click();
    await expect(page.getByRole('link', { name: SOURCE_TITLE })).toBeVisible();

    await page.getByRole('button', { name: 'Configure provider' }).click();
    await page.locator('#provider-source').selectOption({ label: CUSTOM_PROVIDER_LABEL });
    await page.getByLabel('Base URL').fill(stubUrl ?? '');
    await page.getByRole('button', { name: 'Load models' }).click();
    await expect(page.locator('#provider-model')).toHaveValue(STUB_MODEL_ID);
    await page.getByRole('button', { name: 'Save provider' }).click();

    const [createChatResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/notebooks\/[0-9a-f-]+\/chats$/u.test(response.url()),
      ),
      page.getByRole('button', { name: 'New chat' }).click(),
    ]);
    expect(createChatResponse.ok()).toBe(true);
    chatId = ((await createChatResponse.json()) as { id: string }).id;
  });

  await test.step('attach the skill and generate through the keyless stub', async () => {
    const chat = page.getByRole('region', { name: 'Selected chat' });
    await chat.getByRole('checkbox', { name: SOURCE_TITLE }).check();

    const skillSelector = chat.locator('fieldset', { hasText: 'Craft skills' });
    await skillSelector.getByRole('checkbox', { name: SKILL_NAME }).check();
    await expect(skillSelector).toContainText(/1 of \d+ skills attached/);

    await page.getByLabel('Message').fill(QUESTION);
    await chat.getByRole('button', { name: 'Send' }).click();
    await expect(chat).toContainText(STUB_REPLY);
  });

  await test.step('the immutable snapshot records the exact injected skill text', async () => {
    const detailResponse = await page.request.get(`/api/chats/${chatId}`);
    expect(detailResponse.ok()).toBe(true);
    const detail = (await detailResponse.json()) as { messages?: PersistedMessage[] };
    const assistant = (detail.messages ?? []).find(
      (message) => message.role === 'assistant' && message.content === STUB_REPLY,
    );
    expect(assistant).toBeDefined();
    expect(assistant?.context?.contextVersion).toBe(2);

    const skills = assistant?.context?.skills ?? [];
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: SKILL_NAME });
    expect(skills[0]?.content).toContain(SKILL_PHRASE);
    expect(skills[0]?.contentHash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/u));

    const systemContent = (assistant?.context?.canonicalMessages ?? [])
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    expect(systemContent).toContain(`<skill name="${SKILL_NAME}"`);
    expect(systemContent).toContain(SKILL_PHRASE);
    expect(systemContent).toContain(SOURCE_CONTENT);
  });

  await test.step('the Prompt Inspector shows the captured skill', async () => {
    const chat = page.getByRole('region', { name: 'Selected chat' });
    await chat.getByRole('button', { name: 'Inspect prompt' }).click();
    const inspector = page.getByRole('dialog', { name: 'What the model received' });

    const capturedSkills = inspector
      .getByRole('heading', { name: 'Captured skills' })
      .locator('..');
    await expect(capturedSkills.getByRole('heading', { name: SKILL_NAME })).toBeVisible();
    await expect(capturedSkills.locator('pre')).toContainText(SKILL_PHRASE);
    await page.getByRole('button', { name: 'Close inspector' }).click();
  });
});
