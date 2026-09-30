import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { STUB_AGENT_REPLY, STUB_MODEL_ID } from '../stub-provider/stub-provider.js';

const SKILL_NAME = 'caravan-ledger';
const SKILL_DESCRIPTION = 'Keeps caravan routes and moon cycles consistent.';
const SKILL_BODY = '## Ledger rules\n\nEvery caravan crosses the steppe every third moon.';

// The provider setting is global; put back whatever the run had before.
let previousProvider: unknown = null;

test.beforeEach(async ({ request }) => {
  const settings = await request.get('/api/app-settings');
  previousProvider = ((await settings.json()) as { providerConfig: unknown }).providerConfig;
});

test.afterEach(async ({ request }) => {
  await request.patch('/api/app-settings', { data: { providerConfig: previousProvider } });
});

test('skills library, a custom agent limited to one skill, and the step inspector', async ({
  page,
}) => {
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  const stubUrl = process.env.E2E_STUB_URL;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();
  expect(stubUrl, 'global-setup must publish the stub provider URL').toBeTruthy();

  await test.step('write a skill in the library', async () => {
    await page.goto('/skills');
    await page.getByRole('button', { name: 'New skill' }).click();
    await page.getByLabel('Name').fill(SKILL_NAME);
    await page.getByLabel('Description').fill(SKILL_DESCRIPTION);
    await page.getByLabel('Instructions (Markdown)').fill(SKILL_BODY);
    await page.getByRole('button', { name: 'Create skill' }).click();
    const library = page.getByRole('region', { name: 'Skill library' });
    await expect(library.getByRole('button', { name: new RegExp(SKILL_NAME) })).toBeVisible();
  });

  await test.step('the skill is an editable Markdown file on disk', async () => {
    const body = await readFile(join(dataDir ?? '', 'skills', SKILL_NAME, 'SKILL.md'), 'utf8');
    expect(body).toContain(`name: ${SKILL_NAME}`);
    expect(body).toContain('## Ledger rules');
  });

  await test.step('save an agent that may use only that skill', async () => {
    await page.goto('/agents');
    await page.getByRole('button', { name: 'New agent' }).click();
    await page.getByLabel('Name').fill('Ledger keeper');
    await page.getByLabel('Instructions').fill('Check every route against the ledger.');
    await page.getByRole('radio', { name: 'Only the skills chosen below' }).check();
    await page
      .getByRole('list', { name: 'Chosen skills' })
      .getByRole('checkbox', { name: new RegExp(SKILL_NAME) })
      .check();
    await page.getByRole('button', { name: 'Create agent' }).click();
    await expect(
      page.getByRole('region', { name: 'Saved agents' }).getByText('Ledger keeper'),
    ).toBeVisible();
  });

  await test.step('chat with it; the recorded request lists the skill', async () => {
    await page.request.patch('/api/app-settings', {
      data: { providerConfig: { source: 'custom', model: STUB_MODEL_ID, baseUrl: stubUrl } },
    });
    const created = await page.request.post('/api/books', { data: { title: 'Salt Steppe' } });
    const slug = ((await created.json()) as { slug: string }).slug;

    await page.goto(`/books/${slug}/agent`);
    await page.getByRole('combobox', { name: 'Agent' }).selectOption({ label: 'Ledger keeper' });
    await page.getByLabel('New chat').fill('Add Ada Brass to the cast');
    await page.getByRole('button', { name: 'Start chat' }).click();
    await expect(page.getByText(`${STUB_AGENT_REPLY} Speaking as Ledger keeper.`)).toBeVisible();

    await page.getByRole('button', { name: 'Inspect steps' }).click();
    const inspector = page.getByRole('dialog', { name: 'What the model received' });
    const firstStep = inspector.getByRole('list', { name: 'Steps' }).getByRole('listitem').first();
    await firstStep.getByText('Request body').click();
    await expect(firstStep.locator('pre').first()).toContainText(
      `${SKILL_NAME}: ${SKILL_DESCRIPTION}`,
    );
    await inspector.getByRole('button', { name: 'Close inspector' }).click();
  });
});
