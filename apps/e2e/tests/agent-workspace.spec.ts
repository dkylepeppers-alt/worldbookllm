import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  SLOW_MARKER,
  STUB_AGENT_CHARACTER,
  STUB_AGENT_REPLY,
  STUB_MODEL_ID,
} from '../stub-provider/stub-provider.js';

// M7 phase 4b: the Agent tab at phone width. The stub provider scripts a
// tool-calling turn (run_story add character), so the real agent loop, the
// real story CLI, and checkpoint undo all run behind the UI.
test.use({ viewport: { width: 390, height: 844 } });

// The provider setting is global and other journeys assume what they found
// at their start, so this journey puts it back when it ends.
let previousProvider: unknown = null;

test.beforeEach(async ({ request }) => {
  const settings = await request.get('/api/app-settings');
  previousProvider = ((await settings.json()) as { providerConfig: unknown }).providerConfig;
});

test.afterEach(async ({ request }) => {
  await request.patch('/api/app-settings', { data: { providerConfig: previousProvider } });
});

test('M7 agent tab on a phone', async ({ page }) => {
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  const stubUrl = process.env.E2E_STUB_URL;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();
  expect(stubUrl, 'global-setup must publish the stub provider URL').toBeTruthy();

  let slug = '';
  await test.step('set up a provider and a book', async () => {
    const settings = await page.request.patch('/api/app-settings', {
      data: { providerConfig: { source: 'custom', model: STUB_MODEL_ID, baseUrl: stubUrl } },
    });
    expect(settings.ok()).toBe(true);
    const created = await page.request.post('/api/books', { data: { title: 'Brass Harbor' } });
    expect(created.ok()).toBe(true);
    slug = ((await created.json()) as { slug: string }).slug;
  });
  const characterFile = join(dataDir ?? '', 'projects', slug, 'characters/ada-brass.md');
  const tabs = page.getByRole('navigation', { name: 'Book' });

  await test.step('install Story Skills from the Agent tab', async () => {
    await page.goto(`/books/${slug}/write`);
    await tabs.getByRole('link', { name: 'Agent' }).click();
    await expect(page).toHaveURL(new RegExp(`/books/${slug}/agent$`, 'u'));
    const notice = page.getByRole('region', { name: 'Story Skills' });
    await notice.getByRole('button', { name: 'Install Story Skills' }).click();
    await expect(notice.getByText(/^Installed \d+ skills/u)).toBeVisible();
  });

  await test.step('start a chat; the agent runs story add and reports its change', async () => {
    await page.getByLabel('New chat').fill('Add Ada Brass to the cast');
    await page.getByRole('button', { name: 'Start chat' }).click();
    await expect(page).toHaveURL(new RegExp(`/books/${slug}/agent/[0-9a-f-]+$`, 'u'));
    await expect(page.getByText(STUB_AGENT_REPLY)).toBeVisible();

    const chip = page.getByRole('list', { name: 'Step 1 tools' });
    await expect(chip.getByText('run_story')).toBeVisible();
    await expect(chip.getByText(`add character ${STUB_AGENT_CHARACTER}`)).toBeVisible();
    await expect(chip.getByText('done')).toBeVisible();
    await expect(readFile(characterFile, 'utf8')).resolves.toContain(STUB_AGENT_CHARACTER);
  });

  const summary = page.getByRole('region', { name: 'Changes this turn' });

  await test.step('open the diff for the new character', async () => {
    await summary.getByRole('button', { name: /characters\/ada-brass\.md/u }).click();
    const dialog = page.getByRole('dialog');
    const lines = dialog.getByRole('list', { name: 'Changes to characters/ada-brass.md' });
    await expect(lines.locator('.diff-add').first()).toBeVisible();
    await expect(lines).toContainText(STUB_AGENT_CHARACTER);
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  await test.step('undo the turn', async () => {
    await summary.getByRole('button', { name: 'Undo turn' }).click();
    await expect(summary.getByText(/· undone$/u)).toBeVisible();
    await expect(access(characterFile)).rejects.toThrow();
  });

  await test.step('run a story check from the panel and hand it to the agent', async () => {
    await page.getByText('Story commands', { exact: true }).click();
    await page.getByRole('button', { name: /^validate/u }).click();
    const result = page.getByRole('region', { name: 'story validate result' });
    await expect(result).toContainText('story validate');
    await result.getByRole('button', { name: 'Ask the agent about this' }).click();
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
      /^I ran `story validate`/u,
    );
    await page.getByRole('textbox', { name: 'Message' }).fill('');
  });

  await test.step('stop a slow turn', async () => {
    await page
      .getByRole('textbox', { name: 'Message' })
      .fill(`${SLOW_MARKER} describe the harbor at length`);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/tick 1/u)).toBeVisible();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Interrupted')).toBeVisible();
  });
});

test('review mode with a custom agent on a phone', async ({ page }) => {
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  const stubUrl = process.env.E2E_STUB_URL;
  let slug = '';
  await test.step('set up a provider and a book', async () => {
    await page.request.patch('/api/app-settings', {
      data: { providerConfig: { source: 'custom', model: STUB_MODEL_ID, baseUrl: stubUrl } },
    });
    const created = await page.request.post('/api/books', { data: { title: 'Tide Ledger' } });
    slug = ((await created.json()) as { slug: string }).slug;
  });
  const characterFile = join(dataDir ?? '', 'projects', slug, 'characters/ada-brass.md');

  await test.step('save a custom agent', async () => {
    await page.goto('/agents');
    await page.getByRole('button', { name: 'New agent' }).click();
    await page.getByLabel('Name').fill('Harbor clerk');
    await page.getByLabel('Instructions').fill('Keep the harbor ledger exact.');
    await page.getByRole('button', { name: 'Create agent' }).click();
    await expect(
      page.getByRole('region', { name: 'Saved agents' }).getByText('Harbor clerk'),
    ).toBeVisible();
  });

  await test.step('start a review-mode chat with that agent', async () => {
    await page.goto(`/books/${slug}/agent`);
    await page.getByRole('combobox', { name: 'Agent' }).selectOption({ label: 'Harbor clerk' });
    await page.getByRole('checkbox', { name: 'Review changes before they apply' }).check();
    await page.getByLabel('New chat').fill('Add Ada Brass to the cast');
    await page.getByRole('button', { name: 'Start chat' }).click();
    await expect(page.getByText(`${STUB_AGENT_REPLY} Speaking as Harbor clerk.`)).toBeVisible();
  });

  const proposal = page.getByRole('region', { name: 'Proposed changes' });

  await test.step('the change waits for review', async () => {
    await expect(proposal.getByText('new characters/ada-brass.md')).toBeVisible();
    await expect(access(characterFile)).rejects.toThrow();
    await proposal.getByRole('button', { name: 'new characters/ada-brass.md' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('list', { name: 'Changes to characters/ada-brass.md' }),
    ).toContainText(STUB_AGENT_CHARACTER);
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  await test.step('apply it into the book', async () => {
    await proposal.getByRole('button', { name: 'Apply characters/ada-brass.md' }).click();
    await expect(proposal.getByText('applied')).toBeVisible();
    await expect(readFile(characterFile, 'utf8')).resolves.toContain(STUB_AGENT_CHARACTER);
  });
});
