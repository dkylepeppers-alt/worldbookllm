import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

const NOTEBOOK_NAME = 'Survey of the Reaches';
const SOURCES = [
  {
    title: 'Iron Compact charter',
    content: 'The Iron Compact is a smuggling cartel ruling the eastern quays.',
  },
  {
    title: 'Glass Marsh survey',
    content: 'A basilisk haunts the glass marsh at low tide.',
  },
  {
    title: 'Harbor weather',
    content: 'Storms arrive from the west in autumn.',
  },
];

// The M3 knowledge-base organization journey: categorize and tag a source,
// browse by filter and full-text search, and pull exactly the right source
// into a chat via search-backed selection. Grounded streaming over a selected
// source is covered by walking-skeleton.spec.ts.
test('M3 knowledge-base organization', async ({ page }) => {
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();

  let notebookUrl = '';
  const sourcesPanel = page.getByRole('complementary', { name: 'Sources' });

  await test.step('create a notebook with three sources', async () => {
    await page.goto('/');
    await page.getByLabel('Notebook name').fill(NOTEBOOK_NAME);
    await page.getByRole('button', { name: 'Create notebook' }).click();
    await expect(page).toHaveURL(/\/notebooks\/[0-9a-f-]+$/);
    notebookUrl = page.url();
    for (const source of SOURCES) {
      await page.getByRole('button', { name: 'Paste source' }).click();
      await page.getByLabel('Source title').fill(source.title);
      await page.getByLabel('Markdown content').fill(source.content);
      await page.getByRole('button', { name: 'Save source' }).click();
      await expect(page.getByRole('link', { name: source.title })).toBeVisible();
    }
  });

  await test.step('categorize and tag a source in the viewer', async () => {
    await page.getByRole('link', { name: 'Iron Compact charter' }).click();
    const reader = page.getByRole('region', { name: 'Reader' });
    await reader.getByRole('button', { name: 'Edit Iron Compact charter' }).click();
    await reader.getByLabel('Category').selectOption('factions');
    await reader.getByLabel('Tags').fill('iron-compact, smugglers');
    await reader.getByRole('button', { name: 'Save source' }).click();
    await expect(reader).toContainText('factions');
    await expect(reader).toContainText('#iron-compact #smugglers');
    await page.goto(notebookUrl);
  });

  await test.step('filter the source browser by category and tag', async () => {
    await sourcesPanel.getByLabel('Category').selectOption('factions');
    await expect(sourcesPanel.getByRole('link', { name: 'Glass Marsh survey' })).toHaveCount(0);
    await expect(sourcesPanel.getByRole('link', { name: 'Iron Compact charter' })).toBeVisible();
    await sourcesPanel.getByLabel('Category').selectOption('all');

    await sourcesPanel.getByLabel('Tag').selectOption('smugglers');
    await expect(sourcesPanel.getByRole('link', { name: 'Harbor weather' })).toHaveCount(0);
    await expect(sourcesPanel.getByRole('link', { name: 'Iron Compact charter' })).toBeVisible();
    await sourcesPanel.getByLabel('Tag').selectOption('all');
    await expect(sourcesPanel.getByRole('link', { name: 'Harbor weather' })).toBeVisible();
  });

  await test.step('full-text search surfaces the matching source with an excerpt', async () => {
    await sourcesPanel.getByLabel('Search').fill('basilisk');
    await expect(sourcesPanel.getByRole('link', { name: 'Glass Marsh survey' })).toBeVisible();
    await expect(sourcesPanel.getByRole('link', { name: 'Iron Compact charter' })).toHaveCount(0);
    await expect(sourcesPanel).toContainText('basilisk haunts the glass marsh');
    await sourcesPanel.getByLabel('Search').fill('');
    await expect(sourcesPanel.getByRole('link', { name: 'Iron Compact charter' })).toBeVisible();
  });

  await test.step('pull the right source into a chat via search-backed selection', async () => {
    await page.getByRole('button', { name: 'New chat' }).click();
    const chatDetail = page.getByRole('region', { name: 'Selected chat' });
    await expect(chatDetail).toContainText('0 of 3 sources selected');
    await chatDetail.getByLabel('Search sources to select').fill('basilisk');
    await chatDetail.getByRole('button', { name: 'Select results' }).click();
    await expect(chatDetail).toContainText('1 of 3 sources selected');
    await chatDetail.getByLabel('Search sources to select').fill('');
    await expect(chatDetail.getByRole('checkbox', { name: 'Glass Marsh survey' })).toBeChecked();
    await expect(
      chatDetail.getByRole('checkbox', { name: 'Iron Compact charter' }),
    ).not.toBeChecked();
  });

  await test.step('category and tags live in the frontmatter on disk', async () => {
    const notebookId = /\/notebooks\/([0-9a-f-]+)$/.exec(notebookUrl)?.[1];
    expect(notebookId).toBeTruthy();
    const sourcesDir = join(dataDir ?? '', 'notebooks', notebookId ?? '', 'sources');
    const files = await readdir(sourcesDir);
    const charterFile = files.find((file) => file.includes('iron-compact-charter'));
    expect(charterFile).toBeTruthy();
    const body = await readFile(join(sourcesDir, charterFile ?? ''), 'utf8');
    expect(body).toContain('category: factions');
    expect(body).toContain('- iron-compact');
    expect(body).toContain('- smugglers');
  });
});
