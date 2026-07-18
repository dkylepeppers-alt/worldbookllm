import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { STUB_MODEL_ID, STUB_MODEL_NAME, STUB_REPLY } from '../stub-provider/stub-provider.js';

const NOTEBOOK_NAME = 'Ember Coast Atlas';
const SOURCE_TITLE = 'Field notes';
const SOURCE_SENTENCE = 'The required reply word is brass.';
const CUSTOM_PROVIDER_LABEL = 'Custom (OpenAI-compatible)';

// The M1 walking skeleton (contracts spec: docs/superpowers/specs/
// 2026-07-10-m1-phases-6-9-contracts-design.md, "M1 User Journey"), driven
// against the keyless `custom` provider backed by the local stub. The stop
// half of step 6 lives in stop-generation.spec.ts.
test('M1 walking skeleton', async ({ page }) => {
  const stubUrl = process.env.E2E_STUB_URL;
  expect(stubUrl, 'global-setup must publish the stub provider URL').toBeTruthy();
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();

  let notebookUrl = '';

  await test.step('create a notebook', async () => {
    await page.goto('/');
    await page.getByLabel('Notebook name').fill(NOTEBOOK_NAME);
    await page.getByRole('button', { name: 'Create notebook' }).click();
    // Creation navigates straight into the new notebook's workspace.
    await expect(page).toHaveURL(/\/notebooks\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: NOTEBOOK_NAME })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sources' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Chat' })).toBeVisible();
    notebookUrl = page.url();
  });

  await test.step('paste a Markdown source and read it back', async () => {
    await page.getByRole('button', { name: 'Paste source' }).click();
    await page.getByLabel('Source title').fill(SOURCE_TITLE);
    await page.getByLabel('Markdown content').fill(SOURCE_SENTENCE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Review pasted source' })).toBeVisible();
    await page.getByRole('button', { name: 'Save source' }).click();
    await page.getByRole('link', { name: SOURCE_TITLE }).click();
    await expect(page.getByRole('region', { name: 'Reader' })).toContainText(SOURCE_SENTENCE);
  });

  await test.step('add a provider key in settings', async () => {
    await page.goto('/settings');
    const card = providerCard(page, CUSTOM_PROVIDER_LABEL);
    await card.getByRole('button', { name: 'Add key' }).click();
    await page.getByLabel('Label (optional)').fill('stub key');
    await page.getByLabel('Key value').fill('stub-key-value');
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(card.getByText('Active')).toBeVisible();
    await expect(card.getByText('stub key')).toBeVisible();
  });

  await test.step('configure the global provider against the stub', async () => {
    await page.getByRole('button', { name: 'Configure provider' }).click();
    await page.locator('#provider-source').selectOption({ label: CUSTOM_PROVIDER_LABEL });
    await page.getByLabel('Base URL').fill(stubUrl ?? '');
    await page.getByRole('button', { name: 'Load models' }).click();
    await expect(page.locator('#provider-model')).toHaveValue(STUB_MODEL_ID);
    await expect(page.locator('#provider-model').locator('option')).toContainText([
      `${STUB_MODEL_NAME} (${STUB_MODEL_ID})`,
    ]);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByRole('status')).toContainText(/reachable/i);
    await page.getByRole('button', { name: 'Save provider' }).click();
    await expect(page.getByText(`${CUSTOM_PROVIDER_LABEL} · ${STUB_MODEL_ID}`)).toBeVisible();
    await page.goto(notebookUrl);
  });

  await test.step('create a chat', async () => {
    await page.getByRole('button', { name: 'New chat' }).click();
    const chatDetail = page.getByRole('region', { name: 'Selected chat' });
    await expect(chatDetail).toBeVisible();
    await expect(chatDetail).toContainText('New chat');
  });

  await test.step('select the pasted source and stream a grounded reply', async () => {
    const chatDetail = page.getByRole('region', { name: 'Selected chat' });
    await chatDetail.getByRole('checkbox', { name: SOURCE_TITLE }).check();
    await expect(chatDetail).toContainText('1 of 1 sources selected');
    await page.getByLabel('Message').fill('What is the required reply word?');
    await chatDetail.getByRole('button', { name: 'Send' }).click();
    await expect(chatDetail).toContainText(STUB_REPLY);
    await expect(chatDetail.getByText('Interrupted')).toHaveCount(0);
    await expect(chatDetail.getByText('Error')).toHaveCount(0);
  });

  await test.step('everything survives a reload', async () => {
    await page.reload();
    await expect(page.getByRole('link', { name: SOURCE_TITLE })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Chat' })).toContainText('New chat');

    // The streamed exchange was persisted server-side: reselecting the chat
    // reconstructs it from GET /api/chats/:id with a complete (unbadged)
    // assistant message and the source still selected.
    await page
      .locator('.chat-list')
      .getByRole('button', { name: /New chat/ })
      .click();
    const chatDetail = page.getByRole('region', { name: 'Selected chat' });
    await expect(chatDetail).toContainText(STUB_REPLY);
    await expect(chatDetail).toContainText('1 of 1 sources selected');
    await expect(chatDetail.getByText('Interrupted')).toHaveCount(0);
    await expect(chatDetail.getByText('Error')).toHaveCount(0);
  });

  await test.step('the source is a Markdown file on disk', async () => {
    const notebookId = /\/notebooks\/([0-9a-f-]+)$/.exec(notebookUrl)?.[1];
    expect(notebookId).toBeTruthy();
    const sourcesDir = join(dataDir ?? '', 'notebooks', notebookId ?? '', 'sources');
    const files = await readdir(sourcesDir);
    const markdownFiles = files.filter((file) => file.endsWith('.md'));
    expect(markdownFiles.length).toBe(1);
    const body = await readFile(join(sourcesDir, markdownFiles[0] ?? ''), 'utf8');
    expect(body).toContain(SOURCE_SENTENCE);
  });

  await test.step('switch models without losing data', async () => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Configure provider' }).click();
    await page.getByLabel('Base URL').fill(stubUrl ?? '');
    await page.locator('#provider-model').fill('stub-model-2');
    await page.getByRole('button', { name: 'Save provider' }).click();
    await expect(page.getByText(`${CUSTOM_PROVIDER_LABEL} · stub-model-2`)).toBeVisible();

    await page.goto(notebookUrl);
    await expect(page.getByRole('link', { name: SOURCE_TITLE })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Chat' })).toContainText('New chat');
  });
});

function providerCard(page: Page, label: string) {
  return page
    .locator('section.provider-settings-card')
    .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
}
